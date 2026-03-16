import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspacesStore } from './workspaces'
import type { CanvasState, CanvasTransform, CanvasWindow, WindowPosition } from '../shared/types'

function createDefaultCanvasState(workspaceId: string): CanvasState {
  return {
    workspaceId,
    transform: { x: 0, y: 0, scale: 1 },
    windows: [],
    nextZIndex: 1,
  }
}

export const useCanvasStore = defineStore('canvas', () => {
  // ---- State ----
  const canvasStates = ref<Map<string, CanvasState>>(new Map())

  // ---- Getters ----
  const activeCanvasState = computed<CanvasState | undefined>(() => {
    const workspacesStore = useWorkspacesStore()
    const id = workspacesStore.activeWorkspaceId
    if (!id) return undefined
    return canvasStates.value.get(id)
  })

  // ---- Actions ----

  function initCanvas(workspaceId: string): CanvasState {
    if (!canvasStates.value.has(workspaceId)) {
      canvasStates.value.set(workspaceId, createDefaultCanvasState(workspaceId))
    }
    return canvasStates.value.get(workspaceId)!
  }

  function getCanvasState(workspaceId: string): CanvasState | undefined {
    return canvasStates.value.get(workspaceId)
  }

  function updateTransform(workspaceId: string, transform: Partial<CanvasTransform>): void {
    const state = canvasStates.value.get(workspaceId)
    if (!state) return

    Object.assign(state.transform, transform)
    debouncedSaveTransform(workspaceId)
  }

  // Debounce transform saves to avoid excessive disk writes during pan/zoom
  let saveTransformTimer: ReturnType<typeof setTimeout> | null = null
  function debouncedSaveTransform(workspaceId: string): void {
    if (saveTransformTimer) clearTimeout(saveTransformTimer)
    saveTransformTimer = setTimeout(() => {
      saveCanvasState(workspaceId)
    }, 500)
  }

  function addWindow(workspaceId: string, window: CanvasWindow): void {
    const state = canvasStates.value.get(workspaceId)
    if (!state) return

    window.zIndex = state.nextZIndex
    state.nextZIndex += 1
    state.windows.push(window)
    saveCanvasState(workspaceId)
  }

  function removeWindow(workspaceId: string, windowId: string): void {
    const state = canvasStates.value.get(workspaceId)
    if (!state) return

    const index = state.windows.findIndex(w => w.id === windowId)
    if (index !== -1) {
      state.windows.splice(index, 1)
      saveCanvasState(workspaceId)
    }
  }

  function updateWindow(workspaceId: string, windowId: string, updates: Partial<Omit<CanvasWindow, 'id'>>): void {
    const state = canvasStates.value.get(workspaceId)
    if (!state) return

    const window = state.windows.find(w => w.id === windowId)
    if (!window) return

    Object.assign(window, updates)
    saveCanvasState(workspaceId)
  }

  function updateWindowPosition(workspaceId: string, windowId: string, position: Partial<WindowPosition>): void {
    const state = canvasStates.value.get(workspaceId)
    if (!state) return

    const window = state.windows.find(w => w.id === windowId)
    if (!window) return

    Object.assign(window.position, position)
  }

  function bringToFront(workspaceId: string, windowId: string): void {
    const state = canvasStates.value.get(workspaceId)
    if (!state) return

    const window = state.windows.find(w => w.id === windowId)
    if (!window) return

    window.zIndex = state.nextZIndex
    state.nextZIndex += 1
  }

  async function loadCanvasState(workspaceId: string): Promise<void> {
    try {
      const workspacesStore = useWorkspacesStore()
      const ws = workspacesStore.workspaces.find(w => w.id === workspaceId)
      if (!ws) {
        initCanvas(workspaceId)
        return
      }
      const raw = await invoke<string>('load_canvas_state', { folderPath: ws.folderPath })
      const state = JSON.parse(raw) as CanvasState
      if (state && Array.isArray(state.windows)) {
        canvasStates.value.set(workspaceId, state)
      } else {
        initCanvas(workspaceId)
      }
    } catch (error) {
      console.error(`Failed to load canvas state for workspace ${workspaceId}:`, error)
      initCanvas(workspaceId)
    }
  }

  async function saveCanvasState(workspaceId: string): Promise<void> {
    const state = canvasStates.value.get(workspaceId)
    if (!state) return

    try {
      const workspacesStore = useWorkspacesStore()
      const ws = workspacesStore.workspaces.find(w => w.id === workspaceId)
      if (!ws) return
      await invoke('save_canvas_state', { folderPath: ws.folderPath, data: JSON.stringify(state) })
    } catch (error) {
      console.error(`Failed to save canvas state for workspace ${workspaceId}:`, error)
    }
  }

  return {
    // State
    canvasStates,
    // Getters
    activeCanvasState,
    // Actions
    initCanvas,
    getCanvasState,
    updateTransform,
    addWindow,
    removeWindow,
    updateWindow,
    updateWindowPosition,
    bringToFront,
    loadCanvasState,
    saveCanvasState,
  }
})
