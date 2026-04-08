# QuantCode

## Overview

QuantCode is a **standalone spec-driven Agentic Development Environment (ADE)**. A full desktop application — not a VS Code extension — built around an **infinity canvas** where AI agents run as floating, draggable console windows. Think of it as a spatial workspace: your file explorer lives on the left, your editor on the right, and the canvas in between holds any number of live agent sessions you can arrange freely.

You can run multiple **independent workspaces** — each bound to a different folder on disk, with its own canvas layout, agent sessions, editor tabs, and spec state. Switch between them instantly from the workspace switcher in the title bar. Nothing bleeds between workspaces.

The core idea: **living specifications** drive development. You write specs, agents implement them, and the specs update to reflect reality. Agents run in persistent floating windows on the canvas — you can have Claude Code, a terminal, a reviewer, and a tester all visible at once, spatially organized how you think.

## UI Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  QuantCode  [ backend  ▾ ]  [ frontend  ▾ ]  [ +  ]    zoom 100% ● 4 tiles │
├──────────┬──────────────────────────────────────────┬───────────────┤
│          │                                          │               │
│  File    │           ∞  Canvas                      │   Editor      │
│ Explorer │                                          │   (Monaco)    │
│          │   ╔══════════════╗   ╔════════════════╗  │               │
│  [tree]  │   ║ Claude Code  ║   ║  Reviewer      ║  │  [active      │
│          │   ║              ║   ║                ║  │   file]       │
│          │   ║ > how can    ║   ║ > lgtm, one    ║  │               │
│          │   ║   I help?    ║   ║   suggestion.. ║  │               │
│          │   ║              ║   ╚════════════════╝  │               │
│          │   ╚══════════════╝                        │               │
│ [toggle] │        ╔══════════════╗           ...    │  [toggle]     │
│    ◁     │        ║  Terminal    ║                  │      ▷        │
│          │        ║ ~/project $  ║                  │               │
│          │        ╚══════════════╝                  │               │
├──────────┴──────────────────────────────────────────┴───────────────┤
│  right click: new agent  │  drag header: move  │  scroll: pan       │
└─────────────────────────────────────────────────────────────────────┘
```

### Panels

| Panel | Default | Toggle |
|---|---|---|
| **File Explorer** | Left sidebar, visible | `Ctrl+B` |
| **Editor** | Right sidebar, visible | `Ctrl+Shift+B` |
| **Canvas** | Center, always present | — |

### Workspace Switcher (Title Bar)

Workspaces are fully independent environments — different folder, different canvas, different agents, different editor tabs. Nothing is shared between them.

- Displayed as labeled tabs in the title bar: `[ backend ▾ ] [ frontend ▾ ] [ + ]`
- Click `[ + ]` to open a folder and create a new workspace
- Click a workspace name to switch to it instantly
- Click `▾` on a workspace tab to rename, reveal folder, or close it
- Each workspace has its own:
  - Root directory (bound to a folder on disk)
  - Canvas state (window positions, zoom, pan offset)
  - Agent sessions (paused when workspace is not active, resumed on switch)
  - File Explorer tree and expanded state
  - Editor tabs and cursor positions
  - Spec engine state
- Workspace list and metadata persists to `~/.quantcode/workspaces.json`
- Individual canvas state persists per-workspace to `<folder>/.quantcode/canvas.json`
- Switching is instant — the previous workspace's canvas is frozen in memory, not destroyed
- `Ctrl+Tab` / `Ctrl+Shift+Tab` cycles through open workspaces

### Canvas

The canvas is the heart of QuantCode. It is an infinite, pannable, zoomable space where **agent console windows** float freely.

- Dark background with subtle dot-grid pattern
- Two-finger scroll or middle-click drag to pan
- Pinch or `Ctrl+Scroll` to zoom
- Zoom level and tile count shown in the top-right corner
- Right-click anywhere to spawn a new agent window
- Each window has a draggable header, resize handles, and a close button
- Windows snap to a grid when dragging (optional)
- Window state (position, size, agent session) persists across restarts

### Agent Console Windows

Each floating window is a self-contained agent session. Window types:

- **AI Agent** — conversational interface to an AI model (Claude, GPT, Ollama). Full tool use, file reads/writes, terminal execution, diff preview. Shows model name and status (live / idle / thinking) in the title bar.
- **Terminal** — raw PTY terminal via xterm.js. Labeled `TTY` in the title bar.
- **Diff Preview** — side-by-side diff viewer for agent-proposed changes, with accept/reject controls.
- **Spec Dashboard** — live view of `.spec.md` files, status tracking, and spec↔code links.

### File Explorer (Left Sidebar)

- Workspace tree with `.gitignore`-aware filtering
- Context menus for file operations (new, rename, delete, copy path)
- Click to open file in the Editor panel
- Git status decorations (modified, untracked, staged)
- Collapsible — slides off-canvas when hidden

### Editor (Right Sidebar)

- Monaco editor with full syntax highlighting and IntelliSense
- Multi-tab editing
- Inline diff decorations from agent-proposed changes — accept or reject per-hunk
- Collapsible — slides off-canvas when hidden

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Tauri Shell                            │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │               Frontend (Nuxt.js / Vue 3)               │  │
│  │                                                       │  │
│  │  ┌────────────────────────────────────────────────┐   │  │
│  │  │  WorkspaceSwitcher (title bar tabs)             │   │  │
│  │  └────────────────────────────────────────────────┘   │  │
│  │  ┌─────────────┐  ┌──────────────────────────────┐   │  │
│  │  │ FileExplorer│  │         InfinityCanvas        │   │  │
│  │  │  (sidebar)  │  │  ┌──────────┐ ┌───────────┐  │   │  │
│  │  └─────────────┘  │  │AgentWindow│ │AgentWindow│  │   │  │
│  │  ┌─────────────┐  │  └──────────┘ └───────────┘  │   │  │
│  │  │MonacoEditor │  │  ┌──────────┐                 │   │  │
│  │  │  (sidebar)  │  │  │TermWindow│    ...          │   │  │
│  │  └─────────────┘  │  └──────────┘                 │   │  │
│  │                   └──────────────────────────────┘   │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │ IPC (invoke)                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │               Backend (Tauri / Rust)                   │  │
│  │                                                       │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐            │  │
│  │  │ File Ops │  │   Git    │  │ PTY/Term │            │  │
│  │  └──────────┘  └──────────┘  └──────────┘            │  │
│  │  ┌──────────────────────────────────────────────┐     │  │
│  │  │  Workspace & Canvas State Persistence         │     │  │
│  │  └──────────────────────────────────────────────┘     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  AI calls and agent orchestration live in the frontend       │
│  (TypeScript) using fetch() directly to AI providers         │
└──────────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Desktop Shell**: Tauri v2 (Rust)
- **Frontend**: Nuxt 3 (Vue 3 + TypeScript)
- **Canvas**: Custom Vue infinite canvas (pan/zoom via CSS transforms)
- **Drag & Drop**: VueUse `useDraggable` + custom resize handles
- **Editor**: Monaco Editor
- **Terminal**: xterm.js
- **State Management**: Pinia
- **Styling**: Tailwind CSS 4
- **AI Providers**: Claude (Anthropic), GPT (OpenAI), Ollama — via fetch()
- **Agent Protocol**: MCP (Model Context Protocol) for tool use
- **Spec Format**: Markdown `.spec.md` files with YAML frontmatter
- **Packaging**: Tauri bundler (Windows NSIS, macOS DMG, Linux AppImage)

## Core Features

### Infinity Canvas

The spatial workspace. An infinite, pannable, zoomable canvas that holds agent windows.

- Pan: middle-click drag or two-finger scroll
- Zoom: `Ctrl+Scroll` or pinch, with level indicator
- Spawn agent: right-click → select agent type
- Tile count indicator shows how many windows are open
- Canvas state (window positions, sizes, sessions) persists to `<folder>/.quantcode/canvas.json`
- Minimap overlay (optional) for orientation at high zoom-out

### Agent Console Windows

Floating windows on the canvas. Each is an independent agent session.

- Drag by header to reposition freely on the canvas
- Resize from any edge or corner
- Title bar shows: agent name, model, live/idle status
- Minimize to a compact header strip (keeps session alive)
- Duplicate a window to fork the session
- Full tool use: file read/write, terminal commands, search, git — with approval UI
- Streaming responses with inline diff preview before applying changes
- Resumable sessions — closing a window does not kill the agent

### Workspace Management

Multiple independent workspaces, each owning a folder on disk.

- Open any local folder as a new workspace (`Ctrl+O` or `[ + ]` in the title bar)
- Switch between workspaces via title bar tabs or `Ctrl+Tab`
- Each workspace is fully isolated: its own canvas, agents, editor state, and spec engine
- Agent sessions in background workspaces are paused, not killed — they resume when you switch back
- Close a workspace without losing its state — reopen it later and pick up exactly where you left off
- Workspace metadata (name, folder path, last opened) stored in `~/.quantcode/workspaces.json`

### Living Specifications (Spec Engine)

The core differentiator. Specs are the source of truth for the project.

- `.quantcode/specs/*.spec.md` files define goals, tasks, decisions, and constraints
- Specs link to code symbols — when code changes, specs reflect it
- Agents read specs before acting and update them after completing work
- Spec Dashboard window shows live status: open → done

### Multi-Agent Orchestration

- **Coordinator agent**: reads specs, breaks work into tasks, delegates to specialists
- **Specialist agents**: coder, reviewer, tester — each in its own canvas window
- **Verifier agent**: validates results against specifications
- MCP protocol for structured tool use
- Tool approval UI — review and approve/deny each tool call before execution

### Built-in Editor (Monaco)

- Full Monaco with syntax highlighting
- Multi-tab editing
- Inline diff decorations from agent-proposed changes — accept or reject per-hunk
- Right sidebar, collapsible

### File Explorer

- Workspace tree, `.gitignore`-aware
- Git status decorations
- Left sidebar, collapsible

### Integrated Terminal

- xterm.js with Rust PTY backend via Tauri
- Runs as a canvas window (type: `TTY`)
- Agents can execute commands with user approval

### Git Integration

- Status, diff, staging, commits via Rust backend
- Branch management
- Status decorations in the file explorer

## Repository Structure

```
quantcode/
├── package.json
├── nuxt.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── project.md
│
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   ├── icons/
│   └── src/
│       ├── lib.rs
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── fs.rs
│       │   ├── git.rs
│       │   ├── terminal.rs
│       │   └── workspace.rs
│       └── state.rs
│
├── app/
│   ├── app.vue
│   ├── pages/
│   │   └── index.vue               # Root layout: explorer + canvas + editor
│   └── components/
│       ├── Workspace/
│       │   └── WorkspaceSwitcher.vue  # Title bar workspace tabs
│       ├── Canvas/
│       │   ├── InfinityCanvas.vue  # Pan/zoom canvas container
│       │   ├── CanvasWindow.vue    # Floating draggable/resizable window shell
│       │   └── Minimap.vue         # Optional minimap overlay
│       ├── Windows/
│       │   ├── AgentWindow.vue     # AI agent console window
│       │   ├── TerminalWindow.vue  # PTY terminal window
│       │   ├── DiffWindow.vue      # Diff preview window
│       │   └── SpecWindow.vue      # Spec dashboard window
│       ├── Sidebar/
│       │   ├── FileExplorer.vue    # Left sidebar file tree
│       │   └── EditorPanel.vue     # Right sidebar Monaco editor
│       └── UI/
│           ├── ToolApproval.vue    # Tool call approval dialog
│           ├── MessageBubble.vue   # Chat message component
│           └── StatusBar.vue       # Bottom status bar with hints
│
├── composables/
│   ├── useCanvas.ts                # Canvas pan/zoom state (per workspace)
│   ├── useWindows.ts               # Window registry (spawn, close, persist)
│   ├── useAgent.ts                 # Agent session management
│   ├── useSpecs.ts                 # Spec engine
│   ├── useWorkspace.ts             # Active workspace file/folder access via Tauri
│   ├── useWorkspaces.ts            # Workspace list, switching, open/close
│   └── useTerminal.ts              # Terminal session management
│
├── stores/
│   ├── workspaces.ts               # All open workspaces + active workspace ID
│   ├── canvas.ts                   # Canvas state keyed by workspace ID
│   └── app.ts                      # Global app state (sidebars, UI)
│
├── lib/
│   ├── agents/
│   │   ├── orchestrator.ts
│   │   └── roles.ts
│   ├── mcp/
│   │   ├── client.ts
│   │   └── tools.ts
│   ├── specs/
│   │   └── engine.ts
│   └── providers/
│       ├── base.ts
│       ├── anthropic.ts
│       ├── openai.ts
│       └── ollama.ts
│
├── shared/
│   └── types.ts
│
└── assets/
    └── css/
        └── main.css
```

## Design Principles

- **Spatial, not tabbed**: Agents live as persistent windows in 2D space — you see the whole picture at once.
- **Standalone app, not a plugin**: QuantCode is its own application. A real desktop tool.
- **Spec-driven, not prompt-driven**: Developers define intent through structured specs. Agents work from specs, not vibes.
- **Local-first**: No mandatory cloud. No accounts required. API keys stored locally.
- **Keyboard-first**: Every action reachable via keyboard. Command palette for discovery.
- **Minimal chrome**: Dark canvas, thin window borders, monospace type. The code and agents are the UI.
- **Lean binary**: Tauri uses the OS webview — no bundled Chromium. Small, fast, native.

## Build & Run

```bash
# Install dependencies
npm install

# Development (hot-reload frontend + Tauri dev window)
npm run tauri dev

# Build for production
npm run tauri build

# Output: native installer in src-tauri/target/release/bundle/
```
