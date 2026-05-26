use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Holds the live file watcher so it stays alive for the app's lifetime.
/// Stored in Tauri-managed state via `Manager::manage`. The field is never
/// read — its purpose is to keep the watcher from being dropped — so the
/// dead-code lint is intentionally suppressed.
#[allow(dead_code)]
pub struct ThemesWatcherState(pub Mutex<Option<notify::RecommendedWatcher>>);

/// Read every `*.json` file from `app_data_dir()/themes/` and return raw
/// (filename, content) pairs. Validation is deferred to the TS side (Zod).
///
/// Returns an empty vec when the themes directory doesn't exist — that's the
/// normal first-boot state, not an error.
#[tauri::command]
pub fn list_user_themes(app: AppHandle) -> Result<Vec<(String, String)>, String> {
    let themes_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data_dir: {e}"))?
        .join("themes");

    if !themes_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&themes_dir)
        .map_err(|e| format!("read_dir {}: {}", themes_dir.display(), e))?;

    let mut out: Vec<(String, String)> = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                eprintln!("themes: skip unreadable dir entry: {e}");
                continue;
            }
        };
        // Use entry.file_type() (does not follow symlinks) instead of
        // path.is_file() (which DOES follow symlinks) to keep a symlink
        // inside themes/ from being read as if it were a regular .json file
        // pointing outside the confined directory.
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(e) => {
                eprintln!("themes: skip entry, file_type failed: {e}");
                continue;
            }
        };
        if !file_type.is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if filename.is_empty() {
            continue;
        }
        // Per-file read failures are skipped rather than aborting the whole
        // scan: one bad file should never hide the user's other themes.
        match fs::read_to_string(&path) {
            Ok(content) => out.push((filename, content)),
            Err(e) => eprintln!("themes: skip {}: {}", path.display(), e),
        }
    }

    Ok(out)
}

fn themes_dir(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    Ok(app.path().app_data_dir()?.join("themes"))
}

/// Ensures the themes directory exists and spawns a `notify` watcher on it.
/// On any `*.json` Create/Modify/Remove event, emits a `themes-changed`
/// event to all webviews. The watcher is stored in Tauri-managed state so it
/// stays alive for the lifetime of the app.
///
/// Graceful degradation: if the watcher can't be created (rare — usually a
/// permissions issue), we `eprintln!` and return Ok — the app still boots
/// and themes load at startup via the scan; only live-watch is missing.
pub fn setup_user_themes_watcher(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use notify::{recommended_watcher, EventKind, RecursiveMode, Watcher};

    let dir = themes_dir(app)?;
    fs::create_dir_all(&dir)?;

    let app_handle = app.handle().clone();
    let watcher_result = recommended_watcher(move |res: notify::Result<notify::Event>| match res {
        Ok(event) => {
            // Filter to Create/Modify/Remove events on *.json paths.
            let relevant = matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            );
            if !relevant {
                return;
            }
            let touches_json = event
                .paths
                .iter()
                .any(|p| p.extension().and_then(|s| s.to_str()) == Some("json"));
            if !touches_json {
                return;
            }
            if let Err(e) = app_handle.emit("themes-changed", ()) {
                eprintln!("themes: emit themes-changed failed: {e}");
            }
        }
        Err(e) => eprintln!("themes: watcher event error: {e}"),
    });

    let mut watcher = match watcher_result {
        Ok(w) => w,
        Err(e) => {
            eprintln!("themes: failed to create watcher (live-watch disabled): {e}");
            app.manage(ThemesWatcherState(Mutex::new(None)));
            return Ok(());
        }
    };

    if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
        eprintln!("themes: failed to watch {} (live-watch disabled): {e}", dir.display());
        app.manage(ThemesWatcherState(Mutex::new(None)));
        return Ok(());
    }

    app.manage(ThemesWatcherState(Mutex::new(Some(watcher))));
    Ok(())
}
