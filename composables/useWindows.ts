import { computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { useCanvasStore } from '../stores/canvas'
import { useWorkspacesStore } from '../stores/workspaces'
import type { CanvasWindow, WindowType, WindowPosition, AgentConfig, FileConfig, BrowserConfig } from '../shared/types'

interface SpawnWindowOptions {
  title?: string
  position?: Partial<WindowPosition>
  agentConfig?: AgentConfig
  fileConfig?: FileConfig
  browserConfig?: BrowserConfig
}

const WINDOW_TITLES: Record<WindowType, string> = {
  agent: 'Claude Code',
  terminal: 'Terminal',
  diff: 'Diff Preview',
  spec: 'Spec Dashboard',
  file: 'File',
  browser: 'Browser',
}

const DEFAULT_WINDOW_SIZE: Record<WindowType, { width: number; height: number }> = {
  agent: { width: 480, height: 600 },
  terminal: { width: 600, height: 400 },
  diff: { width: 700, height: 500 },
  spec: { width: 550, height: 450 },
  file: { width: 500, height: 400 },
  browser: { width: 700, height: 500 },
}

const SPAWN_OFFSET = 40
const DEFAULT_SPAWN_X = 100
const DEFAULT_SPAWN_Y = 100

export function useWindows() {
  const canvasStore = useCanvasStore()
  const workspacesStore = useWorkspacesStore()

  // ---- Computed State ----

  const windows = computed<CanvasWindow[]>(() => {
    const state = canvasStore.activeCanvasState
    return state?.windows ?? []
  })

  const tileCount = computed(() => {
    return windows.value.filter(w => !w.minimized).length
  })

  // ---- Helper: Get active workspace ID (throws if none) ----

  function getWorkspaceId(): string {
    const id = workspacesStore.activeWorkspaceId
    if (!id) {
      throw new Error('No active workspace')
    }
    return id
  }

  // ---- Compute spawn position ----

  function computeSpawnPosition(type: WindowType, explicitPosition?: Partial<WindowPosition>): WindowPosition {
    const size = DEFAULT_WINDOW_SIZE[type]
    const existingWindows = windows.value

    // If there are existing windows, offset from the last one
    let baseX = DEFAULT_SPAWN_X
    let baseY = DEFAULT_SPAWN_Y

    if (existingWindows.length > 0) {
      const last = existingWindows[existingWindows.length - 1]
      baseX = last.position.x + SPAWN_OFFSET
      baseY = last.position.y + SPAWN_OFFSET
    }

    return {
      x: explicitPosition?.x ?? baseX,
      y: explicitPosition?.y ?? baseY,
      width: explicitPosition?.width ?? size.width,
      height: explicitPosition?.height ?? size.height,
    }
  }

  // ---- Window Management ----

  function spawnWindow(type: WindowType, options?: SpawnWindowOptions): CanvasWindow {
    const workspaceId = getWorkspaceId()
    const position = computeSpawnPosition(type, options?.position)

    const title = options?.title || WINDOW_TITLES[type]

    const window: CanvasWindow = {
      id: uuidv4(),
      type,
      title,
      position,
      status: 'idle',
      minimized: false,
      zIndex: 0, // Will be set by store's addWindow
      agentConfig: options?.agentConfig,
      fileConfig: options?.fileConfig,
      browserConfig: options?.browserConfig,
    }

    canvasStore.addWindow(workspaceId, window)
    return window
  }

  function closeWindow(id: string): void {
    const workspaceId = getWorkspaceId()
    canvasStore.removeWindow(workspaceId, id)
  }

  function updateWindowPosition(id: string, position: Partial<WindowPosition>): void {
    const workspaceId = getWorkspaceId()
    canvasStore.updateWindowPosition(workspaceId, id, position)
  }

  function bringToFront(id: string): void {
    const workspaceId = getWorkspaceId()
    canvasStore.bringToFront(workspaceId, id)
  }

  function minimizeWindow(id: string): void {
    const workspaceId = getWorkspaceId()
    canvasStore.updateWindow(workspaceId, id, {
      minimized: true,
      status: 'minimized',
    })
  }

  function restoreWindow(id: string): void {
    const workspaceId = getWorkspaceId()
    canvasStore.updateWindow(workspaceId, id, {
      minimized: false,
      status: 'idle',
    })
  }

  function getWindow(id: string): CanvasWindow | undefined {
    return windows.value.find(w => w.id === id)
  }

  function updateWindowTitle(id: string, title: string): void {
    const workspaceId = getWorkspaceId()
    canvasStore.updateWindow(workspaceId, id, { title })
  }

  function updateWindowStatus(id: string, status: CanvasWindow['status']): void {
    const workspaceId = getWorkspaceId()
    canvasStore.updateWindow(workspaceId, id, { status })
  }

  return {
    // State
    windows,
    tileCount,
    // Actions
    spawnWindow,
    closeWindow,
    updateWindowPosition,
    bringToFront,
    minimizeWindow,
    restoreWindow,
    getWindow,
    updateWindowTitle,
    updateWindowStatus,
  }
}
