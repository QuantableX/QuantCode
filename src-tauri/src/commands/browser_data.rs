use std::fs;
use std::path::PathBuf;

/// Return the path to ~/.quantcode/
fn quantcode_home() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    Ok(home.join(".quantcode"))
}

// ---------------------------------------------------------------------------
// load_browser_data
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_browser_data() -> Result<String, String> {
    let dir = quantcode_home()?;
    let file = dir.join("browser-data.json");

    if !file.exists() {
        return Ok(r#"{"history":[],"bookmarks":[]}"#.to_string());
    }

    fs::read_to_string(&file)
        .map_err(|e| format!("Failed to read browser-data.json: {}", e))
}

// ---------------------------------------------------------------------------
// save_browser_data
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_browser_data(data: String) -> Result<(), String> {
    let dir = quantcode_home()?;
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create ~/.quantcode/: {}", e))?;
    }

    let file = dir.join("browser-data.json");
    fs::write(&file, data)
        .map_err(|e| format!("Failed to write browser-data.json: {}", e))
}
