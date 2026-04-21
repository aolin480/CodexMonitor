use serde_json::json;
use tauri::{AppHandle, State};

use crate::remote_backend;
use crate::shared::prompt_routing_core;
use crate::state::AppState;
use crate::types::{
    AutoModelRoutingCredentialInput, AutoModelRoutingCredentialStatus, AutoModelRoutingProvider,
};

#[tauri::command]
pub(crate) async fn get_auto_model_routing_credential_status(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AutoModelRoutingCredentialStatus, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let value = remote_backend::call_remote(
            &*state,
            app,
            "get_auto_model_routing_credential_status",
            json!({}),
        )
        .await?;
        return serde_json::from_value(value).map_err(|err| err.to_string());
    }

    prompt_routing_core::get_auto_model_routing_credential_status_core()
}

#[tauri::command]
pub(crate) async fn save_auto_model_routing_credential(
    input: AutoModelRoutingCredentialInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AutoModelRoutingCredentialStatus, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let value = remote_backend::call_remote(
            &*state,
            app,
            "save_auto_model_routing_credential",
            json!({ "input": input }),
        )
        .await?;
        return serde_json::from_value(value).map_err(|err| err.to_string());
    }

    prompt_routing_core::save_auto_model_routing_credential_core(input)
}

#[tauri::command]
pub(crate) async fn remove_auto_model_routing_credential(
    provider: AutoModelRoutingProvider,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AutoModelRoutingCredentialStatus, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let value = remote_backend::call_remote(
            &*state,
            app,
            "remove_auto_model_routing_credential",
            json!({ "provider": provider }),
        )
        .await?;
        return serde_json::from_value(value).map_err(|err| err.to_string());
    }

    prompt_routing_core::remove_auto_model_routing_credential_core(provider)
}
