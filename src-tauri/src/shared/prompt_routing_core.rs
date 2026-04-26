use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[cfg(test)]
use std::sync::{Mutex as StdMutex, OnceLock};

use crate::types::{
    AppSettings, AutoModelRoutingCredentialInput, AutoModelRoutingCredentialStatus,
    AutoModelRoutingCredentialStorageKind, AutoModelRoutingProvider,
};

const AUTO_MODEL_ROUTING_KEYCHAIN_SERVICE: &str = "com.codexmonitor.auto-model-routing";
const OPENAI_ROUTER_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_ROUTER_MODEL: &str = "gpt-5.4-nano";
const OPENAI_ROUTER_TIMEOUT: Duration = Duration::from_secs(15);
const CHATGPT_ACCOUNT_UNSUPPORTED_MODEL_ERROR: &str =
    "model is not supported when using Codex with a ChatGPT account";
const OPENAI_ROUTER_SYSTEM_PROMPT: &str = concat!(
    "You classify prompts for CodexMonitor model routing. ",
    "Do not solve the task. ",
    "Choose only from the provided candidates. ",
    "Return strict JSON that matches the schema."
);

#[derive(Debug, Clone, PartialEq, Eq)]
enum ModelTier {
    Cheap,
    Balanced,
    Strong,
}

impl ModelTier {
    fn rank(&self) -> u8 {
        match self {
            Self::Cheap => 0,
            Self::Balanced => 1,
            Self::Strong => 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RoutingCandidate {
    model: String,
    supported_reasoning_efforts: Vec<String>,
    default_reasoning_effort: Option<String>,
    is_default: bool,
    tier: ModelTier,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoModelRoutingDecision {
    pub(crate) mode: String,
    pub(crate) provider: AutoModelRoutingProvider,
    pub(crate) selected_model: String,
    pub(crate) selected_reasoning_effort: Option<String>,
    pub(crate) fallback_used: bool,
    pub(crate) reason: String,
    pub(crate) confidence: Option<f64>,
    pub(crate) task_type: String,
    pub(crate) complexity: String,
    pub(crate) ambiguity: String,
    pub(crate) needs_tools: bool,
    pub(crate) needs_large_context: bool,
    pub(crate) policy_note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub(crate) struct RouterOutput {
    pub(crate) task_type: String,
    pub(crate) complexity: String,
    pub(crate) ambiguity: String,
    pub(crate) needs_tools: bool,
    pub(crate) needs_large_context: bool,
    pub(crate) selected_model: String,
    pub(crate) selected_reasoning: String,
    pub(crate) confidence: f64,
    pub(crate) reason: String,
}

#[cfg(test)]
static TEST_ROUTER_RESULT: OnceLock<StdMutex<Option<Result<RouterOutput, String>>>> =
    OnceLock::new();
#[cfg(test)]
static TEST_ROUTER_CREDENTIAL_RESULT: OnceLock<StdMutex<Option<Result<String, String>>>> =
    OnceLock::new();

#[derive(Debug, Clone)]
struct RouterRequestPayload {
    auto_mode: String,
    user_prompt: String,
    has_images: bool,
    has_app_mentions: bool,
    candidates: Vec<RouterRequestCandidate>,
}

#[derive(Debug, Clone, Serialize)]
struct RouterRequestCandidate {
    model: String,
    reasoning: Vec<String>,
}

pub(crate) fn get_auto_model_routing_credential_status_core(
) -> Result<AutoModelRoutingCredentialStatus, String> {
    read_auto_model_routing_credential_status(AutoModelRoutingProvider::Openai)
}

pub(crate) fn save_auto_model_routing_credential_core(
    input: AutoModelRoutingCredentialInput,
) -> Result<AutoModelRoutingCredentialStatus, String> {
    save_auto_model_routing_credential_with(
        input,
        write_auto_model_routing_credential,
        |provider| read_auto_model_routing_credential_status(provider),
    )
}

pub(crate) fn remove_auto_model_routing_credential_core(
    provider: AutoModelRoutingProvider,
) -> Result<AutoModelRoutingCredentialStatus, String> {
    remove_auto_model_routing_credential_with(
        provider,
        delete_auto_model_routing_credential,
        read_auto_model_routing_credential_status,
    )
}

pub(crate) async fn resolve_auto_model_routing_for_turn_start(
    settings: &AppSettings,
    text: &str,
    requested_model: Option<&str>,
    requested_effort: Option<&str>,
    images: Option<&[String]>,
    app_mentions: Option<&[Value]>,
    auto_model_routing_bypass: bool,
    model_list_response: &Value,
) -> Result<Option<AutoModelRoutingDecision>, String> {
    let auto_requested = requested_model
        .and_then(normalize_optional_string_ref)
        .is_none();
    if auto_model_routing_bypass
        || (!settings.auto_model_routing_enabled && !auto_requested)
    {
        return Ok(None);
    }

    let provider = normalize_provider(settings.auto_model_routing_provider.as_str())?;
    let mode = normalize_mode(settings.auto_model_routing_mode.as_str());
    let candidates = parse_model_list_candidates(model_list_response);
    if candidates.is_empty() {
        return Ok(Some(build_skipped_routing_decision(
            mode.as_str(),
            provider,
            requested_model,
            requested_effort,
            "Routing skipped because no runtime model candidates were available.".to_string(),
            Some("model/list returned no candidates.".to_string()),
        )));
    }

    let requested_model = normalize_optional_string(requested_model);
    let requested_effort = normalize_optional_string(requested_effort);
    let has_images = images.is_some_and(|items| !items.is_empty());
    let has_app_mentions = app_mentions.is_some_and(|items| !items.is_empty());

    let router_decision = match get_auto_model_routing_credential(&provider) {
        Ok(credential) => {
            let payload = RouterRequestPayload {
                auto_mode: mode.clone(),
                user_prompt: text.trim().to_string(),
                has_images,
                has_app_mentions,
                candidates: candidates
                    .iter()
                    .map(|candidate| RouterRequestCandidate {
                        model: candidate.model.clone(),
                        reasoning: candidate.supported_reasoning_efforts.clone(),
                    })
                    .collect(),
            };
            match route_prompt_with_openai(&credential, payload).await {
                Ok(output) => Some(output),
                Err(error) => {
                    let mut decision = build_fallback_decision(
                        mode.as_str(),
                        provider.clone(),
                        &candidates,
                        requested_model.as_deref(),
                        requested_effort.as_deref(),
                        "Router request failed; using deterministic fallback.".to_string(),
                    );
                    decision.policy_note = Some(error);
                    return Ok(Some(decision));
                }
            }
        }
        Err(error) => {
            let mut decision = build_fallback_decision(
                mode.as_str(),
                provider.clone(),
                &candidates,
                requested_model.as_deref(),
                requested_effort.as_deref(),
                "Router credential unavailable; using deterministic fallback.".to_string(),
            );
            decision.policy_note = Some(error);
            return Ok(Some(decision));
        }
    };

    let decision = if let Some(output) = router_decision {
        resolve_router_selection(
            mode.as_str(),
            provider.clone(),
            &candidates,
            requested_model.as_deref(),
            requested_effort.as_deref(),
            output,
        )
    } else {
        build_fallback_decision(
            mode.as_str(),
            provider,
            &candidates,
            requested_model.as_deref(),
            requested_effort.as_deref(),
            "Router unavailable; using deterministic fallback.".to_string(),
        )
    };

    Ok(Some(decision))
}

pub(crate) fn attach_auto_model_routing_decision(
    response: &mut Value,
    decision: &AutoModelRoutingDecision,
) {
    let routing_value = json!(decision);
    if let Some(root) = response.as_object_mut() {
        if let Some(result) = root.get_mut("result").and_then(Value::as_object_mut) {
            result.insert("routingDecision".to_string(), routing_value);
            return;
        }
        root.insert("routingDecision".to_string(), routing_value);
    }
}

#[cfg(target_os = "macos")]
fn read_auto_model_routing_credential_status(
    provider: AutoModelRoutingProvider,
) -> Result<AutoModelRoutingCredentialStatus, String> {
    read_keyring_credential_status(provider)
}

#[cfg(any(target_os = "ios", target_os = "windows", target_os = "linux"))]
fn read_auto_model_routing_credential_status(
    provider: AutoModelRoutingProvider,
) -> Result<AutoModelRoutingCredentialStatus, String> {
    read_keyring_credential_status(provider)
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux"
)))]
fn read_auto_model_routing_credential_status(
    provider: AutoModelRoutingProvider,
) -> Result<AutoModelRoutingCredentialStatus, String> {
    Ok(AutoModelRoutingCredentialStatus {
        provider,
        configured: false,
        storage_kind: AutoModelRoutingCredentialStorageKind::Unsupported,
        storage_supported: false,
        message: Some(
            "Secure router credential storage is not available on this backend host.".to_string(),
        ),
    })
}

#[cfg(target_os = "macos")]
fn write_auto_model_routing_credential(
    provider: &AutoModelRoutingProvider,
    credential: &str,
) -> Result<(), String> {
    write_keyring_credential(provider, credential)
}

#[cfg(any(target_os = "ios", target_os = "windows", target_os = "linux"))]
fn write_auto_model_routing_credential(
    provider: &AutoModelRoutingProvider,
    credential: &str,
) -> Result<(), String> {
    write_keyring_credential(provider, credential)
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux"
)))]
fn write_auto_model_routing_credential(
    _provider: &AutoModelRoutingProvider,
    _credential: &str,
) -> Result<(), String> {
    Err("Secure router credential storage is not available on this backend host.".to_string())
}

#[cfg(target_os = "macos")]
fn delete_auto_model_routing_credential(provider: &AutoModelRoutingProvider) -> Result<(), String> {
    delete_keyring_credential(provider)
}

#[cfg(any(target_os = "ios", target_os = "windows", target_os = "linux"))]
fn delete_auto_model_routing_credential(provider: &AutoModelRoutingProvider) -> Result<(), String> {
    delete_keyring_credential(provider)
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux"
)))]
fn delete_auto_model_routing_credential(
    _provider: &AutoModelRoutingProvider,
) -> Result<(), String> {
    Err("Secure router credential storage is not available on this backend host.".to_string())
}

fn auto_model_routing_account_name(provider: &AutoModelRoutingProvider) -> &'static str {
    provider.as_str()
}

fn save_auto_model_routing_credential_with<WriteFn, ReadFn>(
    input: AutoModelRoutingCredentialInput,
    write_credential: WriteFn,
    read_status: ReadFn,
) -> Result<AutoModelRoutingCredentialStatus, String>
where
    WriteFn: FnOnce(&AutoModelRoutingProvider, &str) -> Result<(), String>,
    ReadFn: FnOnce(AutoModelRoutingProvider) -> Result<AutoModelRoutingCredentialStatus, String>,
{
    let credential = input.credential.trim();
    if credential.is_empty() {
        return Err("Router credential cannot be empty.".to_string());
    }
    write_credential(&input.provider, credential)?;
    read_status(input.provider)
}

fn remove_auto_model_routing_credential_with<DeleteFn, ReadFn>(
    provider: AutoModelRoutingProvider,
    delete_credential: DeleteFn,
    read_status: ReadFn,
) -> Result<AutoModelRoutingCredentialStatus, String>
where
    DeleteFn: FnOnce(&AutoModelRoutingProvider) -> Result<(), String>,
    ReadFn: FnOnce(AutoModelRoutingProvider) -> Result<AutoModelRoutingCredentialStatus, String>,
{
    delete_credential(&provider)?;
    read_status(provider)
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_mode(value: &str) -> String {
    match value.trim() {
        "cost-efficient" => "cost-efficient".to_string(),
        "genius" => "genius".to_string(),
        _ => "responsive".to_string(),
    }
}

fn normalize_provider(value: &str) -> Result<AutoModelRoutingProvider, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "openai" => Ok(AutoModelRoutingProvider::Openai),
        _ => Err("Unsupported auto model routing provider.".to_string()),
    }
}

pub(crate) fn build_skipped_routing_decision(
    mode: &str,
    provider: AutoModelRoutingProvider,
    requested_model: Option<&str>,
    requested_effort: Option<&str>,
    reason: String,
    policy_note: Option<String>,
) -> AutoModelRoutingDecision {
    AutoModelRoutingDecision {
        mode: mode.to_string(),
        provider,
        selected_model: requested_model
            .and_then(normalize_optional_string_ref)
            .unwrap_or("unknown")
            .to_string(),
        selected_reasoning_effort: requested_effort
            .and_then(normalize_optional_string_ref)
            .map(ToString::to_string),
        fallback_used: true,
        reason,
        confidence: None,
        task_type: "fallback".to_string(),
        complexity: "unknown".to_string(),
        ambiguity: "unknown".to_string(),
        needs_tools: false,
        needs_large_context: false,
        policy_note,
    }
}

pub(crate) fn is_chatgpt_account_unsupported_model_error(error: &str) -> bool {
    error
        .trim()
        .to_ascii_lowercase()
        .contains(CHATGPT_ACCOUNT_UNSUPPORTED_MODEL_ERROR)
}

pub(crate) fn build_chatgpt_account_retry_decision(
    settings: &AppSettings,
    requested_model: Option<&str>,
    requested_effort: Option<&str>,
    rejected_model: Option<&str>,
    model_list_response: &Value,
) -> Option<AutoModelRoutingDecision> {
    let provider = normalize_provider(settings.auto_model_routing_provider.as_str()).ok()?;
    let mode = normalize_mode(settings.auto_model_routing_mode.as_str());
    let rejected_model = rejected_model.and_then(normalize_optional_string_ref);
    let candidates = parse_model_list_candidates(model_list_response);
    let filtered_candidates = candidates
        .into_iter()
        .filter(|candidate| {
            let is_rejected = rejected_model.is_some_and(|value| value == candidate.model);
            !is_rejected
        })
        .collect::<Vec<_>>();
    if filtered_candidates.is_empty() {
        return None;
    }
    let mut decision = build_fallback_decision(
        mode.as_str(),
        provider,
        &filtered_candidates,
        requested_model,
        requested_effort,
        "Selected model was not supported for this ChatGPT account; retried with fallback."
            .to_string(),
    );
    decision.policy_note = rejected_model.map(|model| {
        format!(
            "Retrying turn/start after ChatGPT-account model rejection for {model}."
        )
    });
    Some(decision)
}

pub(crate) fn build_runtime_fallback_routing_decision(
    settings: &AppSettings,
    requested_model: Option<&str>,
    requested_effort: Option<&str>,
    model_list_response: &Value,
    reason: String,
    policy_note: Option<String>,
) -> Option<AutoModelRoutingDecision> {
    let provider = normalize_provider(settings.auto_model_routing_provider.as_str()).ok()?;
    let mode = normalize_mode(settings.auto_model_routing_mode.as_str());
    let candidates = parse_model_list_candidates(model_list_response);
    if candidates.is_empty() {
        return None;
    }
    let mut decision = build_fallback_decision(
        mode.as_str(),
        provider,
        &candidates,
        requested_model,
        requested_effort,
        reason,
    );
    decision.policy_note = policy_note;
    Some(decision)
}

fn parse_model_list_candidates(response: &Value) -> Vec<RoutingCandidate> {
    extract_model_items(response)
        .into_iter()
        .filter_map(parse_model_candidate)
        .collect()
}

fn extract_model_items(response: &Value) -> Vec<&Value> {
    let Some(root) = response.as_object() else {
        return Vec::new();
    };

    if let Some(items) = root
        .get("result")
        .and_then(Value::as_object)
        .and_then(|result| result.get("data"))
        .and_then(Value::as_array)
    {
        return items.iter().collect();
    }

    root.get("data")
        .and_then(Value::as_array)
        .map(|items| items.iter().collect())
        .unwrap_or_default()
}

fn parse_model_candidate(item: &Value) -> Option<RoutingCandidate> {
    let record = item.as_object()?;
    let model = record
        .get("model")
        .or_else(|| record.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    if is_filtered_routing_model(model.as_str()) {
        return None;
    }
    let default_reasoning_effort = normalize_optional_string(
        record
            .get("defaultReasoningEffort")
            .or_else(|| record.get("default_reasoning_effort"))
            .and_then(Value::as_str),
    );
    let supported_reasoning_efforts = parse_supported_reasoning_efforts(record);
    Some(RoutingCandidate {
        tier: infer_model_tier(&model),
        model,
        supported_reasoning_efforts,
        default_reasoning_effort,
        is_default: record
            .get("isDefault")
            .or_else(|| record.get("is_default"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn is_filtered_routing_model(model: &str) -> bool {
    matches!(model.trim().to_ascii_lowercase().as_str(), "gpt-5.1-codex-max")
}

fn parse_supported_reasoning_efforts(
    record: &serde_json::Map<String, Value>,
) -> Vec<String> {
    record
        .get("supportedReasoningEfforts")
        .or_else(|| record.get("supported_reasoning_efforts"))
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    entry.as_object().and_then(|object| {
                        normalize_optional_string(
                            object
                                .get("reasoningEffort")
                                .or_else(|| object.get("reasoning_effort"))
                                .and_then(Value::as_str),
                        )
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn infer_model_tier(model: &str) -> ModelTier {
    let normalized = model.trim().to_ascii_lowercase();
    if normalized.contains("nano") {
        return ModelTier::Cheap;
    }
    if normalized.contains("mini") {
        return ModelTier::Balanced;
    }
    ModelTier::Strong
}

fn mode_max_tier(mode: &str) -> ModelTier {
    match mode {
        "cost-efficient" => ModelTier::Cheap,
        "responsive" => ModelTier::Balanced,
        _ => ModelTier::Strong,
    }
}

fn mode_default_effort(mode: &str) -> Option<&'static str> {
    match mode {
        "cost-efficient" => Some("low"),
        "genius" => Some("medium"),
        _ => Some("low"),
    }
}

fn mode_max_effort_rank(mode: &str) -> u8 {
    match mode {
        "cost-efficient" => effort_rank("medium"),
        "genius" => effort_rank("high"),
        _ => effort_rank("low"),
    }
}

fn effort_rank(value: &str) -> u8 {
    match value.trim().to_ascii_lowercase().as_str() {
        "none" => 0,
        "low" => 1,
        "medium" => 2,
        "high" => 3,
        "xhigh" => 4,
        _ => u8::MAX,
    }
}

fn build_fallback_decision(
    mode: &str,
    provider: AutoModelRoutingProvider,
    candidates: &[RoutingCandidate],
    requested_model: Option<&str>,
    requested_effort: Option<&str>,
    reason: String,
) -> AutoModelRoutingDecision {
    let candidate = select_fallback_candidate(candidates, requested_model)
        .or_else(|| candidates.first())
        .expect("fallback requires at least one candidate");
    let selected_reasoning_effort =
        resolve_fallback_effort(candidate, requested_effort, mode_default_effort(mode));

    AutoModelRoutingDecision {
        mode: mode.to_string(),
        provider,
        selected_model: candidate.model.clone(),
        selected_reasoning_effort,
        fallback_used: true,
        reason,
        confidence: None,
        task_type: "fallback".to_string(),
        complexity: "unknown".to_string(),
        ambiguity: "unknown".to_string(),
        needs_tools: false,
        needs_large_context: false,
        policy_note: None,
    }
}

fn select_fallback_candidate<'a>(
    candidates: &'a [RoutingCandidate],
    requested_model: Option<&str>,
) -> Option<&'a RoutingCandidate> {
    if let Some(requested_model) = requested_model.and_then(normalize_optional_string_ref) {
        if let Some(candidate) = candidates
            .iter()
            .find(|candidate| candidate.model == requested_model)
        {
            return Some(candidate);
        }
    }
    candidates
        .iter()
        .find(|candidate| candidate.is_default)
        .or_else(|| candidates.first())
}

fn normalize_optional_string_ref(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

fn resolve_fallback_effort(
    candidate: &RoutingCandidate,
    requested_effort: Option<&str>,
    mode_default_effort: Option<&str>,
) -> Option<String> {
    let requested_effort = requested_effort.and_then(normalize_optional_string_ref);
    if let Some(requested_effort) = requested_effort {
        if candidate
            .supported_reasoning_efforts
            .iter()
            .any(|effort| effort == requested_effort)
        {
            return Some(requested_effort.to_string());
        }
    }

    if let Some(default_effort) = candidate.default_reasoning_effort.as_ref() {
        if candidate
            .supported_reasoning_efforts
            .iter()
            .any(|effort| effort == default_effort)
        {
            return Some(default_effort.clone());
        }
    }

    if let Some(mode_default_effort) = mode_default_effort {
        if candidate
            .supported_reasoning_efforts
            .iter()
            .any(|effort| effort == mode_default_effort)
        {
            return Some(mode_default_effort.to_string());
        }
    }

    candidate.supported_reasoning_efforts.first().cloned()
}

fn resolve_router_selection(
    mode: &str,
    provider: AutoModelRoutingProvider,
    candidates: &[RoutingCandidate],
    requested_model: Option<&str>,
    requested_effort: Option<&str>,
    output: RouterOutput,
) -> AutoModelRoutingDecision {
    let mut policy_note = None;
    let mut fallback_used = false;

    let Some(router_candidate) = candidates
        .iter()
        .find(|candidate| candidate.model == output.selected_model.trim())
    else {
        return build_fallback_decision(
            mode,
            provider,
            candidates,
            requested_model,
            requested_effort,
            "Router returned a model outside the runtime candidate list; using fallback."
                .to_string(),
        );
    };

    let final_candidate = enforce_mode_tier_policy(mode, candidates, router_candidate);
    if final_candidate.model != router_candidate.model {
        policy_note = Some(format!(
            "Mode policy downgraded router selection from {} to {}.",
            router_candidate.model, final_candidate.model
        ));
        fallback_used = true;
    }

    let selected_reasoning_effort =
        resolve_router_effort(final_candidate, output.selected_reasoning.as_str(), mode);

    AutoModelRoutingDecision {
        mode: mode.to_string(),
        provider,
        selected_model: final_candidate.model.clone(),
        selected_reasoning_effort,
        fallback_used,
        reason: output.reason.trim().to_string(),
        confidence: Some(output.confidence),
        task_type: output.task_type.trim().to_string(),
        complexity: output.complexity.trim().to_string(),
        ambiguity: output.ambiguity.trim().to_string(),
        needs_tools: output.needs_tools,
        needs_large_context: output.needs_large_context,
        policy_note,
    }
}

fn enforce_mode_tier_policy<'a>(
    mode: &str,
    candidates: &'a [RoutingCandidate],
    selected: &'a RoutingCandidate,
) -> &'a RoutingCandidate {
    let max_tier = mode_max_tier(mode);
    if selected.tier.rank() <= max_tier.rank() {
        return selected;
    }

    candidates
        .iter()
        .filter(|candidate| candidate.tier.rank() <= max_tier.rank())
        .max_by_key(|candidate| candidate.tier.rank())
        .unwrap_or(selected)
}

fn resolve_router_effort(
    candidate: &RoutingCandidate,
    requested_effort: &str,
    mode: &str,
) -> Option<String> {
    let max_rank = mode_max_effort_rank(mode);
    let requested_effort = normalize_optional_string_ref(requested_effort);
    if let Some(requested_effort) = requested_effort {
        if effort_rank(requested_effort) <= max_rank
            && candidate
                .supported_reasoning_efforts
                .iter()
                .any(|effort| effort == requested_effort)
        {
            return Some(requested_effort.to_string());
        }
    }

    if let Some(default_effort) = candidate.default_reasoning_effort.as_ref() {
        if effort_rank(default_effort) <= max_rank
            && candidate
                .supported_reasoning_efforts
                .iter()
                .any(|effort| effort == default_effort)
        {
            return Some(default_effort.clone());
        }
    }

    if let Some(mode_default_effort) = mode_default_effort(mode) {
        if effort_rank(mode_default_effort) <= max_rank
            && candidate
                .supported_reasoning_efforts
                .iter()
                .any(|effort| effort == mode_default_effort)
        {
            return Some(mode_default_effort.to_string());
        }
    }

    candidate
        .supported_reasoning_efforts
        .iter()
        .filter(|effort| effort_rank(effort.as_str()) <= max_rank)
        .min_by(|left, right| {
            effort_rank(left.as_str()).cmp(&effort_rank(right.as_str()))
        })
        .cloned()
}

async fn route_prompt_with_openai(
    credential: &str,
    payload: RouterRequestPayload,
) -> Result<RouterOutput, String> {
    #[cfg(test)]
    if let Some(result) = take_test_router_result() {
        return result;
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(OPENAI_ROUTER_TIMEOUT)
        .build()
        .map_err(|error| format!("Failed to initialize auto-routing client: {error}"))?;
    let request_body = build_openai_request_body(payload)?;
    let response = client
        .post(OPENAI_ROUTER_URL)
        .header(AUTHORIZATION, format!("Bearer {}", credential.trim()))
        .header(CONTENT_TYPE, "application/json")
        .body(request_body)
        .send()
        .await
        .map_err(|error| format!("Auto-routing request failed: {error}"))?;
    let status = response.status();
    let body = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read auto-routing response: {error}"))?;
    let value: Value = serde_json::from_slice(&body)
        .map_err(|error| format!("Failed to parse auto-routing response JSON: {error}"))?;
    if !status.is_success() {
        let error_message = extract_openai_error_message(&value)
            .unwrap_or_else(|| format!("OpenAI router request failed with status {}", status));
        return Err(error_message);
    }
    let text_candidates = extract_response_text_candidates(&value)?;
    let mut last_error = None;
    for text in text_candidates {
        match parse_router_output(text.as_str()) {
            Ok(output) => return Ok(output),
            Err(error) => last_error = Some(error),
        }
    }
    Err(format!(
        "Failed to parse router decision JSON: {}",
        last_error.unwrap_or_else(|| {
            serde_json::Error::io(std::io::Error::other(
                "router output did not contain valid JSON",
            ))
        })
    ))
}

fn build_openai_request_body(payload: RouterRequestPayload) -> Result<String, String> {
    let payload_json = serde_json::to_string(&json!({
        "auto_mode": payload.auto_mode,
        "user_prompt": payload.user_prompt,
        "has_images": payload.has_images,
        "has_app_mentions": payload.has_app_mentions,
        "candidates": payload.candidates,
    }))
    .map_err(|error| format!("Failed to encode auto-routing payload: {error}"))?;

    serde_json::to_string(&json!({
        "model": OPENAI_ROUTER_MODEL,
        "input": [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": OPENAI_ROUTER_SYSTEM_PROMPT
                    }
                ]
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": payload_json
                    }
                ]
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "codex_monitor_prompt_route",
                "strict": true,
                "schema": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "task_type": { "type": "string" },
                        "complexity": { "type": "string", "enum": ["low", "medium", "high"] },
                        "ambiguity": { "type": "string", "enum": ["low", "medium", "high"] },
                        "needs_tools": { "type": "boolean" },
                        "needs_large_context": { "type": "boolean" },
                        "selected_model": { "type": "string" },
                        "selected_reasoning": { "type": "string" },
                        "confidence": { "type": "number" },
                        "reason": { "type": "string" }
                    },
                    "required": [
                        "task_type",
                        "complexity",
                        "ambiguity",
                        "needs_tools",
                        "needs_large_context",
                        "selected_model",
                        "selected_reasoning",
                        "confidence",
                        "reason"
                    ]
                }
            }
        }
    }))
    .map_err(|error| format!("Failed to encode OpenAI router request: {error}"))
}

fn extract_openai_error_message(value: &Value) -> Option<String> {
    value
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(|message| message.trim().to_string())
        .filter(|message| !message.is_empty())
}

fn push_text_fragment(parts: &mut Vec<String>, text: &str) {
    let trimmed = text.trim();
    if !trimmed.is_empty() {
        parts.push(trimmed.to_string());
    }
}

fn push_unique_text(parts: &mut Vec<String>, text: String) {
    if !parts.iter().any(|existing| existing == &text) {
        parts.push(text);
    }
}

fn extract_supported_text_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Object(object) => {
            if let Some(text) = object.get("text").and_then(extract_supported_text_value) {
                return Some(text);
            }
            object
                .get("value")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        }
        _ => None,
    }
}

fn extract_output_text_candidate(value: &Value) -> Option<String> {
    match value {
        Value::String(_) | Value::Object(_) => extract_supported_text_value(value),
        Value::Array(values) => {
            let mut parts = Vec::new();
            for item in values {
                if let Some(text) = extract_supported_text_value(item) {
                    push_text_fragment(&mut parts, text.as_str());
                    continue;
                }
                if let Some(text) = item.get("text").and_then(extract_supported_text_value) {
                    push_text_fragment(&mut parts, text.as_str());
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
        _ => None,
    }
}

fn extract_output_item_candidate(value: &Value) -> Option<String> {
    let object = value.as_object()?;

    if let Some(content) = object.get("content").and_then(Value::as_array) {
        let mut parts = Vec::new();
        for item in content {
            if let Some(text) = item.get("text").and_then(extract_supported_text_value) {
                push_text_fragment(&mut parts, text.as_str());
            }
        }
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }

    object.get("text").and_then(extract_supported_text_value)
}

fn extract_response_text_candidates(value: &Value) -> Result<Vec<String>, String> {
    let mut parts = Vec::new();

    if let Some(output_text) = value.get("output_text") {
        if let Some(text) = extract_output_text_candidate(output_text) {
            push_unique_text(&mut parts, text);
        }
    }

    if let Some(output) = value.get("output").and_then(Value::as_array) {
        for item in output {
            if let Some(text) = extract_output_item_candidate(item) {
                push_unique_text(&mut parts, text);
            }
        }
    }

    if parts.is_empty() {
        Err("Auto-routing response did not contain output text.".to_string())
    } else {
        Ok(parts)
    }
}

#[cfg(test)]
fn extract_response_text(value: &Value) -> Result<String, String> {
    extract_response_text_candidates(value)?
        .into_iter()
        .next()
        .ok_or_else(|| "Auto-routing response did not contain output text.".to_string())
}

fn strip_markdown_code_fence(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let mut lines: Vec<&str> = trimmed.lines().collect();
    if lines.len() < 3 {
        return None;
    }
    let first = lines.first()?.trim();
    let last = lines.last()?.trim();
    if !first.starts_with("```") || !last.starts_with("```") {
        return None;
    }
    lines.remove(0);
    lines.pop();
    let candidate = lines.join("\n").trim().to_string();
    if candidate.is_empty() {
        None
    } else {
        Some(candidate)
    }
}

fn router_output_schema_matches(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };

    object.get("task_type").and_then(Value::as_str).is_some()
        && object.get("complexity").and_then(Value::as_str).is_some()
        && object.get("ambiguity").and_then(Value::as_str).is_some()
        && object.get("needs_tools").and_then(Value::as_bool).is_some()
        && object
            .get("needs_large_context")
            .and_then(Value::as_bool)
            .is_some()
        && object.get("selected_model").and_then(Value::as_str).is_some()
        && object
            .get("selected_reasoning")
            .and_then(Value::as_str)
            .is_some()
        && object.get("confidence").and_then(Value::as_f64).is_some()
        && object.get("reason").and_then(Value::as_str).is_some()
}

fn extract_router_json_object(text: &str) -> Option<String> {
    let mut start = None;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escape = false;

    for (index, ch) in text.char_indices() {
        if in_string {
            if escape {
                escape = false;
                continue;
            }
            match ch {
                '\\' => escape = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => {
                if depth == 0 {
                    start = Some(index);
                }
                depth += 1;
            }
            '}' => {
                if depth == 0 {
                    continue;
                }
                depth -= 1;
                if depth == 0 {
                    let start = start?;
                    let candidate = &text[start..=index];
                    if let Ok(value) = serde_json::from_str::<Value>(candidate) {
                        if router_output_schema_matches(&value) {
                            return Some(candidate.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    None
}

fn parse_router_output(text: &str) -> Result<RouterOutput, serde_json::Error> {
    let trimmed = text.trim();
    let mut candidates = vec![trimmed.to_string()];

    if let Some(fenced) = strip_markdown_code_fence(trimmed) {
        if !candidates.iter().any(|candidate| candidate == &fenced) {
            candidates.push(fenced);
        }
    }

    // Recovery order is deliberate: prefer strict JSON first, then fenced JSON,
    // then a schema-shaped object extracted from prose-wrapped output.
    if let Some(json_object) = extract_router_json_object(trimmed) {
        if !candidates.iter().any(|candidate| candidate == &json_object) {
            candidates.push(json_object);
        }
    }

    let mut last_error = None;
    for candidate in candidates {
        match serde_json::from_str::<RouterOutput>(candidate.as_str()) {
            Ok(parsed) => return Ok(parsed),
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| {
        serde_json::Error::io(std::io::Error::other(
            "router output did not contain valid JSON",
        ))
    }))
}

#[cfg(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux"
))]
fn get_auto_model_routing_credential(
    provider: &AutoModelRoutingProvider,
) -> Result<String, String> {
    #[cfg(test)]
    if let Some(result) = take_test_router_credential_result() {
        return result;
    }
    match build_keyring_entry(provider)?.get_password() {
        Ok(credential) => {
            let credential = credential.trim().to_string();
            if credential.is_empty() {
                Err("Router credential is empty.".to_string())
            } else {
                Ok(credential)
            }
        }
        Err(keyring::Error::NoEntry) => Err("Router credential is not configured.".to_string()),
        Err(error) => Err(format!(
            "Failed to read router credential from the OS credential store: {error}"
        )),
    }
}

#[cfg(test)]
pub(crate) fn set_test_router_result(result: Result<RouterOutput, String>) {
    let store = TEST_ROUTER_RESULT.get_or_init(|| StdMutex::new(None));
    *store.lock().expect("router test lock") = Some(result);
}

#[cfg(test)]
pub(crate) fn clear_test_router_result() {
    if let Some(store) = TEST_ROUTER_RESULT.get() {
        *store.lock().expect("router test lock") = None;
    }
}

#[cfg(test)]
fn take_test_router_result() -> Option<Result<RouterOutput, String>> {
    TEST_ROUTER_RESULT
        .get()
        .and_then(|store| store.lock().ok().and_then(|mut guard| guard.take()))
}

#[cfg(test)]
pub(crate) fn set_test_router_credential_result(result: Result<String, String>) {
    let store = TEST_ROUTER_CREDENTIAL_RESULT.get_or_init(|| StdMutex::new(None));
    *store.lock().expect("router credential test lock") = Some(result);
}

#[cfg(test)]
pub(crate) fn clear_test_router_credential_result() {
    if let Some(store) = TEST_ROUTER_CREDENTIAL_RESULT.get() {
        *store.lock().expect("router credential test lock") = None;
    }
}

#[cfg(test)]
fn take_test_router_credential_result() -> Option<Result<String, String>> {
    TEST_ROUTER_CREDENTIAL_RESULT
        .get()
        .and_then(|store| store.lock().ok().and_then(|mut guard| guard.take()))
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux"
)))]
fn get_auto_model_routing_credential(
    _provider: &AutoModelRoutingProvider,
) -> Result<String, String> {
    Err("Secure router credential storage is not available on this backend host.".to_string())
}

#[cfg(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux"
))]
fn read_keyring_credential_status(
    provider: AutoModelRoutingProvider,
) -> Result<AutoModelRoutingCredentialStatus, String> {
    match build_keyring_entry(&provider)?.get_password() {
        Ok(_) => Ok(configured_keyring_status(
            provider,
            "Stored in the OS credential store on the backend host.".to_string(),
        )),
        Err(keyring::Error::NoEntry) => Ok(unconfigured_keyring_status(
            provider,
            true,
            "No router credential is stored on the backend host.".to_string(),
        )),
        Err(error) => map_keyring_read_error(provider, error),
    }
}

#[cfg(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux"
))]
fn write_keyring_credential(
    provider: &AutoModelRoutingProvider,
    credential: &str,
) -> Result<(), String> {
    build_keyring_entry(provider)?
        .set_password(credential)
        .map_err(|error| {
            format!("Failed to store router credential in the OS credential store: {error}")
        })
}

#[cfg(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux"
))]
fn delete_keyring_credential(provider: &AutoModelRoutingProvider) -> Result<(), String> {
    match build_keyring_entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove router credential from the OS credential store: {error}"
        )),
    }
}

#[cfg(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux"
))]
fn build_keyring_entry(provider: &AutoModelRoutingProvider) -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        AUTO_MODEL_ROUTING_KEYCHAIN_SERVICE,
        auto_model_routing_account_name(provider),
    )
    .map_err(|error| format!("Failed to initialize the OS credential store entry: {error}"))
}

fn configured_keyring_status(
    provider: AutoModelRoutingProvider,
    message: String,
) -> AutoModelRoutingCredentialStatus {
    AutoModelRoutingCredentialStatus {
        provider,
        configured: true,
        storage_kind: AutoModelRoutingCredentialStorageKind::OsKeyring,
        storage_supported: true,
        message: Some(message),
    }
}

fn unconfigured_keyring_status(
    provider: AutoModelRoutingProvider,
    storage_supported: bool,
    message: String,
) -> AutoModelRoutingCredentialStatus {
    AutoModelRoutingCredentialStatus {
        provider,
        configured: false,
        storage_kind: if storage_supported {
            AutoModelRoutingCredentialStorageKind::OsKeyring
        } else {
            AutoModelRoutingCredentialStorageKind::Unsupported
        },
        storage_supported,
        message: Some(message),
    }
}

#[cfg(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "windows",
    target_os = "linux"
))]
fn map_keyring_read_error(
    provider: AutoModelRoutingProvider,
    error: keyring::Error,
) -> Result<AutoModelRoutingCredentialStatus, String> {
    match error {
        keyring::Error::NoStorageAccess(error) => Ok(unconfigured_keyring_status(
            provider,
            true,
            format!(
                "The OS credential store on the backend host is unavailable or locked: {error}"
            ),
        )),
        keyring::Error::PlatformFailure(error) => Ok(unconfigured_keyring_status(
            provider,
            true,
            format!("The OS credential store on the backend host could not be accessed: {error}"),
        )),
        error => Err(format!(
            "Failed to read router credential from the OS credential store: {error}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        attach_auto_model_routing_decision, build_chatgpt_account_retry_decision,
        build_fallback_decision, extract_response_text, extract_response_text_candidates,
        map_keyring_read_error, parse_model_list_candidates, parse_router_output,
        remove_auto_model_routing_credential_with, resolve_router_selection,
        save_auto_model_routing_credential_with, AutoModelRoutingCredentialInput,
        AutoModelRoutingCredentialStatus, AutoModelRoutingCredentialStorageKind,
        AutoModelRoutingDecision, AutoModelRoutingProvider, RouterOutput,
    };
    use crate::types::AppSettings;
    use serde_json::json;
    use std::cell::RefCell;
    use std::io;

    fn configured_status() -> AutoModelRoutingCredentialStatus {
        AutoModelRoutingCredentialStatus {
            provider: AutoModelRoutingProvider::Openai,
            configured: true,
            storage_kind: AutoModelRoutingCredentialStorageKind::OsKeyring,
            storage_supported: true,
            message: Some("configured".to_string()),
        }
    }

    fn candidate_response() -> serde_json::Value {
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
                        "supported_reasoning_efforts": [
                            { "reasoning_effort": "medium", "description": "" },
                            { "reasoning_effort": "high", "description": "" }
                        ],
                        "default_reasoning_effort": "high",
                        "is_default": false
                    }
                ]
            }
        })
    }

    #[test]
    fn save_auto_model_routing_credential_rejects_blank_credentials() {
        let result = save_auto_model_routing_credential_with(
            AutoModelRoutingCredentialInput {
                provider: AutoModelRoutingProvider::Openai,
                credential: "   ".to_string(),
            },
            |_, _| Ok(()),
            |_| Ok(configured_status()),
        );

        assert_eq!(
            result.unwrap_err(),
            "Router credential cannot be empty.".to_string()
        );
    }

    #[test]
    fn save_auto_model_routing_credential_trims_before_writing() {
        let written = RefCell::new(None::<String>);

        let result = save_auto_model_routing_credential_with(
            AutoModelRoutingCredentialInput {
                provider: AutoModelRoutingProvider::Openai,
                credential: "  sk-test  ".to_string(),
            },
            |provider, credential| {
                assert_eq!(*provider, AutoModelRoutingProvider::Openai);
                *written.borrow_mut() = Some(credential.to_string());
                Ok(())
            },
            |_| Ok(configured_status()),
        )
        .expect("save succeeds");

        assert_eq!(written.borrow().as_deref(), Some("sk-test"));
        assert!(result.configured);
    }

    #[test]
    fn remove_auto_model_routing_credential_reads_status_after_delete() {
        let deleted = RefCell::new(false);

        let result = remove_auto_model_routing_credential_with(
            AutoModelRoutingProvider::Openai,
            |provider| {
                assert_eq!(*provider, AutoModelRoutingProvider::Openai);
                *deleted.borrow_mut() = true;
                Ok(())
            },
            |provider| {
                assert_eq!(provider, AutoModelRoutingProvider::Openai);
                Ok(AutoModelRoutingCredentialStatus {
                    provider,
                    configured: false,
                    storage_kind: AutoModelRoutingCredentialStorageKind::OsKeyring,
                    storage_supported: true,
                    message: Some("deleted".to_string()),
                })
            },
        )
        .expect("remove succeeds");

        assert!(*deleted.borrow());
        assert!(!result.configured);
    }

    #[test]
    fn parse_model_list_candidates_handles_camel_and_snake_case() {
        let candidates = parse_model_list_candidates(&candidate_response());

        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].model, "gpt-5.4-mini");
        assert_eq!(
            candidates[0].supported_reasoning_efforts,
            vec!["low".to_string(), "medium".to_string()]
        );
        assert_eq!(candidates[1].default_reasoning_effort.as_deref(), Some("high"));
    }

    #[test]
    fn parse_model_list_candidates_filters_chatgpt_unsupported_codex_max() {
        let response = json!({
            "result": {
                "data": [
                    {
                        "id": "gpt-5.1-codex-max",
                        "model": "gpt-5.1-codex-max",
                        "supportedReasoningEfforts": [
                            { "reasoningEffort": "medium", "description": "" }
                        ],
                        "defaultReasoningEffort": "medium",
                        "isDefault": false
                    },
                    {
                        "id": "gpt-5.1-codex",
                        "model": "gpt-5.1-codex",
                        "supportedReasoningEfforts": [
                            { "reasoningEffort": "medium", "description": "" }
                        ],
                        "defaultReasoningEffort": "medium",
                        "isDefault": true
                    }
                ]
            }
        });

        let candidates = parse_model_list_candidates(&response);

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].model, "gpt-5.1-codex");
    }

    #[test]
    fn chatgpt_account_retry_prefers_requested_supported_model() {
        let mut settings = AppSettings::default();
        settings.auto_model_routing_mode = "genius".to_string();

        let decision = build_chatgpt_account_retry_decision(
            &settings,
            Some("gpt-5.4-mini"),
            Some("medium"),
            Some("gpt-5.4"),
            &candidate_response(),
        )
        .expect("retry decision");

        assert_eq!(decision.selected_model, "gpt-5.4-mini");
        assert_eq!(decision.selected_reasoning_effort.as_deref(), Some("medium"));
        assert!(decision.fallback_used);
        assert!(decision
            .reason
            .contains("Selected model was not supported for this ChatGPT account"));
    }

    #[test]
    fn fallback_prefers_requested_model_when_valid() {
        let candidates = parse_model_list_candidates(&candidate_response());
        let decision = build_fallback_decision(
            "cost-efficient",
            AutoModelRoutingProvider::Openai,
            &candidates,
            Some("gpt-5.4"),
            Some("medium"),
            "fallback".to_string(),
        );

        assert_eq!(decision.selected_model, "gpt-5.4");
        assert_eq!(decision.selected_reasoning_effort.as_deref(), Some("medium"));
        assert!(decision.fallback_used);
    }

    #[test]
    fn router_selection_downgrades_strong_model_in_responsive_mode() {
        let candidates = parse_model_list_candidates(&candidate_response());
        let decision = resolve_router_selection(
            "responsive",
            AutoModelRoutingProvider::Openai,
            &candidates,
            Some("gpt-5.4"),
            Some("high"),
            RouterOutput {
                task_type: "debugging".to_string(),
                complexity: "high".to_string(),
                ambiguity: "medium".to_string(),
                needs_tools: true,
                needs_large_context: true,
                selected_model: "gpt-5.4".to_string(),
                selected_reasoning: "high".to_string(),
                confidence: 0.92,
                reason: "Needs tools.".to_string(),
            },
        );

        assert_eq!(decision.selected_model, "gpt-5.4-mini");
        assert_eq!(decision.selected_reasoning_effort.as_deref(), Some("low"));
        assert!(decision.fallback_used);
        assert!(decision.policy_note.is_some());
    }

    #[test]
    fn attach_auto_model_routing_decision_writes_into_result_object() {
        let mut response = json!({
            "result": {
                "turn": {
                    "id": "turn-1"
                }
            }
        });
        let decision = AutoModelRoutingDecision {
            mode: "responsive".to_string(),
            provider: AutoModelRoutingProvider::Openai,
            selected_model: "gpt-5.4-mini".to_string(),
            selected_reasoning_effort: Some("low".to_string()),
            fallback_used: false,
            reason: "Quick task.".to_string(),
            confidence: Some(0.8),
            task_type: "editing".to_string(),
            complexity: "low".to_string(),
            ambiguity: "low".to_string(),
            needs_tools: false,
            needs_large_context: false,
            policy_note: None,
        };

        attach_auto_model_routing_decision(&mut response, &decision);

        assert_eq!(
            response["result"]["routingDecision"]["selectedModel"].as_str(),
            Some("gpt-5.4-mini")
        );
    }

    #[test]
    fn extract_response_text_reads_output_array_text() {
        let response = json!({
            "output": [
                {
                    "content": [
                        {
                            "type": "output_text",
                            "text": "{\"task_type\":\"editing\"}"
                        }
                    ]
                }
            ]
        });

        assert_eq!(
            extract_response_text(&response).expect("text"),
            "{\"task_type\":\"editing\"}".to_string()
        );
    }

    #[test]
    fn extract_response_text_reads_top_level_output_text_array() {
        let response = json!({
            "output_text": [
                {
                    "type": "output_text",
                    "text": {
                        "value": "{\"task_type\":\"editing\"}"
                    }
                }
            ]
        });

        assert_eq!(
            extract_response_text(&response).expect("text"),
            "{\"task_type\":\"editing\"}".to_string()
        );
    }

    #[test]
    fn extract_response_text_reads_direct_output_item_without_content_array() {
        let response = json!({
            "output": [
                {
                    "type": "output_text",
                    "text": "{\"task_type\":\"editing\"}"
                }
            ]
        });

        assert_eq!(
            extract_response_text(&response).expect("text"),
            "{\"task_type\":\"editing\"}".to_string()
        );
    }

    #[test]
    fn extract_response_text_candidates_keep_output_items_separate() {
        let response = json!({
            "output": [
                {
                    "type": "message",
                    "text": "Here is the routing decision:"
                },
                {
                    "type": "output_text",
                    "text": "{\"task_type\":\"editing\"}"
                }
            ]
        });

        assert_eq!(
            extract_response_text_candidates(&response).expect("candidates"),
            vec![
                "Here is the routing decision:".to_string(),
                "{\"task_type\":\"editing\"}".to_string()
            ]
        );
    }

    #[test]
    fn parse_router_output_accepts_markdown_fenced_json() {
        let output = parse_router_output(
            "```json\n{\"task_type\":\"editing\",\"complexity\":\"low\",\"ambiguity\":\"low\",\"needs_tools\":false,\"needs_large_context\":false,\"selected_model\":\"gpt-5.4-mini\",\"selected_reasoning\":\"low\",\"confidence\":0.8,\"reason\":\"Quick task.\"}\n```",
        )
        .expect("fenced json parses");

        assert_eq!(output.selected_model, "gpt-5.4-mini");
        assert_eq!(output.selected_reasoning, "low");
    }

    #[test]
    fn parse_router_output_extracts_json_after_leading_prose() {
        let output = parse_router_output(
            "Here is the routing decision:\n{\"task_type\":\"editing\",\"complexity\":\"low\",\"ambiguity\":\"low\",\"needs_tools\":false,\"needs_large_context\":false,\"selected_model\":\"gpt-5.4-mini\",\"selected_reasoning\":\"low\",\"confidence\":0.8,\"reason\":\"Quick task.\"}\nThanks.",
        )
        .expect("embedded json parses");

        assert_eq!(output.task_type, "editing");
        assert_eq!(output.reason, "Quick task.");
    }

    #[test]
    fn parse_router_output_ignores_non_schema_braces_before_real_json() {
        let output = parse_router_output(
            "Use {braces} carefully.\n{\"task_type\":\"editing\",\"complexity\":\"low\",\"ambiguity\":\"low\",\"needs_tools\":false,\"needs_large_context\":false,\"selected_model\":\"gpt-5.4-mini\",\"selected_reasoning\":\"low\",\"confidence\":0.8,\"reason\":\"Quick task.\"}",
        )
        .expect("schema-shaped json parses");

        assert_eq!(output.selected_model, "gpt-5.4-mini");
        assert_eq!(output.reason, "Quick task.");
    }

    #[test]
    fn parse_router_output_rejects_wrong_type_object_before_real_json() {
        let output = parse_router_output(
            "{\"task_type\":1,\"complexity\":\"low\",\"ambiguity\":\"low\",\"needs_tools\":false,\"needs_large_context\":false,\"selected_model\":\"gpt-5.4-mini\",\"selected_reasoning\":\"low\",\"confidence\":0.8,\"reason\":\"Wrong types.\"}\n{\"task_type\":\"editing\",\"complexity\":\"low\",\"ambiguity\":\"low\",\"needs_tools\":false,\"needs_large_context\":false,\"selected_model\":\"gpt-5.4-mini\",\"selected_reasoning\":\"low\",\"confidence\":0.8,\"reason\":\"Quick task.\"}",
        )
        .expect("schema-typed json parses");

        assert_eq!(output.task_type, "editing");
        assert_eq!(output.reason, "Quick task.");
    }

    #[test]
    fn map_keyring_read_error_marks_locked_store_as_unconfigured() {
        let status = map_keyring_read_error(
            AutoModelRoutingProvider::Openai,
            keyring::Error::NoStorageAccess(Box::new(io::Error::other("locked"))),
        )
        .expect("status mapping succeeds");

        assert!(!status.configured);
        assert!(status.storage_supported);
        assert!(status
            .message
            .as_deref()
            .is_some_and(|message| message.contains("locked")));
    }

    #[test]
    fn map_keyring_read_error_preserves_unexpected_failures() {
        let error = map_keyring_read_error(
            AutoModelRoutingProvider::Openai,
            keyring::Error::Invalid("service".to_string(), "bad".to_string()),
        )
        .unwrap_err();

        assert!(error.contains("Failed to read router credential"));
        assert!(error.contains("service"));
    }
}
