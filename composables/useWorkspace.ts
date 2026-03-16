import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspacesStore } from '../stores/workspaces'
import type { FileNode } from '../shared/types'

export function useWorkspace() {
  const workspacesStore = useWorkspacesStore()
  const fileTree = ref<FileNode[]>([])
  const loadingTree = ref(false)
  const treeError = ref<string | null>(null)

  // ---- Computed ----

  const workspacePath = computed<string | null>(() => {
    const active = workspacesStore.activeWorkspace
    return active?.folderPath ?? null
  })

  // ---- File Operations ----

  function resolveWorkspacePath(): string {
    const path = workspacePath.value
    if (!path) {
      throw new Error('No active workspace')
    }
    return path
  }

  async function readFile(relativePath: string): Promise<string> {
    const wp = resolveWorkspacePath()
    return invoke<string>('read_file', { path: wp + '/' + relativePath })
  }

  async function writeFile(relativePath: string, content: string): Promise<void> {
    const wp = resolveWorkspacePath()
    await invoke('write_file', { path: wp + '/' + relativePath, content })
  }

  async function createFile(relativePath: string, isDirectory: boolean): Promise<void> {
    const wp = resolveWorkspacePath()
    await invoke('create_file', { path: wp + '/' + relativePath, isDirectory })
  }

  async function deleteFile(relativePath: string): Promise<void> {
    const wp = resolveWorkspacePath()
    await invoke('delete_file', { path: wp + '/' + relativePath })
  }

  async function renameFile(oldPath: string, newPath: string): Promise<void> {
    const wp = resolveWorkspacePath()
    await invoke('rename_file', { oldPath: wp + '/' + oldPath, newPath: wp + '/' + newPath })
  }

  // ---- File Tree ----

  async function loadFileTree(): Promise<void> {
    const wp = workspacePath.value
    if (!wp) {
      fileTree.value = []
      return
    }

    loadingTree.value = true
    treeError.value = null

    try {
      const tree = await invoke<FileNode[]>('read_dir_tree', { path: wp, gitignore: true })
      fileTree.value = sortFileTree(tree)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      treeError.value = `Failed to load file tree: ${message}`
      fileTree.value = []
    } finally {
      loadingTree.value = false
    }
  }

  async function refreshFileTree(): Promise<void> {
    await loadFileTree()
  }

  function sortFileTree(nodes: FileNode[]): FileNode[] {
    return nodes
      .map(node => ({
        ...node,
        children: node.children ? sortFileTree(node.children) : undefined,
      }))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })
  }

  function toggleNodeExpanded(path: string): void {
    const node = findNode(fileTree.value, path)
    if (node && node.isDirectory) {
      node.expanded = !node.expanded
    }
  }

  function findNode(nodes: FileNode[], path: string): FileNode | null {
    for (const node of nodes) {
      if (node.path === path) return node
      if (node.children) {
        const found = findNode(node.children, path)
        if (found) return found
      }
    }
    return null
  }

  return {
    // State
    workspacePath,
    fileTree,
    loadingTree,
    treeError,
    // File operations
    readFile,
    writeFile,
    createFile,
    deleteFile,
    renameFile,
    // File tree
    loadFileTree,
    refreshFileTree,
    toggleNodeExpanded,
  }
}
