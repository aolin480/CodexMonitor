use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::fs;
use tokio::fs::OpenOptions;
use tokio::time::sleep;

const THREAD_NAME_REGISTRY_FILE: &str = "thread_names.json";
const THREAD_NAME_REGISTRY_LOCK_FILE: &str = "thread_names.lock";
const THREAD_NAME_REGISTRY_LOCK_TIMEOUT: Duration = Duration::from_secs(2);
const THREAD_NAME_REGISTRY_LOCK_RETRY: Duration = Duration::from_millis(25);
const THREAD_NAME_REGISTRY_STALE_LOCK_AGE: Duration = Duration::from_secs(10);

type ThreadNameRegistry = HashMap<String, String>;

struct RegistryWriteLock {
    path: PathBuf,
}

impl Drop for RegistryWriteLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn registry_path(data_dir: &Path) -> PathBuf {
    data_dir.join(THREAD_NAME_REGISTRY_FILE)
}

fn registry_lock_path(data_dir: &Path) -> PathBuf {
    data_dir.join(THREAD_NAME_REGISTRY_LOCK_FILE)
}

fn make_thread_name_key(workspace_id: &str, thread_id: &str) -> String {
    format!("{workspace_id}:{thread_id}")
}

fn normalize_thread_name(name: &str) -> Option<String> {
    let normalized = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

async fn read_registry(data_dir: &Path) -> Result<ThreadNameRegistry, String> {
    let path = registry_path(data_dir);
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = fs::read_to_string(&path)
        .await
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
    serde_json::from_str(&raw).map_err(|err| format!("failed to parse {}: {err}", path.display()))
}

async fn acquire_registry_write_lock(data_dir: &Path) -> Result<RegistryWriteLock, String> {
    fs::create_dir_all(data_dir)
        .await
        .map_err(|err| format!("failed to create {}: {err}", data_dir.display()))?;
    let lock_path = registry_lock_path(data_dir);
    let deadline = Instant::now() + THREAD_NAME_REGISTRY_LOCK_TIMEOUT;
    loop {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .await
        {
            Ok(_) => return Ok(RegistryWriteLock { path: lock_path }),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                if let Ok(metadata) = fs::metadata(&lock_path).await {
                    if let Ok(modified_at) = metadata.modified() {
                        if modified_at
                            .elapsed()
                            .map(|age| age >= THREAD_NAME_REGISTRY_STALE_LOCK_AGE)
                            .unwrap_or(false)
                        {
                            let _ = fs::remove_file(&lock_path).await;
                            continue;
                        }
                    }
                }
                if Instant::now() >= deadline {
                    return Err(format!(
                        "timed out acquiring thread name registry lock at {}",
                        lock_path.display()
                    ));
                }
                sleep(THREAD_NAME_REGISTRY_LOCK_RETRY).await;
            }
            Err(err) => {
                return Err(format!(
                    "failed to acquire thread name registry lock at {}: {err}",
                    lock_path.display()
                ));
            }
        }
    }
}

async fn write_registry(data_dir: &Path, registry: &ThreadNameRegistry) -> Result<(), String> {
    fs::create_dir_all(data_dir)
        .await
        .map_err(|err| format!("failed to create {}: {err}", data_dir.display()))?;
    let path = registry_path(data_dir);
    let temp_path = data_dir.join(format!(
        "{THREAD_NAME_REGISTRY_FILE}.tmp-{}",
        std::process::id()
    ));
    let raw = serde_json::to_string_pretty(registry)
        .map_err(|err| format!("failed to serialize {}: {err}", path.display()))?;
    fs::write(&temp_path, raw)
        .await
        .map_err(|err| format!("failed to write {}: {err}", temp_path.display()))?;
    fs::rename(&temp_path, &path)
        .await
        .map_err(|err| format!("failed to replace {}: {err}", path.display()))
}

fn overlay_thread_name_for_workspace(
    registry: &ThreadNameRegistry,
    workspace_id: &str,
    thread: &mut Map<String, Value>,
) {
    let Some(thread_id) = thread.get("id").and_then(Value::as_str) else {
        return;
    };
    let Some(name) = registry.get(&make_thread_name_key(workspace_id, thread_id)) else {
        return;
    };
    thread.insert("name".to_string(), Value::String(name.clone()));
}

pub(crate) async fn save_thread_name(
    data_dir: &Path,
    workspace_id: &str,
    thread_id: &str,
    name: &str,
) -> Result<(), String> {
    if workspace_id.trim().is_empty() {
        return Err("workspaceId is required".to_string());
    }
    if thread_id.trim().is_empty() {
        return Err("threadId is required".to_string());
    }
    let _lock = acquire_registry_write_lock(data_dir).await?;
    let mut registry = read_registry(data_dir).await?;
    let key = make_thread_name_key(workspace_id, thread_id);
    match normalize_thread_name(name) {
        Some(normalized_name) => {
            registry.insert(key, normalized_name);
        }
        None => {
            registry.remove(&key);
        }
    }
    write_registry(data_dir, &registry).await
}

pub(crate) async fn apply_thread_name_overlays(
    data_dir: &Path,
    workspace_id: &str,
    response: &mut Value,
) -> Result<(), String> {
    let registry = read_registry(data_dir).await?;

    if let Some(thread) = response
        .get_mut("result")
        .and_then(Value::as_object_mut)
        .and_then(|result| result.get_mut("thread"))
        .and_then(Value::as_object_mut)
    {
        overlay_thread_name_for_workspace(&registry, workspace_id, thread);
    }

    if let Some(thread) = response.get_mut("thread").and_then(Value::as_object_mut) {
        overlay_thread_name_for_workspace(&registry, workspace_id, thread);
    }

    if let Some(threads) = response
        .get_mut("result")
        .and_then(Value::as_object_mut)
        .and_then(|result| result.get_mut("data"))
        .and_then(Value::as_array_mut)
    {
        for thread in threads {
            if let Some(thread) = thread.as_object_mut() {
                overlay_thread_name_for_workspace(&registry, workspace_id, thread);
            }
        }
    }

    if let Some(threads) = response.get_mut("data").and_then(Value::as_array_mut) {
        for thread in threads {
            if let Some(thread) = thread.as_object_mut() {
                overlay_thread_name_for_workspace(&registry, workspace_id, thread);
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{apply_thread_name_overlays, save_thread_name};
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::runtime::Builder;

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir(prefix: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "{prefix}-{timestamp}-{}-{counter}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn run_async_test<F>(future: F)
    where
        F: std::future::Future<Output = ()>,
    {
        Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build tokio runtime")
            .block_on(future);
    }

    #[test]
    fn overlays_saved_name_into_thread_list_results() {
        run_async_test(async {
            let data_dir = temp_dir("thread-name-registry");
            save_thread_name(&data_dir, "ws-1", "thread-1", "Shared Name")
                .await
                .expect("save name");

            let mut response = json!({
                "result": {
                    "data": [
                        { "id": "thread-1", "preview": "Preview" },
                        { "id": "thread-2", "name": "Server Name" }
                    ]
                }
            });

            apply_thread_name_overlays(&data_dir, "ws-1", &mut response)
                .await
                .expect("overlay names");

            assert_eq!(
                response["result"]["data"][0]["name"],
                Value::String("Shared Name".to_string())
            );
            assert_eq!(
                response["result"]["data"][1]["name"],
                Value::String("Server Name".to_string())
            );

            let _ = std::fs::remove_dir_all(data_dir);
        });
    }

    #[test]
    fn overlays_saved_name_over_existing_server_name() {
        run_async_test(async {
            let data_dir = temp_dir("thread-name-registry");
            save_thread_name(&data_dir, "ws-1", "thread-2", "Shared Override")
                .await
                .expect("save name");

            let mut response = json!({
                "result": {
                    "data": [
                        { "id": "thread-2", "name": "Server Name" }
                    ]
                }
            });

            apply_thread_name_overlays(&data_dir, "ws-1", &mut response)
                .await
                .expect("overlay names");

            assert_eq!(
                response["result"]["data"][0]["name"],
                Value::String("Shared Override".to_string())
            );

            let _ = std::fs::remove_dir_all(data_dir);
        });
    }

    #[test]
    fn overlays_saved_name_into_single_thread_results() {
        run_async_test(async {
            let data_dir = temp_dir("thread-name-registry");
            save_thread_name(&data_dir, "ws-1", "thread-9", "Resume Name")
                .await
                .expect("save name");

            let mut response = json!({
                "result": {
                    "thread": {
                        "id": "thread-9",
                        "preview": "Preview"
                    }
                }
            });

            apply_thread_name_overlays(&data_dir, "ws-1", &mut response)
                .await
                .expect("overlay names");

            assert_eq!(
                response["result"]["thread"]["name"],
                Value::String("Resume Name".to_string())
            );

            let _ = std::fs::remove_dir_all(data_dir);
        });
    }

    #[test]
    fn clearing_name_removes_saved_overlay() {
        run_async_test(async {
            let data_dir = temp_dir("thread-name-registry");
            save_thread_name(&data_dir, "ws-1", "thread-9", "Resume Name")
                .await
                .expect("save name");
            save_thread_name(&data_dir, "ws-1", "thread-9", "   ")
                .await
                .expect("clear name");

            let mut response = json!({
                "result": {
                    "thread": {
                        "id": "thread-9",
                        "name": "Server Name"
                    }
                }
            });

            apply_thread_name_overlays(&data_dir, "ws-1", &mut response)
                .await
                .expect("overlay names");

            assert_eq!(
                response["result"]["thread"]["name"],
                Value::String("Server Name".to_string())
            );

            let _ = std::fs::remove_dir_all(data_dir);
        });
    }
}
