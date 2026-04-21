use crate::types::{
    AutoModelRoutingCredentialInput, AutoModelRoutingCredentialStatus,
    AutoModelRoutingCredentialStorageKind, AutoModelRoutingProvider,
};

const AUTO_MODEL_ROUTING_KEYCHAIN_SERVICE: &str = "com.codexmonitor.auto-model-routing";

pub(crate) fn get_auto_model_routing_credential_status_core(
) -> Result<AutoModelRoutingCredentialStatus, String> {
    read_auto_model_routing_credential_status(AutoModelRoutingProvider::Openai)
}

pub(crate) fn save_auto_model_routing_credential_core(
    input: AutoModelRoutingCredentialInput,
) -> Result<AutoModelRoutingCredentialStatus, String> {
    save_auto_model_routing_credential_with(input, write_auto_model_routing_credential, |provider| {
        read_auto_model_routing_credential_status(provider)
    })
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
        message: Some("Secure router credential storage is not available on this backend host.".to_string()),
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
        .map_err(|error| format!("Failed to store router credential in the OS credential store: {error}"))
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
        map_keyring_read_error, remove_auto_model_routing_credential_with,
        save_auto_model_routing_credential_with, AutoModelRoutingCredentialInput,
        AutoModelRoutingCredentialStatus, AutoModelRoutingCredentialStorageKind,
        AutoModelRoutingProvider,
    };
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
