import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { WorkspaceInfo, WorkspacesConfig } from '../shared/types'

export const useWorkspacesStore = defineStore('workspaces', () => {
  // ---- State ----
  const workspaces = ref<WorkspaceInfo[]>([])
  const activeWorkspaceId = ref<string | null>(null)

  // ---- Getters ----
  const activeWorkspace = computed<WorkspaceInfo | undefined>(() => {
    if (!activeWorkspaceId.value) return undefined
    return workspaces.value.find(w => w.id === activeWorkspaceId.value)
  })

  // ---- Actions ----

  function addWorkspace(workspace: WorkspaceInfo): void {
    workspaces.value.push(workspace)
    if (!activeWorkspaceId.value) {
      activeWorkspaceId.value = workspace.id
    }
    saveToDisk()
  }

  function removeWorkspace(id: string): void {
    const index = workspaces.value.findIndex(w => w.id === id)
    if (index === -1) return

    workspaces.value.splice(index, 1)

    if (activeWorkspaceId.value === id) {
      activeWorkspaceId.value = workspaces.value.length > 0
        ? workspaces.value[0].id
        : null
    }
    saveToDisk()
  }

  function setActiveWorkspace(id: string): void {
    const workspace = workspaces.value.find(w => w.id === id)
    if (!workspace) return

    activeWorkspaceId.value = id
    workspace.lastOpened = new Date().toISOString()
    saveToDisk()
  }

  function updateWorkspace(id: string, updates: Partial<Omit<WorkspaceInfo, 'id'>>): void {
    const workspace = workspaces.value.find(w => w.id === id)
    if (!workspace) return

    Object.assign(workspace, updates)
    saveToDisk()
  }

  async function loadFromDisk(): Promise<void> {
    try {
      const raw = await invoke<string>('load_workspaces')
      const config = JSON.parse(raw) as WorkspacesConfig
      workspaces.value = config.workspaces
      activeWorkspaceId.value = config.activeWorkspaceId
    } catch (error) {
      console.error('Failed to load workspaces from disk:', error)
    }
  }

  async function saveToDisk(): Promise<void> {
    try {
      const config: WorkspacesConfig = {
        workspaces: workspaces.value,
        activeWorkspaceId: activeWorkspaceId.value,
      }
      await invoke('save_workspaces', { data: JSON.stringify(config) })
    } catch (error) {
      console.error('Failed to save workspaces to disk:', error)
    }
  }

  return {
    // State
    workspaces,
    activeWorkspaceId,
    // Getters
    activeWorkspace,
    // Actions
    addWorkspace,
    removeWorkspace,
    setActiveWorkspace,
    updateWorkspace,
    loadFromDisk,
    saveToDisk,
  }
})
