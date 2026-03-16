<script setup lang="ts">
import { useWorkspacesStore } from '../../../stores/workspaces'
import { useCanvasStore } from '../../../stores/canvas'
import { useAppStore } from '../../../stores/app'
import { v4 as uuidv4 } from 'uuid'
import type { WorkspaceInfo } from '../../../shared/types'
import { onClickOutside } from '@vueuse/core'
import logoUrl from '~/assets/quantcode-logo.png'

const workspacesStore = useWorkspacesStore()
const canvasStore = useCanvasStore()
const appStore = useAppStore()

const dropdownOpenId = ref<string | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const renamingId = ref<string | null>(null)
const renameValue = ref('')

onClickOutside(dropdownRef, () => {
  dropdownOpenId.value = null
})


function toggleDropdown(id: string, e: Event) {
  e.stopPropagation()
  dropdownOpenId.value = dropdownOpenId.value === id ? null : id
}

async function switchWorkspace(id: string) {
  // Save current canvas state before switching away
  const currentId = workspacesStore.activeWorkspaceId
  if (currentId) {
    await canvasStore.saveCanvasState(currentId)
  }

  workspacesStore.setActiveWorkspace(id)

  // Only load from disk if we don't already have this canvas in memory
  if (!canvasStore.canvasStates.has(id)) {
    canvasStore.initCanvas(id)
    await canvasStore.loadCanvasState(id)
  }
}

function startRename(workspace: WorkspaceInfo) {
  renamingId.value = workspace.id
  renameValue.value = workspace.name
  dropdownOpenId.value = null
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.rename-input')
    input?.focus()
    input?.select()
  })
}

function finishRename(id: string) {
  if (renameValue.value.trim()) {
    workspacesStore.updateWorkspace(id, { name: renameValue.value.trim() })
  }
  renamingId.value = null
}

function closeWorkspace(id: string) {
  dropdownOpenId.value = null
  workspacesStore.removeWorkspace(id)
}

async function revealWorkspace(workspace: WorkspaceInfo) {
  dropdownOpenId.value = null
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(workspace.folderPath)
  } catch {
    console.warn('Could not reveal folder')
  }
}

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

onMounted(() => {
  window.addEventListener('quantcode:open-workspace', openNewWorkspace)
})

onUnmounted(() => {
  window.removeEventListener('quantcode:open-workspace', openNewWorkspace)
})
</script>

<template>
  <div class="titlebar">
    <!-- Left: Logo container -->
    <div class="titlebar-logo-section">
      <img :src="logoUrl" alt="QuantCode" class="titlebar-logo" />
    </div>

    <!-- Center: Workspace tabs (VS Code style) -->
    <div class="titlebar-tabs-section">
      <!-- Explorer toggle (far left of workspace area) -->
      <button
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

      <div class="tabs-scroll no-scrollbar" style="-webkit-app-region: no-drag">
        <div
          v-for="ws in workspacesStore.workspaces"
          :key="ws.id"
          class="relative flex items-center flex-shrink-0"
        >
          <!-- Rename input -->
          <template v-if="renamingId === ws.id">
            <input
              v-model="renameValue"
              class="rename-input"
              @keydown.enter="finishRename(ws.id)"
              @keydown.escape="renamingId = null"
              @blur="finishRename(ws.id)"
            />
          </template>
          <template v-else>
            <button
              class="workspace-tab"
              :class="{ active: ws.id === workspacesStore.activeWorkspaceId }"
              @click="switchWorkspace(ws.id)"
              @mousedown.middle.prevent="closeWorkspace(ws.id)"
              @contextmenu.prevent="toggleDropdown(ws.id, $event)"
            >
              <span class="truncate max-w-[140px]">{{ ws.name }}</span>
              <span
                class="tab-close"
                title="Close workspace"
                @click.stop="closeWorkspace(ws.id)"
              >&#10005;</span>
            </button>

            <!-- Context menu (right-click) -->
            <div
              v-if="dropdownOpenId === ws.id"
              ref="dropdownRef"
              class="workspace-dropdown"
            >
              <button class="dropdown-item" @click="startRename(ws)">Rename</button>
              <button class="dropdown-item" @click="revealWorkspace(ws)">Reveal in Explorer</button>
              <div class="dropdown-divider" />
              <button class="dropdown-item dropdown-item-danger" @click="closeWorkspace(ws.id)">Close</button>
            </div>
          </template>
        </div>

        <!-- New workspace button (inside tab bar) -->
        <button
          class="new-tab-btn"
          title="Open workspace folder"
                    @click="openNewWorkspace"
        >+</button>
      </div>

      <!-- Editor toggle (far right of workspace area) -->
      <button
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

    <!-- Right: Theme toggle + Settings -->
    <div class="titlebar-actions-section" style="-webkit-app-region: no-drag">
      <!-- Theme pill switch -->
      <button
        class="theme-pill"
        :class="{ 'is-dark': appStore.theme === 'dark' }"
        :title="appStore.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        @click="appStore.toggleTheme()"
      >
        <span class="theme-pill-thumb" />
        <span class="theme-pill-option" :class="{ 'option-active': appStore.theme === 'light' }">
          <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2.5V5" /><path d="M12 19V21.5" />
            <path d="M4.5 4.5L6.3 6.3" /><path d="M17.7 17.7L19.5 19.5" />
            <path d="M2.5 12H5" /><path d="M19 12H21.5" />
            <path d="M4.5 19.5L6.3 17.7" /><path d="M17.7 6.3L19.5 4.5" />
          </svg>
          <span class="theme-label">Light</span>
        </span>
        <span class="theme-pill-option" :class="{ 'option-active': appStore.theme === 'dark' }">
          <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3a7.5 7.5 0 1 0 9 9 7 7 0 1 1-9-9z" />
          </svg>
          <span class="theme-label">Dark</span>
        </span>
      </button>

      <!-- Settings -->
      <button
        class="settings-btn"
        :class="{ 'settings-btn-active': appStore.settingsModalOpen }"
        title="Settings"
        @click.stop="appStore.openSettingsModal()"
      >&#9881;</button>
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
  color: var(--qc-text-muted);
  background: var(--qc-bg-header);
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

/* ---- Center: Tabs ---- */
.titlebar-tabs-section {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
}

.tabs-scroll {
  display: flex;
  align-items: stretch;
  gap: 0;
  overflow-x: auto;
  flex: 1;
}

.workspace-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px 0 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--qc-text-muted);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  height: 100%;
}

.workspace-tab:hover {
  color: var(--qc-text);
  background: var(--qc-bg-header);
}

.workspace-tab.active {
  color: var(--qc-text);
  border-bottom-color: var(--qc-text);
  background: var(--qc-bg-header);
}

.tab-close {
  font-size: 9px;
  color: var(--qc-text-dim);
  cursor: pointer;
  transition: all 0.15s;
  opacity: 0;
  margin-left: 2px;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.workspace-tab:hover .tab-close {
  opacity: 1;
}

.tab-close:hover {
  color: var(--qc-text);
  background: rgba(255, 255, 255, 0.1);
}

.new-tab-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  flex-shrink: 0;
  font-size: 16px;
  color: var(--qc-text-muted);
  background: transparent;
  border: none;
  border-left: 1px solid var(--qc-border);
  cursor: pointer;
  transition: all 0.15s;
}

.new-tab-btn:hover {
  color: var(--qc-text);
  background: var(--qc-bg-header);
}

.rename-input {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  outline: none;
  width: 130px;
  background: var(--qc-bg-header);
  border: 1px solid var(--qc-text-muted);
  border-radius: 4px;
  color: var(--qc-text);
}

.workspace-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 9999;
  min-width: 150px;
  padding: 4px;
  background: var(--qc-bg-header);
  border: 1px solid var(--qc-border);
}

.dropdown-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  font-size: 11px;
  border-radius: 4px;
  color: var(--qc-text);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.15s;
}

.dropdown-item:hover {
  background: var(--qc-bg-surface);
}

.dropdown-item-danger {
  color: #ef4444;
}

.dropdown-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--qc-border);
}

/* ---- Right: Actions ---- */
.titlebar-actions-section {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 8px;
  border-left: 1px solid var(--qc-border);
}

/* Theme pill toggle (matches QuantMCP) */
.theme-pill {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 34px;
  border: 1px solid var(--qc-border);
  border-radius: 999px;
  background: var(--qc-bg-header);
  padding: 2px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.theme-pill:hover {
  border-color: var(--color-accent);
}

.theme-pill-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(50% - 2px);
  height: 28px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--qc-bg-surface) 86%, transparent);
  border: 1px solid color-mix(in srgb, var(--qc-border) 86%, transparent);
  transition: transform 0.2s ease;
}

.theme-pill.is-dark .theme-pill-thumb {
  transform: translateX(calc(100% + 2px));
}

.theme-pill-option {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--qc-text-dim);
  user-select: none;
}

.theme-pill-option.option-active {
  color: var(--qc-text);
}

.theme-label {
  font-size: 11px;
  font-weight: 600;
}

.theme-icon {
  width: 20px;
  height: 20px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
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
}

.settings-btn:hover,
.settings-btn-active {
  color: var(--qc-text);
  border-color: var(--color-accent);
  background: var(--qc-bg-surface);
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
