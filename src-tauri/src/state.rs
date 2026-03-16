use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

/// Handle to a running terminal session.
///
/// `writer` is used to send input (keystrokes) to the PTY.
/// `master` is retained so we can resize the PTY later.
/// The reader half lives on a dedicated thread that emits Tauri events.
/// `connected` tracks whether a frontend listener is attached.
/// `output_buffer` stores output produced while disconnected.
pub struct TerminalHandle {
    pub writer: Box<dyn std::io::Write + Send>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub connected: Arc<AtomicBool>,
    pub output_buffer: Arc<Mutex<VecDeque<u8>>>,
}

/// Global application state managed by Tauri.
pub struct AppState {
    pub terminals: Mutex<HashMap<String, TerminalHandle>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
        }
    }
}
