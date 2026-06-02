mod mcp_bridge;
mod secrets;
mod themes;

use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = keyring::use_native_store(true) {
        eprintln!("warning: keyring native store init failed: {e}");
    }

    let sql_migrations = vec![
        Migration {
            version: 1,
            description: "initial schema: sessions, messages, messages_fts, memory, mcp_servers",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "multi-provider: add sessions.main_provider column, backfill anthropic",
            sql: include_str!("../migrations/002_multi_provider.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:delphy.db", sql_migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            secrets::get_secret,
            secrets::set_secret,
            secrets::delete_secret,
            themes::list_user_themes,
            mcp_bridge::spawn_mcp_server,
            mcp_bridge::send_mcp_stdin,
            mcp_bridge::stop_mcp_server,
        ])
        .setup(|app| {
            if let Err(e) = themes::setup_user_themes_watcher(app) {
                eprintln!("themes: setup_user_themes_watcher failed: {e}");
            }
            if let Err(e) = mcp_bridge::init(app) {
                eprintln!("mcp: init failed: {e}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                mcp_bridge::cleanup_on_exit_blocking(app_handle);
            }
        });
}
