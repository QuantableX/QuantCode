mod commands;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            // File system
            commands::fs::read_dir_tree,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::create_file,
            commands::fs::delete_file,
            commands::fs::rename_file,
            commands::fs::execute_command,
            commands::fs::search_files,
            commands::fs::read_file_binary,
            // Git
            commands::git::git_status,
            commands::git::git_diff,
            commands::git::git_stage,
            commands::git::git_commit,
            commands::git::git_branch_list,
            // Terminal
            commands::terminal::spawn_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
            commands::terminal::disconnect_terminal,
            commands::terminal::reconnect_terminal,
            commands::terminal::check_terminal_alive,
            // Workspace
            commands::workspace::load_workspaces,
            commands::workspace::save_workspaces,
            commands::workspace::load_canvas_state,
            commands::workspace::save_canvas_state,
            // Browser
            commands::browser::navigate_browser,
            commands::browser::eval_browser,
            commands::browser::get_browser_url,
            commands::browser::set_browser_clip_region,
            commands::browser::find_in_browser,
            // Browser data
            commands::browser_data::load_browser_data,
            commands::browser_data::save_browser_data,
            // Update
            commands::update::check_for_update,
            commands::update::download_and_install_update,
        ])
        .setup(|_app| {
            // Ensure ~/.quantcode/ directory exists on startup
            if let Some(home) = dirs::home_dir() {
                let qc_dir = home.join(".quantcode");
                if !qc_dir.exists() {
                    if let Err(e) = std::fs::create_dir_all(&qc_dir) {
                        eprintln!("Warning: failed to create ~/.quantcode/: {}", e);
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running QuantCode");
}
