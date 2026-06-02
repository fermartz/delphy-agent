use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::time::{timeout, Duration};

/// External shape of an MCP server config. Matches `docs/SPEC.md` § "MCP
/// server configuration" minus the fields that don't apply to slice A:
/// HTTP/SSE transports, secret-reference `${secret:...}` syntax, and the
/// optional `scopes` array all land later. `transport` is accepted as a
/// string for forward-compat (validated to `"stdio"`).
///
/// `name` + `enabled` are part of the public contract the TS side passes
/// through; Rust doesn't act on them in slice A (the TS-side McpManager
/// honors `enabled` by skipping disabled configs before calling
/// `spawn_mcp_server`, and `name` is purely for UI). They're kept in the
/// struct so the serde shape matches SPEC.md verbatim.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub enabled: bool,
    pub transport: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

/// One live MCP child + the I/O endpoints we need to talk to it. Stored
/// under `McpServersState`, keyed by the server's `id`.
///
/// `child` is wrapped in `Option` so `stop_mcp_server` can take it out and
/// drive the graceful SIGTERM → 2s wait → SIGKILL flow from a normal async
/// context without holding the state-map mutex across the await points.
///
/// `stdin` is `Arc<tokio::sync::Mutex<ChildStdin>>` so `send_mcp_stdin` can
/// clone the Arc out while holding the std map mutex (sync, no await), drop
/// the std mutex, then await on the tokio mutex to do the actual write +
/// flush. The write is performed inside the command — write/flush errors
/// (e.g., broken pipe after child exits) propagate back to the webview as
/// the command's `Err` return, instead of being silently swallowed by a
/// detached writer task. This matters because callers (the SDK `Client`)
/// would otherwise assume the JSON-RPC line landed and wait for a response
/// that will never arrive.
struct ChildHandle {
    pid: u32,
    child: tokio::sync::Mutex<Option<Child>>,
    stdin: Arc<tokio::sync::Mutex<ChildStdin>>,
}

/// Tauri-managed state. `Mutex` (std, not tokio) is fine here because each
/// access is short — find / insert / remove — with no `.await` between
/// lock and unlock. Tokio mutex is used inside `ChildHandle` where we DO
/// hold across awaits.
pub struct McpServersState(Mutex<HashMap<String, ChildHandle>>);

impl McpServersState {
    fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

/// Register the bridge's Tauri-managed state. Call from `lib.rs::setup`.
pub fn init(app: &mut tauri::App) -> tauri::Result<()> {
    app.manage(McpServersState::new());
    Ok(())
}

/// Spawn the configured MCP server child as a subprocess. Returns the
/// server's `id` as a handle the webview can use for follow-up commands.
///
/// Side effects:
/// - Spawns two background tasks per child:
///   - stdout reader: emits `mcp:<id>:stdout` Tauri events line-by-line
///   - stderr reader: emits `mcp:<id>:stderr` Tauri events line-by-line
/// - Inserts the live `ChildHandle` into `McpServersState`. The child's
///   stdin is owned by the handle (behind a tokio mutex) and written to
///   synchronously from `send_mcp_stdin` so write failures propagate back to
///   the caller.
///
/// Errors:
/// - `INVALID_TRANSPORT`: transport != "stdio" (slice A only supports stdio).
/// - `DUPLICATE_HANDLE`: a server with the same `id` is already running.
/// - `SPAWN_FAILED`: the OS rejected the spawn (binary not found, permissions, etc.)
#[tauri::command]
pub async fn spawn_mcp_server(
    app: AppHandle,
    state: tauri::State<'_, McpServersState>,
    config: McpServerConfig,
) -> Result<String, String> {
    if config.transport != "stdio" {
        return Err(format!(
            "INVALID_TRANSPORT: slice A only supports stdio; got {:?}",
            config.transport
        ));
    }

    {
        let map = state.0.lock().map_err(|e| format!("STATE_POISONED: {e}"))?;
        if map.contains_key(&config.id) {
            return Err(format!("DUPLICATE_HANDLE: {} is already running", config.id));
        }
    }

    let mut cmd = Command::new(&config.command);
    cmd.args(&config.args)
        .envs(&config.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Do NOT inherit parent's stdio for descriptors we don't pipe, and
        // don't propagate signals to the child via the controlling terminal —
        // we manage lifecycle explicitly via signals.
        .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("SPAWN_FAILED: {} ({}): {}", config.command, config.id, e))?;

    let pid = child
        .id()
        .ok_or_else(|| "SPAWN_FAILED: child exited before pid was assigned".to_string())?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "SPAWN_FAILED: child stdin was not piped".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "SPAWN_FAILED: child stdout was not piped".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "SPAWN_FAILED: child stderr was not piped".to_string())?;

    // The stdout reader signals process exit (stdout closes when the child
    // dies) by emitting `mcp:<id>:exit` so the TS transport can fail a pending
    // connect immediately instead of waiting out the connect timeout (e.g. an
    // `npx` server that exits with an npm 404). The stderr reader does not, to
    // avoid a double signal.
    spawn_line_reader(stdout, app.clone(), config.id.clone(), "stdout", true);
    spawn_line_reader(stderr, app.clone(), config.id.clone(), "stderr", false);

    let handle = ChildHandle {
        pid,
        child: tokio::sync::Mutex::new(Some(child)),
        stdin: Arc::new(tokio::sync::Mutex::new(stdin)),
    };

    {
        let mut map = state.0.lock().map_err(|e| format!("STATE_POISONED: {e}"))?;
        map.insert(config.id.clone(), handle);
    }

    Ok(config.id)
}

/// Send a single line (a JSON-RPC message + implicit '\n') to the named
/// child's stdin and await the write + flush. The MCP stdio transport spec
/// requires one JSON message per line; the trailing newline is appended here
/// so callers don't have to.
///
/// The write happens INLINE inside this command (NOT via a detached writer
/// task) so an `io::Error` — typically a broken pipe after the child has
/// exited — propagates back to the webview as the command's `Err` return
/// instead of being silently swallowed. Callers (the SDK `Client`) can then
/// surface a real error instead of waiting indefinitely for a response that
/// will never arrive.
///
/// Errors:
/// - `UNKNOWN_HANDLE`: no server is registered with the given `handle`.
/// - `STDIN_WRITE_FAILED`: the write returned an io::Error (broken pipe after
///   child exit; unexpected I/O error). Includes the underlying error string.
/// - `STDIN_FLUSH_FAILED`: the flush returned an io::Error.
#[tauri::command]
pub async fn send_mcp_stdin(
    state: tauri::State<'_, McpServersState>,
    handle: String,
    line: String,
) -> Result<(), String> {
    // Clone the Arc out under the std mutex (no await between lock + clone),
    // then drop the std mutex before awaiting on the tokio mutex.
    let stdin_arc = {
        let map = state.0.lock().map_err(|e| format!("STATE_POISONED: {e}"))?;
        map.get(&handle)
            .ok_or_else(|| format!("UNKNOWN_HANDLE: {handle}"))?
            .stdin
            .clone()
    };

    let mut stdin_guard = stdin_arc.lock().await;
    let mut payload = line;
    if !payload.ends_with('\n') {
        payload.push('\n');
    }
    stdin_guard
        .write_all(payload.as_bytes())
        .await
        .map_err(|e| format!("STDIN_WRITE_FAILED: {handle}: {e}"))?;
    stdin_guard
        .flush()
        .await
        .map_err(|e| format!("STDIN_FLUSH_FAILED: {handle}: {e}"))?;
    Ok(())
}

/// Gracefully stop the named child: SIGTERM, await up to 2 seconds, then
/// SIGKILL fallback. On Windows there is no SIGTERM — the child is killed
/// directly via `Child::kill().await` (no grace period). Removes the handle
/// from the state map regardless of outcome.
///
/// Not invoked on shutdown — see `cleanup_on_exit_blocking` for that path.
#[tauri::command]
pub async fn stop_mcp_server(
    state: tauri::State<'_, McpServersState>,
    handle: String,
) -> Result<(), String> {
    // Drop the std::sync::MutexGuard BEFORE the await on the tokio mutex.
    // Holding it across an await would make the future !Send and break the
    // Tauri command bound.
    let entry = {
        let mut map = state.0.lock().map_err(|e| format!("STATE_POISONED: {e}"))?;
        map.remove(&handle).ok_or_else(|| format!("UNKNOWN_HANDLE: {handle}"))?
    };

    let child_opt = {
        let mut child_guard = entry.child.lock().await;
        child_guard.take()
    };

    let Some(mut child) = child_opt else {
        // Already taken by a concurrent call; nothing to do.
        return Ok(());
    };

    #[cfg(unix)]
    {
        let pid = child.id().map(|p| p as i32);
        if let Some(p) = pid {
            // SAFETY: libc::kill takes a raw pid + signal; documented FFI.
            unsafe {
                libc::kill(p, libc::SIGTERM);
            }
        }
        match timeout(Duration::from_secs(2), child.wait()).await {
            Ok(_) => Ok(()),
            Err(_) => {
                let _ = child.kill().await;
                Ok(())
            }
        }
    }

    #[cfg(not(unix))]
    {
        let _ = child.kill().await;
        Ok(())
    }
}

/// Best-effort synchronous cleanup at app shutdown. Iterates the state map
/// and sends SIGKILL by raw pid (Unix) without awaiting. On Windows this is
/// currently a no-op + warn — graceful Windows shutdown lands in slice C.
///
/// Called from `lib.rs`'s `RunEvent::Exit` arm. Per Parameter 10 of the
/// slice-A plan, this is HONESTLY weaker than the SIGTERM → 2s grace →
/// SIGKILL pattern: the Tauri exit hook is synchronous + late in shutdown,
/// with no clean place to await per-child teardown. Best-effort SIGKILL is
/// strictly better than OS-only reaping, which is the value floor we aim
/// for here.
pub fn cleanup_on_exit_blocking(app_handle: &AppHandle) {
    let state = match app_handle.try_state::<McpServersState>() {
        Some(s) => s,
        None => return,
    };
    let map = match state.0.lock() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("mcp: cleanup_on_exit_blocking: state poisoned: {e}");
            return;
        }
    };
    for (id, handle) in map.iter() {
        #[cfg(unix)]
        {
            // SAFETY: libc::kill takes a raw pid + signal; documented FFI.
            let rc = unsafe { libc::kill(handle.pid as i32, libc::SIGKILL) };
            if rc != 0 {
                eprintln!("mcp: cleanup_on_exit_blocking: SIGKILL {id} (pid {}) returned {}", handle.pid, rc);
            }
        }
        #[cfg(not(unix))]
        {
            let _ = handle.pid; // suppress unused-field lint on Windows
            eprintln!("mcp: cleanup_on_exit_blocking: no Windows kill path; {id} (pid {}) left to OS reaping", handle.pid);
        }
    }
}

fn spawn_line_reader<R>(
    reader: R,
    app: AppHandle,
    id: String,
    channel: &'static str,
    signal_exit: bool,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let event_name = format!("mcp:{id}:{channel}");
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if let Err(e) = app.emit(&event_name, LinePayload { line }) {
                        eprintln!("mcp:{id}:{channel} emit failed: {e}");
                        break;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    eprintln!("mcp:{id}:{channel} read failed: {e}");
                    break;
                }
            }
        }
        // The stream closed — for stdout this means the child process has
        // exited. Signal it so a pending connect can fail fast.
        if signal_exit {
            let _ = app.emit(&format!("mcp:{id}:exit"), ());
        }
    });
}

#[derive(serde::Serialize, Clone)]
struct LinePayload {
    line: String,
}
