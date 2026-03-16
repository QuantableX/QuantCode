import { computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { useWorkspacesStore } from '../stores/workspaces'
import { useCanvasStore } from '../stores/canvas'
import type { WorkspaceInfo } from '../shared/types'

export function useWorkspaces() {
  const workspacesStore = useWorkspacesStore()
  const canvasStore = useCanvasStore()

  // ---- Computed State ----

  const workspaces = computed<WorkspaceInfo[]>(() => {
    return workspacesStore.workspaces
  })

  const activeWorkspace = computed<WorkspaceInfo | undefined>(() => {
    return workspacesStore.activeWorkspace
  })

  const activeWorkspaceId = computed<string | null>(() => {
    return workspacesStore.activeWorkspaceId
  })

  const hasWorkspaces = computed(() => {
    return workspacesStore.workspaces.length > 0
  })

  // ---- Actions ----

  function openWorkspace(folderPath: string, name: string): WorkspaceInfo {
    // Check if workspace is already open
    const existing = workspacesStore.workspaces.find(w => w.folderPath === folderPath)
    if (existing) {
      workspacesStore.setActiveWorkspace(existing.id)
      canvasStore.initCanvas(existing.id)
      return existing
    }

    const now = new Date().toISOString()
    const workspace: WorkspaceInfo = {
      id: uuidv4(),
      name,
      folderPath,
      lastOpened: now,
      createdAt: now,
    }

    workspacesStore.addWorkspace(workspace)
    canvasStore.initCanvas(workspace.id)

    return workspace
  }

  function closeWorkspace(id: string): void {
    workspacesStore.removeWorkspace(id)
  }

  async function switchWorkspace(id: string): Promise<void> {
    const workspace = workspacesStore.workspaces.find(w => w.id === id)
    if (!workspace) {
      throw new Error(`Workspace not found: ${id}`)
    }

    workspacesStore.setActiveWorkspace(id)

    // Load the canvas state for this workspace
    await canvasStore.loadCanvasState(id)
  }

  function renameWorkspace(id: string, name: string): void {
    workspacesStore.updateWorkspace(id, { name })
  }

  async function initFromDisk(): Promise<void> {
    await workspacesStore.loadFromDisk()

    // Initialize canvas for the active workspace
    const activeId = workspacesStore.activeWorkspaceId
    if (activeId) {
      await canvasStore.loadCanvasState(activeId)
    }
  }

  function getWorkspace(id: string): WorkspaceInfo | undefined {
    return workspacesStore.workspaces.find(w => w.id === id)
  }

  return {
    // State
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    hasWorkspaces,
    // Actions
    openWorkspace,
    closeWorkspace,
    switchWorkspace,
    renameWorkspace,
    initFromDisk,
    getWorkspace,
  }
}
