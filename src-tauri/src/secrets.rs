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
