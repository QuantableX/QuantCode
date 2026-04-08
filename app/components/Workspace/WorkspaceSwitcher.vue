<script setup lang="ts">
import { useWorkspacesStore } from '../../../stores/workspaces'
import { useCanvasStore } from '../../../stores/canvas'
import { useAppStore } from '../../../stores/app'
import { v4 as uuidv4 } from 'uuid'
import type { WorkspaceInfo, FileNode } from '../../../shared/types'
import { onClickOutside } from '@vueuse/core'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import logoUrl from '~/assets/quantcode-logo.png'

const workspacesStore = useWorkspacesStore()
const canvasStore = useCanvasStore()
const appStore = useAppStore()

// ── File quick-open search ──
const searchQuery = ref('')
const searchOpen = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)
const searchContainerRef = ref<HTMLElement | null>(null)
const allFiles = ref<{ name: string; path: string; relativePath: string }[]>([])
const selectedIndex = ref(0)

onClickOutside(searchContainerRef, () => {
  closeSearch()
})

function flattenTree(nodes: FileNode[], basePath: string): { name: string; path: string; relativePath: string }[] {
  const result: { name: string; path: string; relativePath: string }[] = []
  for (const node of nodes) {
    if (!node.isDirectory) {
      const rel = node.path.replace(/\\/g, '/').replace(basePath.replace(/\\/g, '/') + '/', '')
      result.push({ name: node.name, path: node.path, relativePath: rel })
    }
    if (node.children) {
      result.push(...flattenTree(node.children, basePath))
    }
  }
  return result
}

async function loadFileList() {
  const workspace = workspacesStore.activeWorkspace
  if (!workspace) {
    allFiles.value = []
    return
  }
  try {
    const tree = await invoke<FileNode[]>('read_dir_tree', {
      path: workspace.folderPath,
      gitignore: true,
    })
    allFiles.value = flattenTree(tree, workspace.folderPath)
  } catch {
    allFiles.value = []
  }
}

const filteredResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return allFiles.value.slice(0, 50)
  return allFiles.value
    .filter(f => f.relativePath.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
    .slice(0, 50)
})

function onSearchFocus() {
  searchOpen.value = true
  selectedIndex.value = 0
  loadFileList()
}

function onSearchInput() {
  searchOpen.value = true
  selectedIndex.value = 0
}

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closeSearch()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filteredResults.value.length - 1)
    scrollSelectedIntoView()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    scrollSelectedIntoView()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const item = filteredResults.value[selectedIndex.value]
    if (item) openSearchResult(item)
    return
  }
}

function scrollSelectedIntoView() {
  nextTick(() => {
    const el = document.querySelector('.qo-result-item.qo-selected')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

async function openSearchResult(file: { name: string; path: string }) {
  closeSearch()
  try {
    const content = await invoke<string>('read_file', { path: file.path })
    appStore.openTab(file.path, content)
    if (!appStore.editorVisible) {
      appStore.toggleEditor()
    }
  } catch {
    appStore.openTab(file.path, `// Could not read ${file.name}\n`)
    if (!appStore.editorVisible) {
      appStore.toggleEditor()
    }
  }
}

function onSearchBlur(e: FocusEvent) {
  const relatedTarget = e.relatedTarget as Node | null
  if (relatedTarget && searchContainerRef.value?.contains(relatedTarget)) {
    return
  }
  closeSearch()
}

function closeSearch() {
  searchOpen.value = false
  searchQuery.value = ''
  searchInputRef.value?.blur()
}

// ── Workspace actions (kept for global event + downstream use) ──

async function switchWorkspace(id: string) {
  const currentId = workspacesStore.activeWorkspaceId
  if (currentId) {
    await canvasStore.saveCanvasState(currentId)
  }
  workspacesStore.setActiveWorkspace(id)
  if (!canvasStore.canvasStates.has(id)) {
    canvasStore.initCanvas(id)
    await canvasStore.loadCanvasState(id)
  }
  // Track in navigation history
  appStore.pushNavHistory()
}

// Register so app store can read workspace ID and switch during back/forward
appStore.registerActiveWorkspaceGetter(() => workspacesStore.activeWorkspaceId)
appStore.registerWorkspaceSwitch(switchWorkspace)

async function openNewWorkspace() {
  let folderPath: string | null = null
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ directory: true, multiple: false })
    if (typeof selected === 'string') {
      folderPath = selected
    }
  } catch {
    folderPath = prompt('Enter folder path:')
  }
  if (!folderPath) return

  const folderName = folderPath.split(/[/\\]/).pop() ?? 'Workspace'
  const workspace: WorkspaceInfo = {
    id: uuidv4(),
    name: folderName,
    folderPath,
    lastOpened: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }
  workspacesStore.addWorkspace(workspace)
  switchWorkspace(workspace.id)
}

// Global shortcuts: Ctrl+P (search), Alt+Left/Right (back/forward)
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault()
    searchInputRef.value?.focus()
    return
  }
  if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault()
    appStore.navigateBack()
    return
  }
  if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault()
    appStore.navigateForward()
    return
  }
}

// Mouse back/forward buttons (button 3 = back, button 4 = forward)
function onMouseNav(e: MouseEvent) {
  if (e.button === 3) {
    e.preventDefault()
    appStore.navigateBack()
  } else if (e.button === 4) {
    e.preventDefault()
    appStore.navigateForward()
  }
}

// ── Window controls (custom titlebar) ──
const appWindow = getCurrentWindow()
const isMaximized = ref(false)

async function minimizeWindow() {
  await appWindow.minimize()
}

async function toggleMaximize() {
  await appWindow.toggleMaximize()
  isMaximized.value = await appWindow.isMaximized()
}

async function closeWindow() {
  await appWindow.close()
}

function onTitlebarMousedown(e: MouseEvent) {
  // Only drag when clicking empty titlebar area, not interactive elements
  if ((e.target as HTMLElement).closest('button, input, select, a, .window-controls, .settings-btn, .titlebar-logo-section')) return
  appWindow.startDragging()
}

function onTitlebarDblclick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, input, select, a, .window-controls, .settings-btn, .titlebar-logo-section')) return
  toggleMaximize()
}

onMounted(() => {
  window.addEventListener('quantcode:open-workspace', openNewWorkspace)
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('mouseup', onMouseNav)
  // Track maximized state
  appWindow.isMaximized().then(v => { isMaximized.value = v })
  appWindow.onResized(async () => {
    isMaximized.value = await appWindow.isMaximized()
  })
})

onUnmounted(() => {
  window.removeEventListener('quantcode:open-workspace', openNewWorkspace)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('mouseup', onMouseNav)
})
</script>

<template>
  <div class="titlebar" @mousedown="onTitlebarMousedown" @dblclick="onTitlebarDblclick">
    <!-- Left: Logo container -->
    <div class="titlebar-logo-section" style="-webkit-app-region: no-drag; cursor: pointer;" @click="openNewWorkspace" title="Open workspace">
      <img :src="logoUrl" alt="QuantCode" class="titlebar-logo" />
    </div>

    <!-- Center: File quick-open search -->
    <div class="titlebar-tabs-section">
      <!-- Explorer toggle (far left) — hidden in modern toggle style -->
      <button
        v-if="appStore.panelToggleStyle !== 'modern'"
        class="sidebar-toggle sidebar-toggle-left"
        :class="{ 'sidebar-toggle-active': appStore.fileExplorerVisible }"
        title="Toggle Explorer (Ctrl+B)"
        style="-webkit-app-region: no-drag"
        @click="appStore.toggleFileExplorer()"
      >
        <svg class="sidebar-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </button>

      <!-- Search bar (perfectly centered) with nav buttons anchored to its left -->
      <div ref="searchContainerRef" class="qo-search-container" style="-webkit-app-region: no-drag">
        <div class="qo-search-bar-wrapper">
          <!-- Back / Forward — absolutely positioned to the left of the search bar -->
          <div class="nav-buttons">
            <button
              class="nav-btn"
              :class="{ 'nav-btn--disabled': !appStore.canGoBack }"
              title="Go Back (Alt+Left)"
              :disabled="!appStore.canGoBack"
              @click="appStore.navigateBack()"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              class="nav-btn"
              :class="{ 'nav-btn--disabled': !appStore.canGoForward }"
              title="Go Forward (Alt+Right)"
              :disabled="!appStore.canGoForward"
              @click="appStore.navigateForward()"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <!-- Search bar -->
          <div class="qo-search-bar" :class="{ 'qo-search-bar--active': searchOpen }">
            <svg class="qo-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              type="text"
              class="qo-search-input"
              placeholder="Search files..."
              @focus="onSearchFocus"
              @input="onSearchInput"
              @keydown="onSearchKeydown"
              @blur="onSearchBlur"
            />
            <kbd v-if="!searchOpen" class="qo-shortcut">Ctrl+P</kbd>
            <button v-if="searchQuery" class="qo-search-clear" @click="closeSearch">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" />
              </svg>
            </button>
          </div>

          <!-- Notes toggle — absolutely positioned to the right, classic style -->
          <button
            v-if="appStore.panelToggleStyle !== 'modern'"
            class="nav-btn nav-btn-right"
            :class="{ 'nav-btn--active': appStore.notesBarVisible }"
            title="Toggle Notes (Ctrl+J)"
            @click="appStore.toggleNotesBar()"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="8" y1="13" x2="16" y2="13" />
              <line x1="8" y1="17" x2="12" y2="17" />
            </svg>
          </button>
        </div>

        <!-- Results dropdown -->
        <div v-if="searchOpen && (searchQuery || filteredResults.length)" class="qo-results">
          <div v-if="!filteredResults.length" class="qo-results-empty">No files found</div>
          <template v-else>
            <button
              v-for="(file, i) in filteredResults"
              :key="file.path"
              class="qo-result-item"
              :class="{ 'qo-selected': i === selectedIndex }"
              @click="openSearchResult(file)"
              @mouseenter="selectedIndex = i"
            >
              <span class="qo-result-name">{{ file.name }}</span>
              <span class="qo-result-path">{{ file.relativePath }}</span>
            </button>
          </template>
        </div>
      </div>

      <!-- Editor toggle (far right) — hidden in modern toggle style -->
      <button
        v-if="appStore.panelToggleStyle !== 'modern'"
        class="sidebar-toggle sidebar-toggle-right"
        :class="{ 'sidebar-toggle-active': appStore.editorVisible }"
        title="Toggle Editor (Ctrl+Shift+B)"
        style="-webkit-app-region: no-drag"
        @click="appStore.toggleEditor()"
      >
        <svg class="sidebar-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="8 7 3 12 8 17" />
          <polyline points="16 7 21 12 16 17" />
          <line x1="13.5" y1="5" x2="10.5" y2="19" />
        </svg>
      </button>
    </div>

    <!-- Right: Settings + Window Controls -->
    <div class="titlebar-actions-section" style="-webkit-app-region: no-drag">
      <!-- Settings (far left) -->
      <button
        class="settings-btn"
        :class="{ 'settings-btn-active': appStore.settingsModalOpen }"
        title="Settings"
        @click.stop="appStore.openSettingsModal()"
      >&#9881;</button>

      <!-- Window controls -->
      <div class="window-controls">
        <button class="window-btn" title="Minimize" @click="minimizeWindow">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" stroke-width="1.2" /></svg>
        </button>
        <button class="window-btn" :title="isMaximized ? 'Restore' : 'Maximize'" @click="toggleMaximize">
          <svg v-if="!isMaximized" width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
          <svg v-else width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="3.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2" fill="none" /><path d="M4.5 3.5V2.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H8.5" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
        </button>
        <button class="window-btn window-btn-close" title="Close" @click="closeWindow">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.2" /></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  background: var(--qc-bg-titlebar);
  border-bottom: 1px solid var(--qc-border);
  height: 51px;
}

/* ---- Sidebar toggle buttons ---- */
.sidebar-toggle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 51px;
  height: 100%;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  color: var(--qc-text-dim);
}

.sidebar-toggle-left {
  border-right: 1px solid var(--qc-border);
}

.sidebar-toggle-right {
  border-left: 1px solid var(--qc-border);
}

.sidebar-toggle:hover {
  color: var(--qc-text);
  background: var(--qc-bg-header);
}

.sidebar-toggle-active {
  color: var(--qc-text-dim);
  background: transparent;
}

.sidebar-toggle-icon {
  width: 22px;
  height: 22px;
}

/* ---- Left: Logo ---- */
.titlebar-logo-section {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid var(--qc-border);
  padding: 0 16px;
}

.titlebar-logo {
  height: 22px;
  width: auto;
  object-fit: contain;
}

/* ---- Center: Search area ---- */
.titlebar-tabs-section {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
}

/* ---- Back / Forward nav buttons ---- */
.nav-buttons {
  position: absolute;
  right: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--qc-text-muted);
  cursor: pointer;
  transition: all 0.12s ease;
}

.nav-btn:hover:not(:disabled) {
  color: var(--qc-text);
  background: color-mix(in srgb, var(--qc-text) 8%, transparent);
}

.nav-btn:active:not(:disabled) {
  opacity: 0.5;
}

.nav-btn--disabled {
  opacity: 0.25;
  cursor: default;
}

.nav-btn-right {
  position: absolute;
  left: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
}

.nav-btn--active {
  color: var(--qc-text);
}

/* ---- Quick-open search bar ---- */
.qo-search-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 0 16px;
}

.qo-search-bar-wrapper {
  position: relative;
  width: 100%;
  max-width: 480px;
}

.qo-search-bar {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 32px;
  border: 1px solid var(--qc-border);
  border-radius: 8px;
  background: var(--qc-bg-header);
  transition: border-color 0.15s, background-color 0.15s, box-shadow 0.15s;
}

.qo-search-bar:hover {
  border-color: color-mix(in srgb, var(--qc-text) 20%, transparent);
}

.qo-search-bar--active {
  border-color: color-mix(in srgb, var(--qc-text) 30%, transparent);
  background: color-mix(in srgb, var(--qc-text) 4%, var(--qc-bg-header));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.qo-search-icon {
  position: absolute;
  left: 10px;
  color: var(--qc-text-muted);
  opacity: 0.5;
  pointer-events: none;
}

.qo-search-input {
  width: 100%;
  height: 100%;
  padding: 0 32px 0 32px;
  font-family: var(--qc-font-mono, 'SF Mono', 'Cascadia Code', 'Fira Code', monospace);
  font-size: 12px;
  font-weight: 400;
  color: var(--qc-text);
  background: transparent;
  border: none;
  outline: none;
}

.qo-search-input::placeholder {
  color: var(--qc-text-muted);
  opacity: 0.4;
}

.qo-shortcut {
  position: absolute;
  right: 8px;
  font-family: var(--qc-font-mono, 'SF Mono', 'Cascadia Code', 'Fira Code', monospace);
  font-size: 10px;
  color: var(--qc-text-muted);
  opacity: 0.4;
  background: var(--qc-bg-surface);
  border: 1px solid var(--qc-border);
  border-radius: 4px;
  padding: 1px 5px;
  pointer-events: none;
  line-height: 1.4;
}

.qo-search-clear {
  position: absolute;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--qc-text-muted);
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 0.15s;
}

.qo-search-clear:hover {
  opacity: 1;
}

/* ---- Results dropdown ---- */
.qo-results {
  position: absolute;
  top: calc(50% + 20px);
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--qc-bg-header);
  border: 1px solid var(--qc-border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  z-index: 9999;
  padding: 4px;
}

.qo-results-empty {
  padding: 12px 16px;
  font-size: 11px;
  color: var(--qc-text-muted);
  text-align: center;
}

.qo-result-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  font-size: 12px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--qc-text);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}

.qo-result-item:hover,
.qo-result-item.qo-selected {
  background: var(--qc-bg-surface);
}

.qo-result-name {
  flex-shrink: 0;
  font-weight: 500;
}

.qo-result-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--qc-text-muted);
  opacity: 0.6;
  text-align: right;
}

/* ---- Right: Actions ---- */
.titlebar-actions-section {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 0 8px;
  border-left: 1px solid var(--qc-border);
}

.settings-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid var(--qc-border);
  background: var(--qc-bg-header);
  color: var(--qc-text-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
  margin: 0 auto;
}

.settings-btn:hover,
.settings-btn-active {
  color: var(--qc-text);
  border-color: var(--color-accent);
  background: var(--qc-bg-surface);
}

/* ---- Window controls ---- */
.window-controls {
  display: flex;
  align-items: stretch;
  height: 100%;
  flex-shrink: 0;
}

.window-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 51px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--qc-text-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.window-btn:hover {
  background: color-mix(in srgb, var(--qc-text) 10%, transparent);
  color: var(--qc-text);
}

.window-btn:active {
  background: color-mix(in srgb, var(--qc-text) 16%, transparent);
}

.window-btn-close:hover {
  background: #e81123;
  color: #fff;
}

.window-btn-close:active {
  background: #c50f1f;
  color: #fff;
}
</style>
