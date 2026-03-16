use ignore::WalkBuilder;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// A node in the file tree sent to the frontend.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileEntry>>,
}

// ---------------------------------------------------------------------------
// read_dir_tree — returns a tree of FileEntry rooted at `path`
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_dir_tree(path: String, gitignore: bool) -> Result<Vec<FileEntry>, String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !root.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    // Collect every entry produced by the ignore-aware walker.
    // We skip the root directory entry itself.
    let walker = WalkBuilder::new(&root)
        .git_ignore(gitignore)
        .git_global(gitignore)
        .git_exclude(gitignore)
        .hidden(false) // show dotfiles; gitignore already filters
        .max_depth(None)
        .sort_by_file_path(|a, b| {
            // Directories first, then alphabetical (case-insensitive)
            let a_is_dir = a.is_dir();
            let b_is_dir = b.is_dir();
            match (a_is_dir, b_is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a
                    .file_name()
                    .map(|n| n.to_ascii_lowercase())
                    .cmp(&b.file_name().map(|n| n.to_ascii_lowercase())),
            }
        })
        .build();

    // parent_path -> Vec<FileEntry>  (children collected per directory)
    let mut children_map: HashMap<PathBuf, Vec<FileEntry>> = HashMap::new();
    // Insertion-order list so we can resolve bottom-up later.
    let mut dir_order: Vec<PathBuf> = Vec::new();

    for entry_result in walker {
        let entry = entry_result.map_err(|e| e.to_string())?;
        let entry_path = entry.path().to_path_buf();

        // Skip the root itself
        if entry_path == root {
            children_map.insert(root.clone(), Vec::new());
            dir_order.push(root.clone());
            continue;
        }

        let is_dir = entry_path.is_dir();
        let name = entry_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let fe = FileEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory: is_dir,
            children: if is_dir { Some(Vec::new()) } else { None },
        };

        // Register this entry under its parent
        let parent = entry_path.parent().unwrap_or(&root).to_path_buf();
        children_map.entry(parent).or_default().push(fe);

        if is_dir {
            children_map.entry(entry_path.clone()).or_default();
            dir_order.push(entry_path);
        }
    }

    // Resolve tree bottom-up: attach children to their directory entries.
    for dir in dir_order.iter().rev() {
        if *dir == root {
            continue;
        }
        let collected = children_map.remove(dir).unwrap_or_default();
        if collected.is_empty() {
            continue;
        }
        let parent = dir.parent().unwrap_or(&root).to_path_buf();
        if let Some(siblings) = children_map.get_mut(&parent) {
            for entry in siblings.iter_mut() {
                let entry_pb = PathBuf::from(&entry.path);
                if entry_pb == *dir {
                    entry.children = Some(collected);
                    break;
                }
            }
        }
    }

    // Sort children: directories first, then alphabetical
    fn sort_entries(entries: &mut [FileEntry]) {
        entries.sort_by(|a, b| {
            match (a.is_directory, b.is_directory) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            }
        });
        for entry in entries.iter_mut() {
            if let Some(ref mut children) = entry.children {
                sort_entries(children);
            }
        }
    }

    let mut result = children_map.remove(&root).unwrap_or_default();
    sort_entries(&mut result);
    Ok(result)
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }
    if p.is_dir() {
        return Err(format!("Path is a directory, not a file: {}", path));
    }
    fs::read_to_string(p).map_err(|e| format!("Failed to read {}: {}", path, e))
}

// ---------------------------------------------------------------------------
// read_file_binary — reads any file and returns base64 + detected MIME type
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryFileResult {
    pub base64_data: String,
    pub mime_type: String,
    pub size_bytes: u64,
}

fn detect_mime(path: &Path) -> String {
    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    match ext.as_str() {
        // Images
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        // Video
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        // Audio
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        // PDF
        "pdf" => "application/pdf",
        // Fallback
        _ => "application/octet-stream",
    }
    .to_string()
}

#[tauri::command]
pub fn read_file_binary(path: String) -> Result<BinaryFileResult, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }
    if p.is_dir() {
        return Err(format!("Path is a directory, not a file: {}", path));
    }

    let metadata = fs::metadata(p).map_err(|e| format!("Failed to read metadata for {}: {}", path, e))?;
    let size_bytes = metadata.len();

    // Cap at 50 MB to prevent memory issues
    if size_bytes > 50 * 1024 * 1024 {
        return Err(format!("File too large for preview ({} bytes): {}", size_bytes, path));
    }

    let bytes = fs::read(p).map_err(|e| format!("Failed to read {}: {}", path, e))?;

    use base64::Engine;
    let base64_data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let mime_type = detect_mime(p);

    Ok(BinaryFileResult {
        base64_data,
        mime_type,
        size_bytes,
    })
}

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    // Ensure parent directory exists
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs for {}: {}", path, e))?;
        }
    }
    fs::write(p, content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

// ---------------------------------------------------------------------------
// create_file
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_file(path: String, is_directory: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err(format!("Path already exists: {}", path));
    }
    if is_directory {
        fs::create_dir_all(p)
            .map_err(|e| format!("Failed to create directory {}: {}", path, e))
    } else {
        // Ensure parent exists
        if let Some(parent) = p.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent dirs for {}: {}", path, e))?;
            }
        }
        fs::write(p, "").map_err(|e| format!("Failed to create file {}: {}", path, e))
    }
}

// ---------------------------------------------------------------------------
// delete_file
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if p.is_dir() {
        fs::remove_dir_all(p)
            .map_err(|e| format!("Failed to delete directory {}: {}", path, e))
    } else {
        fs::remove_file(p).map_err(|e| format!("Failed to delete file {}: {}", path, e))
    }
}

// ---------------------------------------------------------------------------
// rename_file
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    let src = Path::new(&old_path);
    if !src.exists() {
        return Err(format!("Source path does not exist: {}", old_path));
    }
    let dest = Path::new(&new_path);
    // Ensure destination parent exists
    if let Some(parent) = dest.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs for {}: {}", new_path, e))?;
        }
    }
    fs::rename(src, dest)
        .map_err(|e| format!("Failed to rename {} -> {}: {}", old_path, new_path, e))
}

// ---------------------------------------------------------------------------
// execute_command — run a shell command and return stdout/stderr/exit_code
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[tauri::command]
pub fn execute_command(command: String, cwd: Option<String>) -> Result<CommandResult, String> {
    use std::process::Command;

    let (shell, flag) = if cfg!(windows) {
        ("cmd", "/C")
    } else {
        ("sh", "-c")
    };

    let mut cmd = Command::new(shell);
    cmd.arg(flag).arg(&command);

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

// ---------------------------------------------------------------------------
// search_files — case-insensitive text search across files in a directory
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub line_number: usize,
    pub line: String,
}

#[tauri::command]
pub fn search_files(
    path: String,
    pattern: String,
    file_pattern: Option<String>,
) -> Result<Vec<SearchMatch>, String> {
    let mut matches = Vec::new();
    let pattern_lower = pattern.to_lowercase();

    for entry in WalkDir::new(&path).into_iter().filter_map(|e| e.ok()) {
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }

        // Optional file pattern filter
        if let Some(ref fp) = file_pattern {
            let name = entry_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy();
            if !name.contains(fp.as_str()) {
                continue;
            }
        }

        // Try to read as UTF-8
        if let Ok(content) = std::fs::read_to_string(entry_path) {
            for (i, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&pattern_lower) {
                    matches.push(SearchMatch {
                        path: entry_path.to_string_lossy().to_string(),
                        line_number: i + 1,
                        line: line.to_string(),
                    });
                }
                // Limit results to prevent huge responses
                if matches.len() >= 200 {
                    return Ok(matches);
                }
            }
        }
    }

    Ok(matches)
}
