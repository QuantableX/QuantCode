use std::fs;
use std::path::{Path, PathBuf};

/// Return the path to ~/.quantcode/
fn quantcode_home() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    Ok(home.join(".quantcode"))
}

// ---------------------------------------------------------------------------
// load_workspaces
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_workspaces() -> Result<String, String> {
    let dir = quantcode_home()?;
    let file = dir.join("workspaces.json");

    if !file.exists() {
        // Return a sensible default so the frontend doesn't need to handle "no file"
        return Ok(r#"{"workspaces":[]}"#.to_string());
    }

    fs::read_to_string(&file)
        .map_err(|e| format!("Failed to read workspaces.json: {}", e))
}

// ---------------------------------------------------------------------------
// save_workspaces
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_workspaces(data: String) -> Result<(), String> {
    let dir = quantcode_home()?;
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create ~/.quantcode/: {}", e))?;
    }

    let file = dir.join("workspaces.json");
    fs::write(&file, data)
        .map_err(|e| format!("Failed to write workspaces.json: {}", e))
}

// ---------------------------------------------------------------------------
// load_canvas_state
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_canvas_state(folder_path: String) -> Result<String, String> {
    let qc_dir = Path::new(&folder_path).join(".quantcode");
    let file = qc_dir.join("canvas.json");

    if !file.exists() {
        return Ok(r#"{"tabs":[],"activeTab":null}"#.to_string());
    }

    fs::read_to_string(&file)
        .map_err(|e| format!("Failed to read canvas.json: {}", e))
}

// ---------------------------------------------------------------------------
// save_canvas_state
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_canvas_state(folder_path: String, data: String) -> Result<(), String> {
    let qc_dir = Path::new(&folder_path).join(".quantcode");
    if !qc_dir.exists() {
        fs::create_dir_all(&qc_dir)
            .map_err(|e| format!("Failed to create .quantcode/ directory: {}", e))?;
    }

    let file = qc_dir.join("canvas.json");
    fs::write(&file, data)
        .map_err(|e| format!("Failed to write canvas.json: {}", e))
}
