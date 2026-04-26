use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::oneshot::error::TryRecvError;
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;
use tokio::time::Instant;

use crate::backend::app_server::WorkspaceSession;
use crate::codex::config as codex_config;
use crate::codex::home::{resolve_default_codex_home, resolve_workspace_codex_home};
use crate::rules;
use crate::shared::account::{build_account_response, read_auth_account};
use crate::shared::prompt_routing_core::{
    attach_auto_model_routing_decision, build_chatgpt_account_retry_decision,
    build_runtime_fallback_routing_decision, build_skipped_routing_decision,
    is_chatgpt_account_unsupported_model_error, resolve_auto_model_routing_for_turn_start,
};
use crate::types::{AppSettings, AutoModelRoutingProvider, WorkspaceEntry};

const LOGIN_START_TIMEOUT: Duration = Duration::from_secs(30);
#[allow(dead_code)]
const MAX_INLINE_IMAGE_BYTES: u64 = 50 * 1024 * 1024;
const THREAD_LIST_SOURCE_KINDS: &[&str] = &[
    "cli",
    "vscode",
    "appServer",
    "subAgentReview",
    "subAgentCompact",
    "subAgentThreadSpawn",
    "unknown",
];

#[allow(dead_code)]
fn image_extension_for_path(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
}

#[allow(dead_code)]
fn image_mime_type_for_path(path: &str) -> Option<&'static str> {
    let extension = image_extension_for_path(path)?;
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "tiff" | "tif" => Some("image/tiff"),
        _ => None,
    }
}

#[allow(dead_code)]
fn should_inline_image_path_for_codex(path: &str) -> bool {
    matches!(
        image_extension_for_path(path).as_deref(),
        Some("heic") | Some("heif")
    )
}

fn extract_turn_start_error_message(response: &Value) -> Option<String> {
    response
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(ToString::to_string)
}

#[cfg(target_os = "macos")]
fn temp_converted_image_path(path: &str, extension: &str) -> PathBuf {
    let stem = Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let safe_stem = stem
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("codex-monitor-image-{safe_stem}-{ts}.{extension}"))
}

#[cfg(target_os = "macos")]
fn convert_heif_image_to_jpeg_bytes(path: &str) -> Result<Vec<u8>, String> {
    let output_path = temp_converted_image_path(path, "jpg");
    let status = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "jpeg"])
        .arg(path)
        .arg("--out")
        .arg(&output_path)
        .status()
        .map_err(|err| format!("Failed to launch HEIC/HEIF conversion for {path}: {err}"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&output_path);
        return Err(format!(
            "Failed to convert HEIC/HEIF image into a Codex-compatible JPEG: {path}"
        ));
    }
    let bytes = std::fs::read(&output_path).map_err(|err| {
        format!(
            "Failed to read converted JPEG for {path} at {}: {err}",
            output_path.display()
        )
    })?;
    let _ = std::fs::remove_file(&output_path);
    if bytes.is_empty() {
        return Err(format!(
            "Converted JPEG is empty after HEIC/HEIF conversion: {path}"
        ));
    }
    Ok(bytes)
}

#[allow(dead_code)]
pub(crate) fn normalize_file_path(raw: &str) -> String {
    let path = raw.trim();
    let file_uri_path = path
        .strip_prefix("file://localhost")
        .or_else(|| path.strip_prefix("file://"));
    let Some(path) = file_uri_path else {
        return path.to_string();
    };

    let mut decoded = Vec::with_capacity(path.len());
    let bytes = path.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hi = bytes[index + 1];
            let lo = bytes[index + 2];
            let hi_value = match hi {
                b'0'..=b'9' => Some(hi - b'0'),
                b'a'..=b'f' => Some(hi - b'a' + 10),
                b'A'..=b'F' => Some(hi - b'A' + 10),
                _ => None,
            };
            let lo_value = match lo {
                b'0'..=b'9' => Some(lo - b'0'),
                b'a'..=b'f' => Some(lo - b'a' + 10),
                b'A'..=b'F' => Some(lo - b'A' + 10),
                _ => None,
            };
            if let (Some(hi_nibble), Some(lo_nibble)) = (hi_value, lo_value) {
                decoded.push((hi_nibble << 4) | lo_nibble);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

#[allow(dead_code)]
pub(crate) fn read_image_as_data_url_core(path: &str) -> Result<String, String> {
    let trimmed_path = normalize_file_path(path);
    if trimmed_path.is_empty() {
        return Err("Image path is required".to_string());
    }
    if should_inline_image_path_for_codex(&trimmed_path) {
        #[cfg(target_os = "macos")]
        {
            let encoded = STANDARD.encode(convert_heif_image_to_jpeg_bytes(&trimmed_path)?);
            return Ok(format!("data:image/jpeg;base64,{encoded}"));
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err(format!(
                "HEIC/HEIF images are not supported on this platform; convert to JPEG or PNG first: {trimmed_path}"
            ));
        }
    }
    let mime_type = image_mime_type_for_path(&trimmed_path).ok_or_else(|| {
        format!("Unsupported or missing image extension for path: {trimmed_path}")
    })?;
    let metadata = std::fs::symlink_metadata(&trimmed_path)
        .map_err(|err| format!("Failed to stat image file at {trimmed_path}: {err}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Image path must not be a symlink: {trimmed_path}"));
    }
    if !metadata.is_file() {
        return Err(format!("Image path is not a file: {trimmed_path}"));
    }
    if metadata.len() > MAX_INLINE_IMAGE_BYTES {
        return Err(format!(
            "Image file exceeds maximum size of {MAX_INLINE_IMAGE_BYTES} bytes: {trimmed_path}"
        ));
    }
    let bytes = std::fs::read(&trimmed_path)
        .map_err(|err| format!("Failed to read image file at {trimmed_path}: {err}"))?;
    if bytes.is_empty() {
        return Err(format!("Image file is empty: {trimmed_path}"));
    }
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:{mime_type};base64,{encoded}"))
}

pub(crate) enum CodexLoginCancelState {
    PendingStart(oneshot::Sender<()>),
    LoginId(String),
}

async fn get_session_clone(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: &str,
) -> Result<Arc<WorkspaceSession>, String> {
    let sessions = sessions.lock().await;
    sessions
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not connected".to_string())
}

async fn resolve_workspace_and_parent(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<(WorkspaceEntry, Option<WorkspaceEntry>), String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not found".to_string())?;
    let parent_entry = entry
        .parent_id
        .as_ref()
        .and_then(|parent_id| workspaces.get(parent_id))
        .cloned();
    Ok((entry, parent_entry))
}

async fn resolve_codex_home_for_workspace_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let (entry, parent_entry) = resolve_workspace_and_parent(workspaces, workspace_id).await?;
    resolve_workspace_codex_home(&entry, parent_entry.as_ref())
        .or_else(resolve_default_codex_home)
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
}

async fn resolve_workspace_path_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<String, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    Ok(entry.path.clone())
}

pub(crate) async fn start_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let workspace_path = resolve_workspace_path_core(workspaces, &workspace_id).await?;
    let params = json!({
        "cwd": workspace_path,
        "approvalPolicy": "on-request"
    });
    session
        .send_request_for_workspace(&workspace_id, "thread/start", params)
        .await
}

pub(crate) async fn resume_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "thread/resume", params)
        .await
}

pub(crate) async fn read_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "thread/read", params)
        .await
}

pub(crate) async fn thread_live_subscribe_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<(), String> {
    if thread_id.trim().is_empty() {
        return Err("threadId is required".to_string());
    }
    let _ = get_session_clone(sessions, &workspace_id).await?;
    Ok(())
}

pub(crate) async fn thread_live_unsubscribe_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<(), String> {
    if thread_id.trim().is_empty() {
        return Err("threadId is required".to_string());
    }
    let _ = get_session_clone(sessions, &workspace_id).await?;
    Ok(())
}

pub(crate) async fn fork_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "thread/fork", params)
        .await
}

pub(crate) async fn list_threads_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    sort_key: Option<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({
        "cursor": cursor,
        "limit": limit,
        "sortKey": sort_key,
        // Keep interactive and sub-agent sessions visible across CLI versions so
        // thread/list refreshes do not drop valid historical conversations.
        // Intentionally exclude generic "subAgent" so parentless internal jobs
        // (for example memory consolidation) do not leak back into app state.
        "sourceKinds": THREAD_LIST_SOURCE_KINDS
    });
    session
        .send_request_for_workspace(&workspace_id, "thread/list", params)
        .await
}

pub(crate) async fn list_mcp_server_status_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "cursor": cursor, "limit": limit });
    session
        .send_request_for_workspace(&workspace_id, "mcpServerStatus/list", params)
        .await
}

pub(crate) async fn archive_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "thread/archive", params)
        .await
}

pub(crate) async fn compact_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "thread/compact/start", params)
        .await
}

pub(crate) async fn set_thread_name_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
    name: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id, "name": name });
    session
        .send_request_for_workspace(&workspace_id, "thread/name/set", params)
        .await
}

fn build_turn_input_items(
    text: String,
    images: Option<Vec<String>>,
    app_mentions: Option<Vec<Value>>,
) -> Result<Vec<Value>, String> {
    let trimmed_text = text.trim();
    let mut input: Vec<Value> = Vec::new();
    if !trimmed_text.is_empty() {
        input.push(json!({ "type": "text", "text": trimmed_text }));
    }
    if let Some(paths) = images {
        for path in paths {
            let trimmed = path.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with("data:")
                || trimmed.starts_with("http://")
                || trimmed.starts_with("https://")
            {
                input.push(json!({ "type": "image", "url": trimmed }));
            } else if should_inline_image_path_for_codex(trimmed) {
                input.push(json!({
                    "type": "image",
                    "url": read_image_as_data_url_core(trimmed)?,
                }));
            } else {
                input.push(json!({ "type": "localImage", "path": trimmed }));
            }
        }
    }
    if let Some(mentions) = app_mentions {
        let mut seen_paths: HashSet<String> = HashSet::new();
        for mention in mentions {
            let object = mention
                .as_object()
                .ok_or_else(|| "invalid app mention payload".to_string())?;
            let name = object
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "invalid app mention name".to_string())?;
            let path = object
                .get("path")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "invalid app mention path".to_string())?;
            if !path.starts_with("app://") || path.len() <= "app://".len() {
                return Err("invalid app mention path".to_string());
            }
            if !seen_paths.insert(path.to_string()) {
                continue;
            }
            input.push(json!({ "type": "mention", "name": name, "path": path }));
        }
    }
    if input.is_empty() {
        return Err("empty user message".to_string());
    }
    Ok(input)
}

pub(crate) fn insert_optional_nullable_string(
    params: &mut Map<String, Value>,
    key: &str,
    value: Option<Option<String>>,
) {
    if let Some(value) = value {
        params.insert(key.to_string(), json!(value));
    }
}

pub(crate) async fn send_user_message_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    app_settings: &Mutex<AppSettings>,
    workspace_id: String,
    thread_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    service_tier: Option<Option<String>>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    app_mentions: Option<Vec<Value>>,
    collaboration_mode: Option<Value>,
    model_selection_mode: Option<String>,
    auto_model_routing_bypass: bool,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let settings = app_settings.lock().await.clone();
    let requested_model = model.clone();
    let requested_effort = effort.clone();
    let mut model_list_response_for_retry = None;
    let explicit_auto_requested = matches!(model_selection_mode.as_deref(), Some("auto"));
    let requested_model_is_empty = model
        .as_deref()
        .map(str::trim)
        .is_none_or(|value| value.is_empty());
    let auto_requested =
        settings.auto_model_routing_enabled || (explicit_auto_requested && requested_model_is_empty);
    let mut routing_decision = if !auto_model_routing_bypass
        && (settings.auto_model_routing_enabled || auto_requested)
    {
        match session
            .send_request_for_workspace(&workspace_id, "model/list", json!({}))
            .await
        {
            Ok(model_list_response) => {
                model_list_response_for_retry = Some(model_list_response.clone());
                match resolve_auto_model_routing_for_turn_start(
                    &settings,
                    text.as_str(),
                    model.as_deref(),
                    effort.as_deref(),
                    images.as_deref(),
                    app_mentions.as_deref(),
                    auto_model_routing_bypass,
                    &model_list_response,
                )
                .await
                {
                    Ok(decision) => decision,
                    Err(error) => Some(build_skipped_routing_decision(
                        settings.auto_model_routing_mode.as_str(),
                        AutoModelRoutingProvider::Openai,
                        model.as_deref(),
                        effort.as_deref(),
                        "Routing skipped because backend routing setup was invalid.".to_string(),
                        Some(error),
                    )),
                }
            }
            Err(error) => Some(build_skipped_routing_decision(
                settings.auto_model_routing_mode.as_str(),
                AutoModelRoutingProvider::Openai,
                model.as_deref(),
                effort.as_deref(),
                "Routing skipped because runtime model candidates could not be fetched."
                    .to_string(),
                Some(error),
            )),
        }
    } else {
        None
    };
    let mut selected_model = routing_decision
        .as_ref()
        .map(|decision| Some(decision.selected_model.clone()))
        .unwrap_or(model);
    let mut selected_effort = routing_decision
        .as_ref()
        .map(|decision| decision.selected_reasoning_effort.clone())
        .unwrap_or(effort);
    if auto_requested
        && selected_model
        .as_deref()
        .map(str::trim)
        .is_none_or(|value| value.is_empty())
    {
        if model_list_response_for_retry.is_none() {
            model_list_response_for_retry = session
                .send_request_for_workspace(&workspace_id, "model/list", json!({}))
                .await
                .ok();
        }
        if let Some(model_list_response) = model_list_response_for_retry.as_ref() {
            if let Some(fallback_decision) = build_runtime_fallback_routing_decision(
                &settings,
                requested_model.as_deref(),
                requested_effort.as_deref(),
                model_list_response,
                "No concrete model was selected; using deterministic runtime fallback."
                    .to_string(),
                Some(
                    "Recovered from a null-model send request before turn/start."
                        .to_string(),
                ),
            ) {
                selected_model = Some(fallback_decision.selected_model.clone());
                selected_effort = fallback_decision.selected_reasoning_effort.clone();
                routing_decision = Some(fallback_decision);
            }
        }
    }
    let workspace_path = resolve_workspace_path_core(workspaces, &workspace_id).await?;
    let access_mode = access_mode.unwrap_or_else(|| "current".to_string());
    let sandbox_policy = match access_mode.as_str() {
        "full-access" => json!({ "type": "dangerFullAccess" }),
        "read-only" => json!({ "type": "readOnly" }),
        _ => json!({
            "type": "workspaceWrite",
            "writableRoots": [workspace_path.clone()],
            "networkAccess": true
        }),
    };

    let approval_policy = if access_mode == "full-access" {
        "never"
    } else {
        "on-request"
    };

    let input = build_turn_input_items(text, images, app_mentions)?;

    let mut params = Map::new();
    params.insert("threadId".to_string(), json!(thread_id));
    params.insert("input".to_string(), json!(input));
    params.insert("cwd".to_string(), json!(workspace_path));
    params.insert("approvalPolicy".to_string(), json!(approval_policy));
    params.insert("sandboxPolicy".to_string(), json!(sandbox_policy));
    params.insert("model".to_string(), json!(selected_model));
    params.insert("effort".to_string(), json!(selected_effort));
    insert_optional_nullable_string(&mut params, "serviceTier", service_tier);
    if let Some(mode) = collaboration_mode {
        if !mode.is_null() {
            params.insert("collaborationMode".to_string(), mode);
        }
    }
    let mut response = match session
        .send_request_for_workspace(&workspace_id, "turn/start", Value::Object(params.clone()))
        .await
    {
        Ok(response) => {
            let response_text = response.to_string();
            let retry_decision = if is_chatgpt_account_unsupported_model_error(response_text.as_str())
                || extract_turn_start_error_message(&response).is_some_and(|message| {
                    is_chatgpt_account_unsupported_model_error(message.as_str())
                })
            {
                    if model_list_response_for_retry.is_none() {
                        model_list_response_for_retry = session
                            .send_request_for_workspace(&workspace_id, "model/list", json!({}))
                            .await
                            .ok();
                    }
                    model_list_response_for_retry.as_ref().and_then(|model_list_response| {
                        build_chatgpt_account_retry_decision(
                            &settings,
                            requested_model.as_deref(),
                            requested_effort.as_deref(),
                            selected_model.as_deref(),
                            model_list_response,
                        )
                    })
            } else {
                None
            };

            if let Some(retry_decision) = retry_decision {
                routing_decision = Some(retry_decision.clone());
                params.insert(
                    "model".to_string(),
                    json!(Some(retry_decision.selected_model.clone())),
                );
                params.insert(
                    "effort".to_string(),
                    json!(retry_decision.selected_reasoning_effort.clone()),
                );
                session
                    .send_request_for_workspace(
                        &workspace_id,
                        "turn/start",
                        Value::Object(params.clone()),
                    )
                    .await?
            } else {
                response
            }
        }
        Err(error) => {
            let retry_decision = if is_chatgpt_account_unsupported_model_error(error.as_str()) {
                if model_list_response_for_retry.is_none() {
                    model_list_response_for_retry = session
                        .send_request_for_workspace(&workspace_id, "model/list", json!({}))
                        .await
                        .ok();
                }
                model_list_response_for_retry.as_ref().and_then(|model_list_response| {
                    build_chatgpt_account_retry_decision(
                        &settings,
                        requested_model.as_deref(),
                        requested_effort.as_deref(),
                        selected_model.as_deref(),
                        model_list_response,
                    )
                })
            } else {
                None
            };

            if let Some(retry_decision) = retry_decision {
                routing_decision = Some(retry_decision.clone());
                params.insert(
                    "model".to_string(),
                    json!(Some(retry_decision.selected_model.clone())),
                );
                params.insert(
                    "effort".to_string(),
                    json!(retry_decision.selected_reasoning_effort.clone()),
                );
                session
                    .send_request_for_workspace(
                        &workspace_id,
                        "turn/start",
                        Value::Object(params.clone()),
                    )
                    .await?
            } else {
                return Err(error);
            }
        }
    };
    if let Some(decision) = routing_decision.as_ref() {
        attach_auto_model_routing_decision(&mut response, decision);
    }
    Ok(response)
}

pub(crate) async fn turn_steer_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
    turn_id: String,
    text: String,
    images: Option<Vec<String>>,
    app_mentions: Option<Vec<Value>>,
) -> Result<Value, String> {
    if turn_id.trim().is_empty() {
        return Err("missing active turn id".to_string());
    }
    let session = get_session_clone(sessions, &workspace_id).await?;
    let input = build_turn_input_items(text, images, app_mentions)?;
    let params = json!({
        "threadId": thread_id,
        "expectedTurnId": turn_id,
        "input": input
    });
    session
        .send_request_for_workspace(&workspace_id, "turn/steer", params)
        .await
}

pub(crate) async fn collaboration_mode_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    session
        .send_request_for_workspace(&workspace_id, "collaborationMode/list", json!({}))
        .await
}

pub(crate) async fn turn_interrupt_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
    turn_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id, "turnId": turn_id });
    session
        .send_request_for_workspace(&workspace_id, "turn/interrupt", params)
        .await
}

pub(crate) async fn start_review_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
    target: Value,
    delivery: Option<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let mut params = Map::new();
    params.insert("threadId".to_string(), json!(thread_id));
    params.insert("target".to_string(), target);
    if let Some(delivery) = delivery {
        params.insert("delivery".to_string(), json!(delivery));
    }
    session
        .send_request_for_workspace(&workspace_id, "review/start", Value::Object(params))
        .await
}

pub(crate) async fn model_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    session
        .send_request_for_workspace(&workspace_id, "model/list", json!({}))
        .await
}

pub(crate) async fn experimental_feature_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "cursor": cursor, "limit": limit });
    session
        .send_request_for_workspace(&workspace_id, "experimentalFeature/list", params)
        .await
}

pub(crate) async fn account_rate_limits_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    session
        .send_request_for_workspace(&workspace_id, "account/rateLimits/read", Value::Null)
        .await
}

pub(crate) async fn account_read_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = {
        let sessions = sessions.lock().await;
        sessions.get(&workspace_id).cloned()
    };
    let response = if let Some(session) = session {
        session
            .send_request_for_workspace(&workspace_id, "account/read", Value::Null)
            .await
            .ok()
    } else {
        None
    };

    let (entry, parent_entry) = resolve_workspace_and_parent(workspaces, &workspace_id).await?;
    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref())
        .or_else(resolve_default_codex_home);
    let fallback = read_auth_account(codex_home);

    Ok(build_account_response(response, fallback))
}

pub(crate) async fn codex_login_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    codex_login_cancels: &Mutex<HashMap<String, CodexLoginCancelState>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    {
        let mut cancels = codex_login_cancels.lock().await;
        if let Some(existing) = cancels.remove(&workspace_id) {
            match existing {
                CodexLoginCancelState::PendingStart(tx) => {
                    let _ = tx.send(());
                }
                CodexLoginCancelState::LoginId(_) => {}
            }
        }
        cancels.insert(
            workspace_id.clone(),
            CodexLoginCancelState::PendingStart(cancel_tx),
        );
    }

    let start = Instant::now();
    let mut cancel_rx = cancel_rx;
    let workspace_for_request = workspace_id.clone();
    let mut login_request: Pin<Box<_>> = Box::pin(session.send_request_for_workspace(
        &workspace_for_request,
        "account/login/start",
        json!({ "type": "chatgpt" }),
    ));

    let response = loop {
        match cancel_rx.try_recv() {
            Ok(_) => {
                let mut cancels = codex_login_cancels.lock().await;
                cancels.remove(&workspace_id);
                return Err("Codex login canceled.".to_string());
            }
            Err(TryRecvError::Closed) => {
                let mut cancels = codex_login_cancels.lock().await;
                cancels.remove(&workspace_id);
                return Err("Codex login canceled.".to_string());
            }
            Err(TryRecvError::Empty) => {}
        }

        let elapsed = start.elapsed();
        if elapsed >= LOGIN_START_TIMEOUT {
            let mut cancels = codex_login_cancels.lock().await;
            cancels.remove(&workspace_id);
            return Err("Codex login start timed out.".to_string());
        }

        let tick = Duration::from_millis(150);
        let remaining = LOGIN_START_TIMEOUT.saturating_sub(elapsed);
        let wait_for = remaining.min(tick);

        match timeout(wait_for, &mut login_request).await {
            Ok(result) => break result?,
            Err(_elapsed) => continue,
        }
    };

    let payload = response.get("result").unwrap_or(&response);
    let login_id = payload
        .get("loginId")
        .or_else(|| payload.get("login_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "missing login id in account/login/start response".to_string())?;
    let auth_url = payload
        .get("authUrl")
        .or_else(|| payload.get("auth_url"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "missing auth url in account/login/start response".to_string())?;

    {
        let mut cancels = codex_login_cancels.lock().await;
        cancels.insert(
            workspace_id,
            CodexLoginCancelState::LoginId(login_id.clone()),
        );
    }

    Ok(json!({
        "loginId": login_id,
        "authUrl": auth_url,
        "raw": response,
    }))
}

pub(crate) async fn codex_login_cancel_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    codex_login_cancels: &Mutex<HashMap<String, CodexLoginCancelState>>,
    workspace_id: String,
) -> Result<Value, String> {
    let cancel_state = {
        let mut cancels = codex_login_cancels.lock().await;
        cancels.remove(&workspace_id)
    };

    let Some(cancel_state) = cancel_state else {
        return Ok(json!({ "canceled": false }));
    };

    match cancel_state {
        CodexLoginCancelState::PendingStart(cancel_tx) => {
            let _ = cancel_tx.send(());
            return Ok(json!({
                "canceled": true,
                "status": "canceled",
            }));
        }
        CodexLoginCancelState::LoginId(login_id) => {
            let session = get_session_clone(sessions, &workspace_id).await?;
            let response = session
                .send_request_for_workspace(
                    &workspace_id,
                    "account/login/cancel",
                    json!({
                        "loginId": login_id,
                    }),
                )
                .await?;

            let payload = response.get("result").unwrap_or(&response);
            let status = payload
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let canceled = status.eq_ignore_ascii_case("canceled");

            Ok(json!({
                "canceled": canceled,
                "status": status,
                "raw": response,
            }))
        }
    }
}

pub(crate) async fn skills_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let workspace_path = resolve_workspace_path_core(workspaces, &workspace_id).await?;

    // Codex can discover project-scoped skills from `<workspace>/.agents/skills`.
    // Some environments don't surface those reliably in CodexMonitor unless we
    // pass the default project skills path explicitly.
    let mut source_paths: Vec<String> = vec![];
    let project_skills_dir = Path::new(&workspace_path).join(".agents").join("skills");
    if project_skills_dir.is_dir() {
        if let Some(p) = project_skills_dir.to_str() {
            source_paths.push(p.to_string());
        }
    }

    let params = if source_paths.is_empty() {
        json!({ "cwd": workspace_path })
    } else {
        json!({ "cwd": workspace_path, "skillsPaths": source_paths })
    };

    let mut response = session
        .send_request_for_workspace(&workspace_id, "skills/list", params)
        .await?;

    // Attach diagnostics for the UI (non-breaking: keep original response fields).
    if let Value::Object(ref mut obj) = response {
        obj.insert("sourcePaths".to_string(), json!(source_paths));
        obj.insert("sourceErrors".to_string(), json!([]));
    }

    Ok(response)
}

pub(crate) async fn apps_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    thread_id: Option<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "cursor": cursor, "limit": limit, "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "app/list", params)
        .await
}

pub(crate) async fn respond_to_server_request_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    request_id: Value,
    result: Value,
) -> Result<(), String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    session.send_response(request_id, result).await
}

pub(crate) async fn remember_approval_rule_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    command: Vec<String>,
) -> Result<Value, String> {
    let command = command
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    if command.is_empty() {
        return Err("empty command".to_string());
    }

    let codex_home = resolve_codex_home_for_workspace_core(workspaces, &workspace_id).await?;
    let rules_path = rules::default_rules_path(&codex_home);
    rules::append_prefix_rule(&rules_path, &command)?;

    Ok(json!({
        "ok": true,
        "rulesPath": rules_path,
    }))
}

pub(crate) async fn get_config_model_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    let codex_home = resolve_codex_home_for_workspace_core(workspaces, &workspace_id).await?;
    let model = codex_config::read_config_model(Some(codex_home))?;
    Ok(json!({ "model": model }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::app_server::WorkspaceSession;
    use crate::shared::prompt_routing_core::{
        clear_test_router_credential_result, clear_test_router_result,
        set_test_router_credential_result, set_test_router_result, RouterOutput,
    };
    use crate::types::{AppSettings, WorkspaceKind, WorkspaceSettings};
    use serde_json::Value;
    use std::collections::{HashMap, HashSet};
    use std::path::{Path, PathBuf};
    use std::process::Stdio;
    use std::sync::Arc;
    use std::sync::atomic::AtomicU64;
    use std::sync::{Mutex as StdMutex, OnceLock};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tokio::process::Command;
    use tokio::sync::Mutex;
    use tokio::time::sleep;

    #[test]
    fn normalize_strips_file_uri_prefix() {
        assert_eq!(
            normalize_file_path("file:///var/mobile/Containers/Data/photo.jpg"),
            "/var/mobile/Containers/Data/photo.jpg"
        );
    }

    #[test]
    fn normalize_strips_file_localhost_prefix() {
        assert_eq!(
            normalize_file_path("file://localhost/Users/test/image.png"),
            "/Users/test/image.png"
        );
    }

    #[test]
    fn normalize_decodes_percent_encoding() {
        assert_eq!(
            normalize_file_path("file:///var/mobile/path%20with%20spaces/img.jpg"),
            "/var/mobile/path with spaces/img.jpg"
        );
    }

    #[test]
    fn normalize_plain_path_unchanged() {
        assert_eq!(
            normalize_file_path("/var/mobile/Containers/Data/photo.jpg"),
            "/var/mobile/Containers/Data/photo.jpg"
        );
    }

    #[test]
    fn normalize_plain_path_percent_sequences_unchanged() {
        assert_eq!(
            normalize_file_path("/tmp/report%20final.png"),
            "/tmp/report%20final.png"
        );
    }

    #[test]
    fn normalize_trims_whitespace() {
        assert_eq!(normalize_file_path("  /tmp/image.png  "), "/tmp/image.png");
    }

    #[test]
    fn read_image_data_url_core_rejects_file_uri_that_does_not_exist() {
        let result = read_image_as_data_url_core("file:///nonexistent/photo.png");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            !err.contains("file://"),
            "error should reference normalized path, got: {err}"
        );
        assert!(err.contains("/nonexistent/photo.png"));
    }

    #[test]
    fn read_image_data_url_core_succeeds_with_file_uri_for_real_file() {
        let dir = std::env::temp_dir().join("codex_monitor_test");
        std::fs::create_dir_all(&dir).unwrap();
        let img_path = dir.join("test_photo.png");
        let png_bytes: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
            0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
            0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        std::fs::write(&img_path, png_bytes).unwrap();

        let file_uri = format!("file://{}", img_path.display());
        let result = read_image_as_data_url_core(&file_uri);
        assert!(
            result.is_ok(),
            "file:// URI for real file should succeed, got: {:?}",
            result.err()
        );
        let data_url = result.unwrap();
        assert!(data_url.starts_with("data:image/png;base64,"));

        let space_dir = dir.join("path with spaces");
        std::fs::create_dir_all(&space_dir).unwrap();
        let space_img = space_dir.join("photo.png");
        std::fs::write(&space_img, png_bytes).unwrap();
        let encoded_uri = format!(
            "file://{}",
            space_img.display().to_string().replace(' ', "%20")
        );
        let result2 = read_image_as_data_url_core(&encoded_uri);
        assert!(
            result2.is_ok(),
            "percent-encoded file:// URI should succeed, got: {:?}",
            result2.err()
        );

        let percent_img = dir.join("report%20final.png");
        std::fs::write(&percent_img, png_bytes).unwrap();
        let plain_percent_path = percent_img.display().to_string();
        let result3 = read_image_as_data_url_core(&plain_percent_path);
        assert!(
            result3.is_ok(),
            "plain filesystem paths with percent sequences should not be decoded, got: {:?}",
            result3.err()
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn heif_paths_are_inlined_for_codex() {
        assert!(should_inline_image_path_for_codex("/tmp/photo.heic"));
        assert!(should_inline_image_path_for_codex("/tmp/photo.HEIF"));
        assert!(!should_inline_image_path_for_codex("/tmp/photo.png"));
    }

    #[test]
    fn insert_optional_nullable_string_omits_missing_and_preserves_null() {
        let mut params = Map::new();

        insert_optional_nullable_string(&mut params, "serviceTier", None);
        assert!(!params.contains_key("serviceTier"));

        insert_optional_nullable_string(&mut params, "serviceTier", Some(None));
        assert_eq!(params.get("serviceTier"), Some(&Value::Null));

        insert_optional_nullable_string(&mut params, "serviceTier", Some(Some("fast".to_string())));
        assert_eq!(params.get("serviceTier"), Some(&json!("fast")));
    }

    #[test]
    fn thread_list_source_kinds_exclude_generic_subagent_and_keep_explicit_variants() {
        assert!(!THREAD_LIST_SOURCE_KINDS.contains(&"subAgent"));
        assert!(THREAD_LIST_SOURCE_KINDS.contains(&"subAgentReview"));
        assert!(THREAD_LIST_SOURCE_KINDS.contains(&"subAgentCompact"));
        assert!(THREAD_LIST_SOURCE_KINDS.contains(&"subAgentThreadSpawn"));
    }

    fn make_workspace_entry() -> WorkspaceEntry {
        WorkspaceEntry {
            id: "ws-1".to_string(),
            name: "Test Workspace".to_string(),
            path: "/tmp/codex-monitor-routing-test".to_string(),
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    fn transcript_path(label: &str) -> PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("codex-monitor-{label}-{ts}.jsonl"))
    }

    fn make_session_with_transcript(transcript_path: &Path) -> Arc<WorkspaceSession> {
        let mut cmd = if cfg!(windows) {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", &format!("more > \"{}\"", transcript_path.display())]);
            cmd
        } else {
            let mut cmd = Command::new("sh");
            cmd.arg("-c")
                .arg(format!("cat > \"{}\"", transcript_path.display()));
            cmd
        };

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let mut child = cmd.spawn().expect("spawn transcript child");
        let stdin = child.stdin.take().expect("transcript child stdin");

        Arc::new(WorkspaceSession {
            codex_args: None,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            request_context: Mutex::new(HashMap::new()),
            thread_workspace: Mutex::new(HashMap::new()),
            hidden_thread_ids: Mutex::new(HashSet::new()),
            next_id: AtomicU64::new(0),
            background_thread_callbacks: Mutex::new(HashMap::new()),
            owner_workspace_id: "ws-1".to_string(),
            workspace_ids: Mutex::new(HashSet::from(["ws-1".to_string()])),
            workspace_roots: Mutex::new(HashMap::new()),
        })
    }

    async fn respond_to_pending_request(
        session: &Arc<WorkspaceSession>,
        id: u64,
        response: Value,
    ) {
        for _ in 0..100 {
            let sender = {
                let mut pending = session.pending.lock().await;
                pending.remove(&id)
            };
            if let Some(sender) = sender {
                session.request_context.lock().await.remove(&id);
                sender.send(response).expect("send mock response");
                return;
            }
            sleep(Duration::from_millis(10)).await;
        }
        panic!("timed out waiting for pending request id {id}");
    }

    fn read_transcript(path: &Path) -> Vec<Value> {
        let raw = std::fs::read_to_string(path).expect("read transcript");
        raw.lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str(line).expect("parse transcript line"))
            .collect()
    }

    fn routing_candidate_response() -> Value {
        json!({
            "result": {
                "data": [
                    {
                        "id": "gpt-5.4-mini",
                        "model": "gpt-5.4-mini",
                        "supportedReasoningEfforts": [
                            { "reasoningEffort": "low", "description": "" },
                            { "reasoningEffort": "medium", "description": "" }
                        ],
                        "defaultReasoningEffort": "medium",
                        "isDefault": true
                    },
                    {
                        "id": "gpt-5.4",
                        "model": "gpt-5.4",
                        "supportedReasoningEfforts": [
                            { "reasoningEffort": "medium", "description": "" },
                            { "reasoningEffort": "high", "description": "" }
                        ],
                        "defaultReasoningEffort": "high",
                        "isDefault": false
                    }
                ]
            }
        })
    }

    fn clear_router_test_state() {
        clear_test_router_credential_result();
        clear_test_router_result();
    }

    fn send_routing_test_guard() -> std::sync::MutexGuard<'static, ()> {
        static TEST_GUARD: OnceLock<StdMutex<()>> = OnceLock::new();
        TEST_GUARD
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .expect("send routing test guard")
    }

    #[test]
    fn send_user_message_core_applies_routed_model_and_effort() {
        tokio::runtime::Runtime::new().expect("runtime").block_on(async {
            let _guard = send_routing_test_guard();
            clear_router_test_state();
            let transcript = transcript_path("routed-send");
            let session = make_session_with_transcript(&transcript);
            let workspace = make_workspace_entry();
            let sessions = Arc::new(Mutex::new(HashMap::from([(workspace.id.clone(), session.clone())])));
            let workspaces = Arc::new(Mutex::new(HashMap::from([(workspace.id.clone(), workspace.clone())])));
            let mut settings = AppSettings::default();
            settings.auto_model_routing_enabled = true;
            settings.auto_model_routing_mode = "genius".to_string();
            let app_settings = Arc::new(Mutex::new(settings));

            set_test_router_credential_result(Ok("sk-test".to_string()));
            set_test_router_result(Ok(RouterOutput {
                task_type: "debugging".to_string(),
                complexity: "high".to_string(),
                ambiguity: "medium".to_string(),
                needs_tools: true,
                needs_large_context: true,
                selected_model: "gpt-5.4".to_string(),
                selected_reasoning: "high".to_string(),
                confidence: 0.91,
                reason: "Use the strongest candidate.".to_string(),
            }));

            let send_task = tokio::spawn({
                let sessions = Arc::clone(&sessions);
                let workspaces = Arc::clone(&workspaces);
                let app_settings = Arc::clone(&app_settings);
                let workspace_id = workspace.id.clone();
                async move {
                    send_user_message_core(
                        &sessions,
                        &workspaces,
                        &app_settings,
                        workspace_id,
                        "thread-1".to_string(),
                        "debug this".to_string(),
                        Some("gpt-5.4-mini".to_string()),
                        Some("low".to_string()),
                        None,
                        None,
                        None,
                        None,
                        None,
                        Some("auto".to_string()),
                        false,
                    )
                    .await
                }
            });

            respond_to_pending_request(&session, 0, routing_candidate_response()).await;
            respond_to_pending_request(
                &session,
                1,
                json!({ "result": { "turn": { "id": "turn-1" } } }),
            )
            .await;

            let response = send_task
                .await
                .expect("task join")
                .expect("send succeeds");
            let transcript_lines = read_transcript(&transcript);

            assert_eq!(transcript_lines.len(), 2);
            assert_eq!(transcript_lines[0]["method"].as_str(), Some("model/list"));
            assert_eq!(transcript_lines[1]["method"].as_str(), Some("turn/start"));
            assert_eq!(
                transcript_lines[1]["params"]["model"].as_str(),
                Some("gpt-5.4")
            );
            assert_eq!(
                transcript_lines[1]["params"]["effort"].as_str(),
                Some("high")
            );
            assert_eq!(
                response["result"]["routingDecision"]["selectedModel"].as_str(),
                Some("gpt-5.4")
            );
            clear_router_test_state();
            let _ = std::fs::remove_file(&transcript);
        });
    }

    #[test]
    fn send_user_message_core_routes_explicit_auto_selection_even_when_legacy_setting_is_off() {
        tokio::runtime::Runtime::new().expect("runtime").block_on(async {
            let _guard = send_routing_test_guard();
            clear_router_test_state();
            let transcript = transcript_path("auto-selection-routes-with-legacy-flag-off");
            let session = make_session_with_transcript(&transcript);
            let workspace = make_workspace_entry();
            let sessions = Arc::new(Mutex::new(HashMap::from([(workspace.id.clone(), session.clone())])));
            let workspaces =
                Arc::new(Mutex::new(HashMap::from([(workspace.id.clone(), workspace.clone())])));
            let settings = AppSettings::default();
            let app_settings = Arc::new(Mutex::new(settings));

            set_test_router_credential_result(Ok("sk-test".to_string()));
            set_test_router_result(Ok(RouterOutput {
                task_type: "editing".to_string(),
                complexity: "low".to_string(),
                ambiguity: "low".to_string(),
                needs_tools: false,
                needs_large_context: false,
                selected_model: "gpt-5.4-mini".to_string(),
                selected_reasoning: "medium".to_string(),
                confidence: 0.88,
                reason: "Use auto routing for a light task.".to_string(),
            }));

            let send_task = tokio::spawn({
                let sessions = Arc::clone(&sessions);
                let workspaces = Arc::clone(&workspaces);
                let app_settings = Arc::clone(&app_settings);
                let workspace_id = workspace.id.clone();
                async move {
                    send_user_message_core(
                        &sessions,
                        &workspaces,
                        &app_settings,
                        workspace_id,
                        "thread-1".to_string(),
                        "rename this".to_string(),
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        Some("auto".to_string()),
                        false,
                    )
                    .await
                }
            });

            respond_to_pending_request(&session, 0, routing_candidate_response()).await;
            respond_to_pending_request(
                &session,
                1,
                json!({ "result": { "turn": { "id": "turn-auto-1" } } }),
            )
            .await;

            let response = send_task
                .await
                .expect("task join")
                .expect("send succeeds");
            let transcript_lines = read_transcript(&transcript);

            assert_eq!(transcript_lines[0]["method"].as_str(), Some("model/list"));
            assert_eq!(transcript_lines[1]["method"].as_str(), Some("turn/start"));
            assert_eq!(
                transcript_lines[1]["params"]["model"].as_str(),
                Some("gpt-5.4-mini")
            );
            assert_eq!(
                response["result"]["routingDecision"]["selectedModel"].as_str(),
                Some("gpt-5.4-mini")
            );

            clear_router_test_state();
            let _ = std::fs::remove_file(&transcript);
        });
    }

    #[test]
    fn send_user_message_core_surfaces_router_parse_failure_in_metadata() {
        tokio::runtime::Runtime::new().expect("runtime").block_on(async {
            let _guard = send_routing_test_guard();
            clear_router_test_state();
            let transcript = transcript_path("router-parse-failure");
            let session = make_session_with_transcript(&transcript);
            let workspace = make_workspace_entry();
            let sessions = Arc::new(Mutex::new(HashMap::from([(workspace.id.clone(), session.clone())])));
            let workspaces = Arc::new(Mutex::new(HashMap::from([(workspace.id.clone(), workspace.clone())])));
            let mut settings = AppSettings::default();
            settings.auto_model_routing_enabled = true;
            let app_settings = Arc::new(Mutex::new(settings));

            set_test_router_credential_result(Ok("sk-test".to_string()));
            set_test_router_result(Err(
                "Failed to parse router decision JSON: bad payload".to_string(),
            ));

            let send_task = tokio::spawn({
                let sessions = Arc::clone(&sessions);
                let workspaces = Arc::clone(&workspaces);
                let app_settings = Arc::clone(&app_settings);
                let workspace_id = workspace.id.clone();
                async move {
                    send_user_message_core(
                        &sessions,
                        &workspaces,
                        &app_settings,
                        workspace_id,
                        "thread-1".to_string(),
                        "format this".to_string(),
                        Some("gpt-5.4-mini".to_string()),
                        Some("medium".to_string()),
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        false,
                    )
                    .await
                }
            });

            respond_to_pending_request(&session, 0, routing_candidate_response()).await;
            respond_to_pending_request(
                &session,
                1,
                json!({ "result": { "turn": { "id": "turn-2" } } }),
            )
            .await;

            let response = send_task
                .await
                .expect("task join")
                .expect("send succeeds");
            let routing = &response["result"]["routingDecision"];

            assert_eq!(routing["fallbackUsed"].as_bool(), Some(true));
            assert_eq!(
                routing["reason"].as_str(),
                Some("Router request failed; using deterministic fallback.")
            );
            assert!(routing["policyNote"]
                .as_str()
                .is_some_and(|value| value.contains("Failed to parse router decision JSON")));
            clear_router_test_state();
            let _ = std::fs::remove_file(&transcript);
        });
    }

    #[test]
    fn send_user_message_core_recovers_from_null_model_manual_bypass_state() {
        tokio::runtime::Runtime::new().expect("runtime").block_on(async {
            let _guard = send_routing_test_guard();
            clear_router_test_state();
            let transcript = transcript_path("null-model-manual-bypass-recovery");
            let session = make_session_with_transcript(&transcript);
            let workspace = make_workspace_entry();
            let sessions = Arc::new(Mutex::new(HashMap::from([(workspace.id.clone(), session.clone())])));
            let workspaces =
                Arc::new(Mutex::new(HashMap::from([(workspace.id.clone(), workspace.clone())])));
            let settings = AppSettings::default();
            let app_settings = Arc::new(Mutex::new(settings));

            let send_task = tokio::spawn({
                let sessions = Arc::clone(&sessions);
                let workspaces = Arc::clone(&workspaces);
                let app_settings = Arc::clone(&app_settings);
                let workspace_id = workspace.id.clone();
                async move {
                    send_user_message_core(
                        &sessions,
                        &workspaces,
                        &app_settings,
                        workspace_id,
                        "thread-1".to_string(),
                        "rename this".to_string(),
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        Some("auto".to_string()),
                        true,
                    )
                    .await
                }
            });

            respond_to_pending_request(&session, 0, routing_candidate_response()).await;
            respond_to_pending_request(
                &session,
                1,
                json!({ "result": { "turn": { "id": "turn-null-model-1" } } }),
            )
            .await;

            let response = send_task
                .await
                .expect("task join")
                .expect("send succeeds");
            let transcript_lines = read_transcript(&transcript);

            assert_eq!(transcript_lines[0]["method"].as_str(), Some("model/list"));
            assert_eq!(transcript_lines[1]["method"].as_str(), Some("turn/start"));
            assert_eq!(
                transcript_lines[1]["params"]["model"].as_str(),
                Some("gpt-5.4-mini")
            );
            assert_eq!(
                response["result"]["routingDecision"]["selectedModel"].as_str(),
                Some("gpt-5.4-mini")
            );
            assert_eq!(
                response["result"]["routingDecision"]["policyNote"].as_str(),
                Some("Recovered from a null-model send request before turn/start.")
            );

            clear_router_test_state();
            let _ = std::fs::remove_file(&transcript);
        });
    }

    #[test]
    fn send_user_message_core_surfaces_missing_router_credential_in_metadata() {
        tokio::runtime::Runtime::new().expect("runtime").block_on(async {
            let _guard = send_routing_test_guard();
            clear_router_test_state();
            let transcript = transcript_path("router-credential-missing");
            let session = make_session_with_transcript(&transcript);
            let workspace = make_workspace_entry();
            let sessions = Arc::new(Mutex::new(HashMap::from([(workspace.id.clone(), session.clone())])));
            let workspaces = Arc::new(Mutex::new(HashMap::from([(workspace.id.clone(), workspace.clone())])));
            let mut settings = AppSettings::default();
            settings.auto_model_routing_enabled = true;
            let app_settings = Arc::new(Mutex::new(settings));

            set_test_router_credential_result(Err(
                "Router credential is not configured.".to_string(),
            ));

            let send_task = tokio::spawn({
                let sessions = Arc::clone(&sessions);
                let workspaces = Arc::clone(&workspaces);
                let app_settings = Arc::clone(&app_settings);
                let workspace_id = workspace.id.clone();
                async move {
                    send_user_message_core(
                        &sessions,
                        &workspaces,
                        &app_settings,
                        workspace_id,
                        "thread-1".to_string(),
                        "help".to_string(),
                        Some("gpt-5.4-mini".to_string()),
                        Some("medium".to_string()),
                        None,
                        None,
                        None,
                        None,
                        None,
                        Some("auto".to_string()),
                        false,
                    )
                    .await
                }
            });

            respond_to_pending_request(&session, 0, routing_candidate_response()).await;
            respond_to_pending_request(
                &session,
                1,
                json!({ "result": { "turn": { "id": "turn-3" } } }),
            )
            .await;

            let response = send_task
                .await
                .expect("task join")
                .expect("send succeeds");
            let routing = &response["result"]["routingDecision"];

            assert_eq!(routing["fallbackUsed"].as_bool(), Some(true));
            assert_eq!(
                routing["reason"].as_str(),
                Some("Router credential unavailable; using deterministic fallback.")
            );
            assert_eq!(
                routing["policyNote"].as_str(),
                Some("Router credential is not configured.")
            );
            clear_router_test_state();
            let _ = std::fs::remove_file(&transcript);
        });
    }

    #[test]
    fn send_user_message_core_surfaces_invalid_router_candidate_and_falls_back() {
        tokio::runtime::Runtime::new().expect("runtime").block_on(async {
            let _guard = send_routing_test_guard();
            clear_router_test_state();
            let transcript = transcript_path("invalid-router-candidate");
            let session = make_session_with_transcript(&transcript);
            let workspace = make_workspace_entry();
            let sessions = Arc::new(Mutex::new(HashMap::from([(workspace.id.clone(), session.clone())])));
            let workspaces = Arc::new(Mutex::new(HashMap::from([(workspace.id.clone(), workspace.clone())])));
            let mut settings = AppSettings::default();
            settings.auto_model_routing_enabled = true;
            settings.auto_model_routing_mode = "responsive".to_string();
            let app_settings = Arc::new(Mutex::new(settings));

            set_test_router_credential_result(Ok("sk-test".to_string()));
            set_test_router_result(Ok(RouterOutput {
                task_type: "editing".to_string(),
                complexity: "medium".to_string(),
                ambiguity: "low".to_string(),
                needs_tools: false,
                needs_large_context: false,
                selected_model: "missing-model".to_string(),
                selected_reasoning: "high".to_string(),
                confidence: 0.7,
                reason: "Bad model".to_string(),
            }));

            let send_task = tokio::spawn({
                let sessions = Arc::clone(&sessions);
                let workspaces = Arc::clone(&workspaces);
                let app_settings = Arc::clone(&app_settings);
                let workspace_id = workspace.id.clone();
                async move {
                    send_user_message_core(
                        &sessions,
                        &workspaces,
                        &app_settings,
                        workspace_id,
                        "thread-1".to_string(),
                        "rename this".to_string(),
                        Some("gpt-5.4-mini".to_string()),
                        Some("medium".to_string()),
                        None,
                        None,
                        None,
                        None,
                        None,
                        Some("auto".to_string()),
                        false,
                    )
                    .await
                }
            });

            respond_to_pending_request(&session, 0, routing_candidate_response()).await;
            respond_to_pending_request(
                &session,
                1,
                json!({ "result": { "turn": { "id": "turn-4" } } }),
            )
            .await;

            let response = send_task
                .await
                .expect("task join")
                .expect("send succeeds");
            let transcript_lines = read_transcript(&transcript);
            let routing = &response["result"]["routingDecision"];

            assert_eq!(
                transcript_lines[1]["params"]["model"].as_str(),
                Some("gpt-5.4-mini")
            );
            assert_eq!(routing["fallbackUsed"].as_bool(), Some(true));
            assert!(routing["reason"]
                .as_str()
                .is_some_and(|value| value.contains("outside the runtime candidate list")));
            clear_router_test_state();
            let _ = std::fs::remove_file(&transcript);
        });
    }

}
