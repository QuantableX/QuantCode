---
title: Command Palette
status: planned
priority: medium
linkedFiles:
  - stores/app.ts
  - app/components/Canvas/InfinityCanvas.vue
tags:
  - ui
  - productivity
createdAt: 2026-03-18T20:50:00.000Z
updatedAt: 2026-03-18T20:50:00.000Z
---

A command palette (Ctrl+Shift+P) for quick access to all app actions. The state flag `commandPaletteOpen` exists in the app store but no component is rendered.

## Requirements

- Ctrl+Shift+P to open/close
- Fuzzy search across all available commands
- Commands: spawn windows (agent, terminal, browser, diff, spec), workspace actions (open, switch), toggle panels, theme, settings, git operations
- Recent commands section
- Keyboard navigation (arrow keys, Enter to select, Esc to close)

## Current State

- `commandPaletteOpen` boolean exists in app store
- No CommandPalette component exists
- No command registry system
