use crate::state::AppState;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::VecDeque;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use uuid::Uuid;

/// Max output buffer size (256 KB) for disconnected terminals.
const MAX_OUTPUT_BUFFER: usize = 256 * 1024;

/// Payload emitted to the frontend whenever the terminal produces output.
#[derive(Clone, Serialize)]
struct TerminalOutputPayload {
    id: String,
    data: String,
}

// ---------------------------------------------------------------------------
// spawn_terminal
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn spawn_terminal(
    state: tauri::State<'_, AppState>,
    cwd: String,
    shell: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();

    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Build the shell command — use the provided shell or fall back to default
    let shell_path = shell.as_deref().unwrap_or_else(|| get_default_shell());
    let mut cmd = CommandBuilder::new(shell_path);
    cmd.cwd(&cwd);

    // Set terminal environment so CLI tools know Unicode & 256-color are supported
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("LANG", "en_US.UTF-8");

    // On Windows, force UTF-8 code page for child processes
    #[cfg(windows)]
    {
        cmd.env("PYTHONUTF8", "1");
        cmd.env("PYTHONIOENCODING", "utf-8");
    }

    // Spawn the child process in the slave side of the PTY
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Get a reader from the master side for reading output
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    // Get a writer for sending input
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    // Shared state for the reader thread
    let connected = Arc::new(AtomicBool::new(true));
    let output_buffer: Arc<Mutex<VecDeque<u8>>> = Arc::new(Mutex::new(VecDeque::new()));

    // Store the terminal handle in state
    let terminal_id = id.clone();
    {
        let mut terminals = state
            .terminals
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        terminals.insert(
            terminal_id.clone(),
            crate::state::TerminalHandle {
                writer,
                master: pair.master,
                child,
                connected: connected.clone(),
                output_buffer: output_buffer.clone(),
            },
        );
    }

    // Spawn a background thread that reads PTY output and emits events.
    // When the frontend is disconnected (workspace switch), output is buffered
    // so it can be replayed on reconnect.
    let event_id = id.clone();
    let reader_connected = connected.clone();
    let reader_buffer = output_buffer.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF — shell exited
                    let _ = app_handle.emit(
                        "terminal-output",
                        TerminalOutputPayload {
                            id: event_id.clone(),
                            data: String::new(),
                        },
                    );
                    break;
                }
                Ok(n) => {
                    if reader_connected.load(Ordering::Relaxed) {
                        // Frontend is listening — emit event directly
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit(
                            "terminal-output",
                            TerminalOutputPayload {
                                id: event_id.clone(),
                                data: text,
                            },
                        );
                    } else {
                        // Frontend disconnected — buffer the output
                        if let Ok(mut b) = reader_buffer.lock() {
                            b.extend(&buf[..n]);
                            // Cap buffer size to prevent unbounded growth
                            while b.len() > MAX_OUTPUT_BUFFER {
                                b.pop_front();
                            }
                        }
                    }
                }
                Err(e) => {
                    // On Windows, ERROR_BROKEN_PIPE (code 109) is expected when
                    // the child process exits. Treat as EOF.
                    let is_broken_pipe = e.raw_os_error() == Some(109)
                        || e.kind() == std::io::ErrorKind::BrokenPipe;
                    if !is_broken_pipe {
                        eprintln!("Terminal reader error: {}", e);
                    }
                    let _ = app_handle.emit(
                        "terminal-output",
                        TerminalOutputPayload {
                            id: event_id.clone(),
                            data: String::new(),
                        },
                    );
                    break;
                }
            }
        }
    });

    Ok(id)
}

// ---------------------------------------------------------------------------
// write_terminal
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn write_terminal(
    state: tauri::State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    let handle = terminals
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal not found: {}", id))?;

    use std::io::Write;
    handle
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to terminal: {}", e))?;

    handle
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush terminal: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// resize_terminal
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn resize_terminal(
    state: tauri::State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let terminals = state
        .terminals
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    let handle = terminals
        .get(&id)
        .ok_or_else(|| format!("Terminal not found: {}", id))?;

    handle
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize terminal: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// close_terminal
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn close_terminal(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    if let Some(mut handle) = terminals.remove(&id) {
        // Attempt to kill the child process; ignore errors if it already exited.
        let _ = handle.child.kill();
        // Dropping the handle closes the PTY master, which unblocks the reader thread.
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// disconnect_terminal — called on workspace switch (unmount without killing)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn disconnect_terminal(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let terminals = state
        .terminals
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    if let Some(handle) = terminals.get(&id) {
        handle.connected.store(false, Ordering::Relaxed);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// reconnect_terminal — called when switching back to a workspace
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn reconnect_terminal(state: tauri::State<'_, AppState>, id: String) -> Result<String, String> {
    let terminals = state
        .terminals
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    let handle = terminals
        .get(&id)
        .ok_or_else(|| format!("Terminal not found: {}", id))?;

    // Drain the buffered output
    let buffered = if let Ok(mut buf) = handle.output_buffer.lock() {
        let bytes: Vec<u8> = buf.drain(..).collect();
        String::from_utf8_lossy(&bytes).to_string()
    } else {
        String::new()
    };

    // Mark as connected so the reader thread resumes emitting events
    handle.connected.store(true, Ordering::Relaxed);

    Ok(buffered)
}

// ---------------------------------------------------------------------------
// check_terminal_alive — check if a terminal ID still exists
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn check_terminal_alive(state: tauri::State<'_, AppState>, id: String) -> Result<bool, String> {
    let terminals = state
        .terminals
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    Ok(terminals.contains_key(&id))
}

// ---------------------------------------------------------------------------
// Platform-specific default shell
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn get_default_shell() -> &'static str {
    // Prefer PowerShell if available, fall back to cmd
    if std::path::Path::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
        .exists()
    {
        "powershell.exe"
    } else {
        "cmd.exe"
    }
}

#[cfg(not(windows))]
fn get_default_shell() -> &'static str {
    // Use SHELL env var if set, otherwise fall back to /bin/sh
    // Note: we return a static str, so we check common shells.
    if std::path::Path::new("/bin/zsh").exists() {
        "/bin/zsh"
    } else if std::path::Path::new("/bin/bash").exists() {
        "/bin/bash"
    } else {
        "/bin/sh"
    }
}
