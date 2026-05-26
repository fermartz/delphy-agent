mod secrets;
mod themes;

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
            themes::list_user_themes,
        ])
        .setup(|app| {
            if let Err(e) = themes::setup_user_themes_watcher(app) {
                eprintln!("themes: setup_user_themes_watcher failed: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
