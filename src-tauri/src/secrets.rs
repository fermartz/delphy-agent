use keyring_core::{Entry, Error as KeyringError};

const SERVICE_NAME: &str = "app.delphy.agent";

#[tauri::command]
pub fn get_secret(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(format_keyring_error)?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(format_keyring_error(e)),
    }
}

#[tauri::command]
pub fn set_secret(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(format_keyring_error)?;
    entry.set_password(&value).map_err(format_keyring_error)
}

#[tauri::command]
pub fn delete_secret(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(format_keyring_error)?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(format_keyring_error(e)),
    }
}

fn format_keyring_error(err: KeyringError) -> String {
    match err {
        KeyringError::NoStorageAccess(inner) => format!("SECURE_STORAGE_UNAVAILABLE: {inner}"),
        KeyringError::NoEntry => "NO_ENTRY".to_string(),
        e => format!("KEYRING_ERROR: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_no_entry_to_a_stable_code() {
        assert_eq!(format_keyring_error(KeyringError::NoEntry), "NO_ENTRY");
    }

    #[test]
    fn maps_no_storage_access_to_the_linux_fallback_code() {
        // Load-bearing prefix: the boot path (direct-api.ts BootError classifier,
        // `message.startsWith("SECURE_STORAGE_UNAVAILABLE:")`) keys the Linux
        // "session-only key" fallback UX off it. (resolve-key.ts separately
        // catches ALL get_secret errors and falls through to runtime storage.)
        let err = KeyringError::NoStorageAccess(Box::new(std::io::Error::other(
            "secret service is not available",
        )));
        let msg = format_keyring_error(err);
        assert!(msg.starts_with("SECURE_STORAGE_UNAVAILABLE:"), "got: {msg}");
        assert!(msg.contains("secret service is not available"));
    }

    #[test]
    fn maps_other_variants_to_a_generic_code() {
        let msg = format_keyring_error(KeyringError::TooLong("some_key".to_string(), 10));
        assert!(msg.starts_with("KEYRING_ERROR:"), "got: {msg}");
    }
}
