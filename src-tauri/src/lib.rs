mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = keyring::use_native_store(true) {
        eprintln!("warning: keyring native store init failed: {e}");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            secrets::get_secret,
            secrets::set_secret,
            secrets::delete_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
