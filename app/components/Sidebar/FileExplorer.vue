<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { useWorkspacesStore } from '../../../stores/workspaces'
import { useAppStore } from '../../../stores/app'
import type { FileNode, GitFileStatus } from '../../../shared/types'
import { onClickOutside } from '@vueuse/core'

const workspacesStore = useWorkspacesStore()
const appStore = useAppStore()

const fileTree = ref<FileNode[]>([])
const filterText = ref('')
const loading = ref(false)

// Context menu
const contextMenu = ref({ visible: false, x: 0, y: 0, node: null as FileNode | null })
const contextMenuRef = ref<HTMLElement | null>(null)

// Delete confirmation modal
const confirmDeleteVisible = ref(false)
const pendingDeleteNode = ref<FileNode | null>(null)

onClickOutside(contextMenuRef, () => {
  contextMenu.value.visible = false
})

const filteredTree = computed(() => {
  if (!filterText.value.trim()) return fileTree.value
  return filterNodes(fileTree.value, filterText.value.toLowerCase())
})

function filterNodes(nodes: FileNode[], query: string): FileNode[] {
  const result: FileNode[] = []
  for (const node of nodes) {
    if (node.name.toLowerCase().includes(query)) {
      result.push(node)
    } else if (node.isDirectory && node.children) {
      const filtered = filterNodes(node.children, query)
      if (filtered.length > 0) {
        result.push({ ...node, children: filtered, expanded: true })
      }
    }
  }
  return result
}

function collectExpandedPaths(nodes: FileNode[]): Set<string> {
  const paths = new Set<string>()
  for (const node of nodes) {
    if (node.isDirectory && node.expanded) {
      paths.add(node.path)
    }
    if (node.children) {
      for (const p of collectExpandedPaths(node.children)) {
        paths.add(p)
      }
    }
  }
  return paths
}

function restoreExpandedPaths(nodes: FileNode[], expanded: Set<string>): void {
  for (const node of nodes) {
    if (node.isDirectory && expanded.has(node.path)) {
      node.expanded = true
    }
    if (node.children) {
      restoreExpandedPaths(node.children, expanded)
    }
  }
}

async function loadFileTree() {
  const workspace = workspacesStore.activeWorkspace
  if (!workspace) return

  // Remember which folders are expanded
  const expandedPaths = collectExpandedPaths(fileTree.value)

  loading.value = true
  try {
    const tree = await invoke<FileNode[]>('read_dir_tree', {
      path: workspace.folderPath,
      gitignore: true,
    })
    restoreExpandedPaths(tree, expandedPaths)
    fileTree.value = tree
  } catch {
    fileTree.value = []
  } finally {
    loading.value = false
  }
}

// Watch for external refresh trigger
watch(() => appStore.fileExplorerRefreshKey, () => {
  loadFileTree()
})

function toggleExpand(node: FileNode) {
  if (node.isDirectory) {
    node.expanded = !node.expanded
  }
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'])

function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTS.has(ext)
}

async function openFile(node: FileNode) {
  if (node.isDirectory) {
    toggleExpand(node)
    return
  }

  const fullPath = getFullPath(node)

  // Image files: load as base64 data URL
  if (isImageFile(node.name)) {
    try {
      const result = await invoke<{ base64Data: string; mimeType: string; sizeBytes: number }>('read_file_binary', {
        path: fullPath,
      })
      const dataUrl = `data:${result.mimeType};base64,${result.base64Data}`
      appStore.openTab(fullPath, dataUrl)
      if (!appStore.editorVisible) {
        appStore.toggleEditor()
      }
    } catch {
      appStore.openTab(fullPath, '')
      if (!appStore.editorVisible) {
        appStore.toggleEditor()
      }
    }
    return
  }

  try {
    const content = await invoke<string>('read_file', {
      path: node.path,
    })
    appStore.openTab(node.path, content)
    if (!appStore.editorVisible) {
      appStore.toggleEditor()
    }
  } catch {
    // Fallback for dev/demo — try with workspace prefix for relative paths
    try {
      const workspace = workspacesStore.activeWorkspace
      if (workspace) {
        const content = await invoke<string>('read_file', {
          path: workspace.folderPath + '/' + node.path,
        })
        appStore.openTab(node.path, content)
        if (!appStore.editorVisible) {
          appStore.toggleEditor()
        }
        return
      }
    } catch { /* fall through */ }
    appStore.openTab(node.path, `// Could not read ${node.name}\n`)
    if (!appStore.editorVisible) {
      appStore.toggleEditor()
    }
  }
}

function onContextMenu(e: MouseEvent, node: FileNode) {
  e.preventDefault()
  e.stopPropagation()
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, node }
}

function onFileDragStart(e: DragEvent, node: FileNode) {
  if (!e.dataTransfer || node.isDirectory) return
  const fullPath = getFullPath(node)
  e.dataTransfer.setData('application/x-quantcode-file', fullPath)
  e.dataTransfer.setData('text/plain', fullPath)
  e.dataTransfer.effectAllowed = 'copy'
}

function getParentDir(filePath: string): string {
  // Handle both forward and backslash separators
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSep > 0 ? filePath.substring(0, lastSep) : filePath
}

async function contextAction(action: string) {
  const node = contextMenu.value.node
  contextMenu.value.visible = false
  if (!node) return

  switch (action) {
    case 'new-file': {
      const name = prompt('File name:')
      if (!name) return
      const dir = node.isDirectory ? node.path : getParentDir(node.path)
      try {
        await invoke('create_file', { path: dir + '/' + name, isDirectory: false })
        loadFileTree()
      } catch { /* ignore */ }
      break
    }
    case 'new-folder': {
      const name = prompt('Folder name:')
      if (!name) return
      const dir = node.isDirectory ? node.path : getParentDir(node.path)
      try {
        await invoke('create_file', { path: dir + '/' + name, isDirectory: true })
        loadFileTree()
      } catch { /* ignore */ }
      break
    }
    case 'rename': {
      const newName = prompt('New name:', node.name)
      if (!newName || newName === node.name) return
      try {
        const parentDir = getParentDir(node.path)
        await invoke('rename_file', {
          oldPath: node.path,
          newPath: parentDir + '/' + newName,
        })
        loadFileTree()
      } catch { /* ignore */ }
      break
    }
    case 'delete': {
      pendingDeleteNode.value = node
      confirmDeleteVisible.value = true
      break
    }
    case 'copy-path': {
      try {
        await navigator.clipboard.writeText(node.path)
      } catch { /* ignore */ }
      break
    }
    case 'open-on-canvas': {
      if (!node.isDirectory) {
        openFileOnCanvas(node)
      }
      break
    }
  }
}

async function handleDelete(confirmed: boolean) {
  confirmDeleteVisible.value = false
  if (!confirmed || !pendingDeleteNode.value) {
    pendingDeleteNode.value = null
    return
  }
  const node = pendingDeleteNode.value
  pendingDeleteNode.value = null
  try {
    await invoke('delete_file', { path: node.path })
    loadFileTree()
    appStore.notifyFileDeleted(node.path)
  } catch { /* ignore */ }
}

function openFileOnCanvas(node: FileNode) {
  // Emit a custom event that InfinityCanvas listens for
  const event = new CustomEvent('qc-open-file-on-canvas', {
    detail: { filePath: getFullPath(node) },
  })
  window.dispatchEvent(event)
}

function getFullPath(node: FileNode): string {
  // If the path is already absolute, use it directly
  if (node.path.includes(':') || node.path.startsWith('/')) {
    return node.path
  }
  // Otherwise, prepend workspace folder
  const workspace = workspacesStore.activeWorkspace
  if (workspace) {
    return workspace.folderPath + '/' + node.path
  }
  return node.path
}

const gitStatusStyle: Record<GitFileStatus, { letter: string; color: string }> = {
  modified: { letter: 'M', color: 'text-amber-400' },
  untracked: { letter: 'U', color: 'text-green-400' },
  staged: { letter: 'S', color: 'text-blue-400' },
  deleted: { letter: 'D', color: 'text-red-400' },
  renamed: { letter: 'R', color: 'text-purple-400' },
  clean: { letter: '', color: '' },
}

watch(() => workspacesStore.activeWorkspaceId, () => {
  loadFileTree()
})

onMounted(() => {
  loadFileTree()
})
</script>

<template>
  <div class="flex flex-col h-full text-sm" :style="{ background: 'var(--qc-bg-titlebar)' }">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 flex-shrink-0" :style="{ borderBottom: '1px solid var(--qc-border)' }">
      <span class="text-[10px] uppercase tracking-wider font-bold" :style="{ color: 'var(--qc-text-muted)' }">Explorer</span>
      <button
        class="text-[10px] transition-colors"
        :style="{ color: 'var(--qc-text-muted)' }"
        title="Refresh"
        @click="loadFileTree"
      >
        &#8635;
      </button>
    </div>

    <!-- Search/filter -->
    <div class="px-2 py-1.5 flex-shrink-0" :style="{ borderBottom: '1px solid var(--qc-border)' }">
      <input
        v-model="filterText"
        type="text"
        placeholder="Filter files..."
        class="w-full rounded px-2 py-1 text-xs outline-none focus:border-[#a0a0a8]/50 transition-colors"
        :style="{ background: 'var(--qc-bg-window)', border: '1px solid var(--qc-border)', color: 'var(--qc-text)' }"
      />
    </div>

    <!-- File tree -->
    <div class="flex-1 min-h-0 overflow-y-auto py-1">
      <div v-if="loading" class="flex items-center justify-center h-20 text-xs" :style="{ color: 'var(--qc-text-muted)' }">
        Loading...
      </div>
      <template v-else>
        <SidebarFileTreeNode
          v-for="node in filteredTree"
          :key="node.path"
          :node="node"
          :depth="0"
          :git-status-style="gitStatusStyle"
          @toggle="toggleExpand"
          @open="openFile"
          @contextmenu="onContextMenu"
          @dragstart="onFileDragStart"
        />
      </template>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        ref="contextMenuRef"
        class="fixed z-[9999] rounded-lg shadow-2xl py-1 min-w-[150px]"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px', background: 'var(--qc-bg-header)', border: '1px solid var(--qc-border)' }"
      >
        <button
          class="w-full text-left px-3 py-1.5 text-xs transition-colors hover:brightness-125"
          :style="{ color: 'var(--qc-text)' }"
          @click="contextAction('new-file')"
        >
          New File
        </button>
        <button
          class="w-full text-left px-3 py-1.5 text-xs transition-colors hover:brightness-125"
          :style="{ color: 'var(--qc-text)' }"
          @click="contextAction('new-folder')"
        >
          New Folder
        </button>
        <div :style="{ borderTop: '1px solid var(--qc-border)', margin: '4px 0' }" />
        <button
          class="w-full text-left px-3 py-1.5 text-xs transition-colors hover:brightness-125"
          :style="{ color: 'var(--qc-text)' }"
          @click="contextAction('rename')"
        >
          Rename
        </button>
        <button
          class="w-full text-left px-3 py-1.5 text-xs text-red-400 transition-colors hover:brightness-125"
          @click="contextAction('delete')"
        >
          Delete
        </button>
        <div :style="{ borderTop: '1px solid var(--qc-border)', margin: '4px 0' }" />
        <button
          class="w-full text-left px-3 py-1.5 text-xs transition-colors hover:brightness-125"
          :style="{ color: 'var(--qc-text)' }"
          @click="contextAction('copy-path')"
        >
          Copy Path
        </button>
        <template v-if="contextMenu.node && !contextMenu.node.isDirectory">
          <div :style="{ borderTop: '1px solid var(--qc-border)', margin: '4px 0' }" />
          <button
            class="w-full text-left px-3 py-1.5 text-xs transition-colors hover:brightness-125"
            :style="{ color: 'var(--qc-text)' }"
            @click="contextAction('open-on-canvas')"
          >
            Open on Canvas
          </button>
        </template>
      </div>
    </Teleport>

    <!-- Delete confirmation modal -->
    <Teleport to="body">
      <div
        v-if="confirmDeleteVisible"
        class="fixed inset-0 z-[9999] flex items-center justify-center"
        style="background: rgba(0,0,0,0.5)"
        @click.self="handleDelete(false)"
      >
        <div
          class="rounded-lg shadow-2xl p-4 min-w-[280px] max-w-[360px] space-y-3"
          :style="{ background: 'var(--qc-bg-header)', border: '1px solid var(--qc-border)' }"
        >
          <div class="text-xs font-bold" :style="{ color: 'var(--qc-text)' }">Delete {{ pendingDeleteNode?.isDirectory ? 'Folder' : 'File' }}</div>
          <p class="text-xs leading-relaxed" :style="{ color: 'var(--qc-text-dim, var(--qc-text-muted))' }">
            Are you sure you want to delete
            <span class="text-red-400 font-medium">"{{ pendingDeleteNode?.name }}"</span>?
            This cannot be undone.
          </p>
          <div class="flex items-center justify-end gap-2 pt-1">
            <button
              class="text-[10px] px-3 py-1.5 rounded transition-colors"
              :style="{ color: 'var(--qc-text-dim, var(--qc-text-muted))', border: '1px solid var(--qc-border)' }"
              @click="handleDelete(false)"
            >
              Cancel
            </button>
            <button
              class="text-[10px] px-3 py-1.5 rounded transition-colors text-white bg-red-500 hover:bg-red-600"
              @click="handleDelete(true)"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
