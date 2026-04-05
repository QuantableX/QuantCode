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
const searchFocused = ref(false)
const rootExpanded = ref(true)

// Track selected file path from active editor tab
const selectedPath = computed(() => appStore.activeTab?.filePath ?? null)

// Workspace header info
const workspaceName = computed(() => {
  const ws = workspacesStore.activeWorkspace
  if (!ws) return ''
  const path = ws.folderPath.replace(/\\/g, '/')
  return path.split('/').filter(Boolean).pop() || ws.name
})

function countAllItems(nodes: FileNode[]): number {
  let count = 0
  for (const node of nodes) {
    count++
    if (node.children) {
      count += countAllItems(node.children)
    }
  }
  return count
}

const totalItemCount = computed(() => countAllItems(fileTree.value))

// Context menu
const contextMenu = ref({ visible: false, x: 0, y: 0, node: null as FileNode | null })
const contextMenuRef = ref<HTMLElement | null>(null)

// Delete confirmation modal
const confirmDeleteVisible = ref(false)
const pendingDeleteNode = ref<FileNode | null>(null)

// Drag and drop state
const dragSourcePath = ref<string | null>(null)
const dropTargetPath = ref<string | null>(null)

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

async function onNewFileInFolder(node: FileNode) {
  const name = prompt('File name:')
  if (!name) return
  const dir = node.isDirectory ? node.path : getParentDir(node.path)
  try {
    await invoke('create_file', { path: dir + '/' + name, isDirectory: false })
    loadFileTree()
  } catch { /* ignore */ }
}

function onContextMenu(e: MouseEvent, node: FileNode) {
  e.preventDefault()
  e.stopPropagation()
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, node }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

const explorerTreeRef = ref<HTMLElement | null>(null)
let pointerStartX = 0
let pointerStartY = 0
let pointerDidMove = false
let pointerMoveHandler: ((e: PointerEvent) => void) | null = null
let pointerUpHandler: (() => void) | null = null

function findDropFolderAtPoint(x: number, y: number, draggingPath: string): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  if (!el) return null
  // Check if hovering a folder row directly
  const folderRow = el.closest?.('[data-is-dir]') as HTMLElement | null
  if (folderRow) {
    const path = folderRow.getAttribute('data-path')
    if (path && path !== draggingPath) return path
  }
  // If hovering a file row, use its parent folder (the .tree-children ancestor's sibling folder row)
  const anyRow = el.closest?.('[data-path]') as HTMLElement | null
  if (anyRow && !anyRow.hasAttribute('data-is-dir')) {
    // Walk up to .tree-children, then its parent wrapper has the folder row
    const treeChildren = anyRow.closest?.('.tree-children') as HTMLElement | null
    if (treeChildren) {
      const parentFolder = treeChildren.previousElementSibling?.closest?.('[data-is-dir]') as HTMLElement | null
        || treeChildren.parentElement?.querySelector?.(':scope > [data-is-dir]') as HTMLElement | null
      if (parentFolder) {
        const path = parentFolder.getAttribute('data-path')
        if (path && path !== draggingPath) return path
      }
    }
    // Fallback: file at root level — use workspace
    const ws = workspacesStore.activeWorkspace
    if (ws) return ws.folderPath
  }
  // Check if hovering empty tree area
  if (el.closest?.('.explorer-tree')) {
    const ws = workspacesStore.activeWorkspace
    if (ws) return ws.folderPath
  }
  return null
}

function onRowPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  const target = e.target as HTMLElement
  if (target.closest('button, input')) return
  const row = target.closest?.('[data-path]') as HTMLElement | null
  if (!row) return
  const path = row.getAttribute('data-path')
  if (!path) return

  e.preventDefault()
  pointerStartX = e.clientX
  pointerStartY = e.clientY
  pointerDidMove = false

  pointerMoveHandler = (me: PointerEvent) => {
    const dx = me.clientX - pointerStartX
    const dy = me.clientY - pointerStartY
    if (!pointerDidMove && Math.abs(dx) + Math.abs(dy) < 4) return
    pointerDidMove = true
    dragSourcePath.value = path
    row.style.opacity = '0.35'
    document.body.classList.add('qc-file-dragging')

    const folder = findDropFolderAtPoint(me.clientX, me.clientY, path)
    if (folder) {
      const srcNorm = normalizePath(path)
      const folderNorm = normalizePath(folder)
      if (folderNorm === srcNorm || folderNorm === normalizePath(getParentDir(path)) || folderNorm.startsWith(srcNorm + '/')) {
        dropTargetPath.value = null
      } else {
        dropTargetPath.value = folder
      }
    } else {
      dropTargetPath.value = null
    }
  }

  pointerUpHandler = async () => {
    document.removeEventListener('pointermove', pointerMoveHandler!, true)
    document.removeEventListener('pointerup', pointerUpHandler!, true)
    document.body.classList.remove('qc-file-dragging')
    row.style.opacity = ''

    if (pointerDidMove && dragSourcePath.value && dropTargetPath.value) {
      const srcNorm = normalizePath(dragSourcePath.value)
      const tgtNorm = normalizePath(dropTargetPath.value)
      const fileName = srcNorm.split('/').pop()
      if (fileName && srcNorm !== tgtNorm) {
        const newPath = tgtNorm + '/' + fileName
        try {
          await invoke('rename_file', { oldPath: dragSourcePath.value, newPath })
          loadFileTree()
        } catch (err) {
          console.error('Failed to move file:', err)
        }
      }
    }

    dragSourcePath.value = null
    dropTargetPath.value = null
  }

  document.addEventListener('pointermove', pointerMoveHandler, true)
  document.addEventListener('pointerup', pointerUpHandler, true)
}

function resetDragState() {
  if (pointerMoveHandler) document.removeEventListener('pointermove', pointerMoveHandler, true)
  if (pointerUpHandler) document.removeEventListener('pointerup', pointerUpHandler, true)
  document.body.classList.remove('qc-file-dragging')
  dragSourcePath.value = null
  dropTargetPath.value = null
}

function onTreeContextMenu(e: MouseEvent) {
  // Only trigger on empty space, not on nodes
  if (e.target !== e.currentTarget) return
  e.preventDefault()
  showRootContextMenu(e)
}

function onWorkspaceHeaderContextMenu(e: MouseEvent) {
  showRootContextMenu(e)
}

function showRootContextMenu(e: MouseEvent) {
  const workspace = workspacesStore.activeWorkspace
  if (!workspace) return
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    node: { name: workspaceName.value, path: workspace.folderPath, isDirectory: true, children: [] } as FileNode,
  }
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
  explorerTreeRef.value?.addEventListener('pointerdown', onRowPointerDown)
})

onUnmounted(() => {
  explorerTreeRef.value?.removeEventListener('pointerdown', onRowPointerDown)
  resetDragState()
})
</script>

<template>
  <div class="explorer" :style="{ background: 'var(--qc-bg-titlebar)' }">
    <!-- Search/filter -->
    <div class="explorer-search">
      <div class="explorer-search-wrapper" :class="{ 'explorer-search-wrapper--focused': searchFocused }">
        <svg class="explorer-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="filterText"
          type="text"
          placeholder="Search"
          class="explorer-search-input"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
        />
        <button
          v-if="filterText"
          class="explorer-search-clear"
          @click="filterText = ''"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" fill="none" />
          </svg>
        </button>
      </div>
      <button
        class="explorer-refresh"
        title="Refresh"
        @click="loadFileTree"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </button>
    </div>

    <!-- File tree -->
    <div
      ref="explorerTreeRef"
      class="explorer-tree scrollbar-hover"
      @contextmenu="onTreeContextMenu"
    >
      <!-- Root folder group with guide line -->
      <div v-if="workspaceName" class="explorer-root-group">
        <!-- Workspace header row (root node) -->
        <div
          class="explorer-root-row"
          @click.stop="rootExpanded = !rootExpanded"
          @contextmenu.prevent="onWorkspaceHeaderContextMenu"
        >
          <span class="explorer-root-caret" :class="{ 'explorer-root-caret--open': rootExpanded }">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M3 2l4 3-4 3z" />
            </svg>
          </span>
          <span class="explorer-root-name">{{ workspaceName }}</span>
          <span v-if="totalItemCount > 0" class="explorer-root-badge">{{ totalItemCount }}</span>
        </div>

        <!-- Tree content indented under root -->
        <div v-show="rootExpanded" class="explorer-root-children">
          <div v-if="loading" class="explorer-empty">
            <span class="explorer-loading-dot" />
            Loading...
          </div>
          <template v-else-if="filteredTree.length">
            <SidebarFileTreeNode
              v-for="node in filteredTree"
              :key="node.path"
              :node="node"
              :depth="1"
              :git-status-style="gitStatusStyle"
              :selected-path="selectedPath"
              :drop-target-path="dropTargetPath"
              @toggle="toggleExpand"
              @open="openFile"
              @contextmenu="onContextMenu"
              @new-file="onNewFileInFolder"
            />
          </template>
          <div v-else-if="!loading && filterText" class="explorer-empty">
            No matches
          </div>
        </div>
      </div>

      <!-- Fallback: no workspace -->
      <template v-else>
        <div v-if="loading" class="explorer-empty">
          <span class="explorer-loading-dot" />
          Loading...
        </div>
        <template v-else-if="filteredTree.length">
          <SidebarFileTreeNode
            v-for="node in filteredTree"
            :key="node.path"
            :node="node"
            :depth="0"
            :git-status-style="gitStatusStyle"
            :selected-path="selectedPath"
            :drop-target-path="dropTargetPath"
            @toggle="toggleExpand"
            @open="openFile"
            @contextmenu="onContextMenu"
            @new-file="onNewFileInFolder"
          />
        </template>
        <div v-else-if="!loading && filterText" class="explorer-empty">
          No matches
        </div>
      </template>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <Transition name="ctx">
        <div
          v-if="contextMenu.visible"
          ref="contextMenuRef"
          class="ctx-menu"
          :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        >
          <button class="ctx-item" @click="contextAction('new-file')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
            New File
          </button>
          <button class="ctx-item" @click="contextAction('new-folder')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
            New Folder
          </button>
          <div class="ctx-sep" />
          <button class="ctx-item" @click="contextAction('rename')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Rename
          </button>
          <button class="ctx-item ctx-item--danger" @click="contextAction('delete')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Delete
          </button>
          <div class="ctx-sep" />
          <button class="ctx-item" @click="contextAction('copy-path')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy Path
          </button>
          <template v-if="contextMenu.node && !contextMenu.node.isDirectory">
            <div class="ctx-sep" />
            <button class="ctx-item" @click="contextAction('open-on-canvas')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              Open on Canvas
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>

    <!-- Delete confirmation modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="confirmDeleteVisible"
          class="modal-overlay"
          @click.self="handleDelete(false)"
        >
          <div class="modal-content">
            <div class="modal-title">Delete {{ pendingDeleteNode?.isDirectory ? 'Folder' : 'File' }}</div>
            <p class="modal-desc">
              Are you sure you want to delete
              <span class="modal-filename">"{{ pendingDeleteNode?.name }}"</span>?
              This cannot be undone.
            </p>
            <div class="modal-actions">
              <button class="modal-btn modal-btn--cancel" @click="handleDelete(false)">
                Cancel
              </button>
              <button class="modal-btn modal-btn--delete" @click="handleDelete(true)">
                Delete
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 13px;
}

/* ---- Search bar ---- */
.explorer-search {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 8px 6px;
  flex-shrink: 0;
}

.explorer-search-wrapper {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.explorer-search-icon {
  position: absolute;
  left: 7px;
  color: var(--qc-text-muted);
  opacity: 0.4;
  pointer-events: none;
  transition: opacity 0.2s;
}

.explorer-search-wrapper--focused .explorer-search-icon {
  opacity: 0.7;
}

.explorer-search-input {
  width: 100%;
  padding: 5px 8px 5px 24px;
  font-family: var(--qc-font-mono, 'SF Mono', 'Cascadia Code', 'Fira Code', monospace);
  font-size: 0.78rem;
  font-weight: 400;
  border: 1px solid var(--qc-border);
  border-radius: 6px;
  color: var(--qc-text);
  background: transparent;
  transition: border-color 0.2s, background-color 0.2s;
  outline: none;
}

.explorer-search-input:focus {
  border-color: color-mix(in srgb, var(--qc-text) 30%, transparent);
  background: color-mix(in srgb, var(--qc-text) 3%, transparent);
}

.explorer-search-input::placeholder {
  color: var(--qc-text-muted);
  opacity: 0.3;
}

.explorer-search-clear {
  position: absolute;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 3px;
  background: none;
  color: var(--qc-text-muted);
  cursor: pointer;
  opacity: 0.4;
  transition: opacity 0.15s;
}

.explorer-search-clear:hover {
  opacity: 1;
}

.explorer-refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--qc-text-muted);
  cursor: pointer;
  opacity: 0.4;
  transition: opacity 0.2s, color 0.2s, background-color 0.2s;
  flex-shrink: 0;
}

.explorer-refresh:hover {
  opacity: 1;
  color: var(--qc-text);
  background: color-mix(in srgb, var(--qc-text) 8%, transparent);
}

.explorer-refresh:active {
  transform: scale(0.92);
}

/* ---- Root folder group (workspace header + guide line) ---- */
.explorer-root-group {
  position: relative;
}

.explorer-root-group::after {
  content: '';
  position: absolute;
  left: 14px;
  top: 22px;
  bottom: 4px;
  width: 1px;
  background: var(--qc-text);
  opacity: 0.07;
  pointer-events: none;
}

.explorer-root-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 4px 8px;
  cursor: default;
  user-select: none;
  color: var(--qc-text-muted);
  transition: color 0.2s;
  border-right: 3px solid transparent;
}

.explorer-root-row:hover {
  color: var(--qc-text);
}

.explorer-root-caret {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  flex-shrink: 0;
  opacity: 0.5;
  transition: transform 0.15s ease, opacity 0.15s;
}

.explorer-root-caret--open {
  transform: rotate(90deg);
}

.explorer-root-row:hover .explorer-root-caret {
  opacity: 0.8;
}

.explorer-root-name {
  font-family: var(--qc-font-mono, 'SF Mono', 'Cascadia Code', 'Fira Code', monospace);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--qc-text);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
  text-transform: uppercase;
}

.explorer-root-badge {
  font-family: var(--qc-font-mono, monospace);
  font-size: 0.65rem;
  font-weight: 400;
  letter-spacing: 0.03em;
  color: var(--qc-text);
  background: color-mix(in srgb, var(--qc-text) 10%, transparent);
  padding: 0 5px;
  border-radius: 8px;
  line-height: 1.4;
  flex-shrink: 0;
  margin-left: auto;
}

.explorer-root-children {
  position: relative;
}

/* ---- Tree area ---- */
.explorer-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 0 8px;
}

.explorer-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 64px;
  font-family: var(--qc-font-mono, monospace);
  font-size: 0.75rem;
  color: var(--qc-text-muted);
  opacity: 0.4;
}

.explorer-loading-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--qc-text-muted);
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.8; }
}

/* ---- Smart scrollbar (hidden until hover) ---- */
.scrollbar-hover {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}

.scrollbar-hover::-webkit-scrollbar {
  width: 6px;
  background-color: transparent;
}

.scrollbar-hover::-webkit-scrollbar-track {
  background-color: transparent;
}

.scrollbar-hover::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 3px;
}

.scrollbar-hover:hover {
  scrollbar-color: color-mix(in srgb, var(--qc-text) 15%, transparent) transparent;
}

.scrollbar-hover:hover::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--qc-text) 15%, transparent);
}

.scrollbar-hover:hover::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--qc-text) 25%, transparent);
}

/* ---- Context menu ---- */
.ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 170px;
  padding: 4px;
  border-radius: 10px;
  background: var(--qc-bg-header);
  border: 1px solid var(--qc-border);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(20px);
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--qc-text);
  font-family: var(--qc-font-mono, monospace);
  font-size: 0.75rem;
  font-weight: 400;
  cursor: pointer;
  transition: background-color 0.12s;
  text-align: left;
}

.ctx-item:hover {
  background: color-mix(in srgb, var(--qc-text) 10%, transparent);
}

.ctx-item--danger {
  color: #ef4444;
}

.ctx-item--danger:hover {
  background: color-mix(in srgb, #ef4444 12%, transparent);
}

.ctx-item svg {
  opacity: 0.5;
  flex-shrink: 0;
}

.ctx-sep {
  height: 1px;
  margin: 3px 6px;
  background: var(--qc-border);
  opacity: 0.6;
}

/* Context menu animation */
.ctx-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.ctx-leave-active {
  transition: opacity 0.08s ease, transform 0.08s ease;
}
.ctx-enter-from {
  opacity: 0;
  transform: scale(0.96) translateY(-4px);
}
.ctx-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

/* ---- Delete modal ---- */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
}

.modal-content {
  min-width: 300px;
  max-width: 380px;
  padding: 20px;
  border-radius: 14px;
  background: var(--qc-bg-header);
  border: 1px solid var(--qc-border);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.modal-title {
  font-family: var(--qc-font-mono, monospace);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--qc-text);
}

.modal-desc {
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--qc-text-muted);
  margin: 0;
}

.modal-filename {
  color: #ef4444;
  font-weight: 500;
}

.modal-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.modal-btn {
  font-family: var(--qc-font-mono, monospace);
  font-size: 0.72rem;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: 7px;
  border: none;
  cursor: pointer;
  transition: background-color 0.15s, transform 0.1s;
}

.modal-btn:active {
  transform: scale(0.97);
}

.modal-btn--cancel {
  background: transparent;
  color: var(--qc-text-muted);
  border: 1px solid var(--qc-border);
}

.modal-btn--cancel:hover {
  background: color-mix(in srgb, var(--qc-text) 8%, transparent);
  color: var(--qc-text);
}

.modal-btn--delete {
  background: #ef4444;
  color: white;
}

.modal-btn--delete:hover {
  background: #dc2626;
}

/* Modal animation */
.modal-enter-active {
  transition: opacity 0.15s ease;
}
.modal-enter-active .modal-content {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.modal-leave-active {
  transition: opacity 0.1s ease;
}
.modal-enter-from {
  opacity: 0;
}
.modal-enter-from .modal-content {
  opacity: 0;
  transform: scale(0.95) translateY(8px);
}
.modal-leave-to {
  opacity: 0;
}
</style>
