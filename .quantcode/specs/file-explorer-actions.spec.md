---
title: File Explorer Context Menus & Actions
status: planned
priority: medium
linkedFiles:
  - app/components/Sidebar/FileExplorer.vue
  - src-tauri/src/commands/fs.rs
tags:
  - ui
  - file-system
createdAt: 2026-03-18T20:50:00.000Z
updatedAt: 2026-03-18T20:50:00.000Z
---

The file explorer shows the directory tree with git decorations but has no right-click context menu for file operations. All file operations (create, rename, delete) require using the terminal or agent.

## Requirements

- Right-click context menu on files: Open, Open on Canvas, Rename, Delete, Copy Path
- Right-click context menu on folders: New File, New Folder, Rename, Delete, Copy Path
- Inline rename (click on name to edit)
- New file/folder button in the explorer header
- Drag and drop files onto canvas to open as file windows
- Confirmation dialog for delete operations

## Current State

- File explorer renders tree via `read_dir_tree` Tauri command
- Clicking files opens them in the editor panel
- No context menus exist
- Tauri backend already has: create_file, delete_file, rename_file commands (ready to wire up)
