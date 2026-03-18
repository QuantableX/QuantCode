<script setup lang="ts">
import { useAppStore, SHELL_OPTIONS } from '../../stores/app'
import type { ShellType, Theme } from '../../stores/app'
import { useBrowserStore } from '../../stores/browser'
import type { SearchEngine } from '../../shared/types'
import { invoke } from '@tauri-apps/api/core'

const appStore = useAppStore()
const browserStore = useBrowserStore()
const runtimeConfig = useRuntimeConfig()

const fileExplorerVisible = computed(() => appStore.fileExplorerVisible)
const editorVisible = computed(() => appStore.editorVisible)

const DEFAULT_SIDEBAR_WIDTH = 220
const MIN_SIDEBAR_WIDTH = 120

const leftWidth = ref(DEFAULT_SIDEBAR_WIDTH)
const rightWidth = ref(DEFAULT_SIDEBAR_WIDTH)

provide('rightSidebarWidth', rightWidth)

// Provide viewport insets so child components (e.g. browser webview) can clip
// to the visible canvas area, excluding sidebar overlays
const viewportInsets = computed(() => ({
  left: fileExplorerVisible.value ? leftWidth.value : 0,
  right: editorVisible.value ? rightWidth.value : 0,
}))
provide('viewportInsets', viewportInsets)

// ---- Resize logic ----
const resizing = ref<'left' | 'right' | null>(null)
const resizeStartX = ref(0)
const resizeStartWidth = ref(0)

function startResize(side: 'left' | 'right', e: MouseEvent) {
  e.preventDefault()
  resizing.value = side
  resizeStartX.value = e.clientX
  resizeStartWidth.value = side === 'left' ? leftWidth.value : rightWidth.value
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onResizeMove(e: MouseEvent) {
  if (!resizing.value) return
  const dx = e.clientX - resizeStartX.value
  const delta = resizing.value === 'left' ? dx : -dx
  const maxWidth = Math.floor(window.innerWidth * (resizing.value === 'left' ? 0.25 : 0.50))
  const newWidth = Math.min(maxWidth, Math.max(MIN_SIDEBAR_WIDTH, resizeStartWidth.value + delta))
  if (resizing.value === 'left') {
    leftWidth.value = newWidth
  } else {
    rightWidth.value = newWidth
  }
}

function onResizeEnd() {
  resizing.value = null
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function resetWidth(side: 'left' | 'right') {
  if (side === 'left') {
    leftWidth.value = DEFAULT_SIDEBAR_WIDTH
  } else {
    rightWidth.value = DEFAULT_SIDEBAR_WIDTH
  }
}

function onSettingsOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    appStore.closeSettingsModal()
  }
}

onMounted(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && appStore.settingsModalOpen) {
      e.preventDefault()
      appStore.closeSettingsModal()
    }
  }
  window.addEventListener('keydown', handler)
  onUnmounted(() => window.removeEventListener('keydown', handler))
})

const dropdownStyle = computed(() => ({
  background: 'var(--qc-bg-surface)',
  color: 'var(--qc-text)',
  border: '1px solid var(--qc-border)',
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a0a0a8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
}))

// ---- Update logic ----
const updateChecking = ref(false)
const updateAvailable = ref(false)
const updateVersion = ref('')
const updateDownloadUrl = ref('')
const updateStatus = ref('')
const updateDownloading = ref(false)

const SEARCH_ENGINES = [
  { value: 'google' as const, label: 'Google' },
  { value: 'duckduckgo' as const, label: 'DuckDuckGo' },
  { value: 'bing' as const, label: 'Bing' },
  { value: 'brave' as const, label: 'Brave Search' },
]

async function checkForUpdate() {
  updateChecking.value = true
  updateStatus.value = ''
  try {
    const info = await invoke<{
      available: boolean
      current_version: string
      latest_version: string
      download_url: string
    }>('check_for_update')
    updateAvailable.value = info.available
    updateVersion.value = info.latest_version
    updateDownloadUrl.value = info.download_url
    if (!info.available) {
      updateStatus.value = 'You are on the latest version.'
    }
  } catch (e: any) {
    updateStatus.value = `Error: ${e}`
  } finally {
    updateChecking.value = false
  }
}

async function downloadUpdate() {
  updateDownloading.value = true
  updateStatus.value = 'Downloading...'
  try {
    await invoke('download_and_install_update', { url: updateDownloadUrl.value })
    updateStatus.value = 'Installing... The app will restart.'
  } catch (e: any) {
    updateStatus.value = `Download failed: ${e}`
  } finally {
    updateDownloading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col h-screen w-screen overflow-hidden">
    <!-- Title Bar -->
    <WorkspaceSwitcher />

    <!-- Main Content -->
    <div class="flex flex-1 min-h-0 relative">
      <!-- File Explorer Sidebar (overlay) -->
      <transition name="slide-left">
        <div
          v-if="fileExplorerVisible"
          class="absolute top-0 left-0 bottom-0 overflow-hidden z-20"
          :style="{ width: leftWidth + 'px', borderRight: '1px solid var(--qc-border)', background: 'var(--qc-bg)' }"
        >
          <SidebarFileExplorer />
          <!-- Left resize handle -->
          <div
            class="resize-handle resize-handle-right"
            @mousedown="startResize('left', $event)"
            @dblclick="resetWidth('left')"
          />
        </div>
      </transition>

      <!-- Canvas (always present, fills remaining space) -->
      <div class="flex-1 min-w-0 relative">
        <CanvasInfinityCanvas />
      </div>

      <!-- Editor Panel Sidebar (overlay) -->
      <transition name="slide-right">
        <div
          v-if="editorVisible"
          class="absolute top-0 right-0 bottom-0 overflow-hidden z-20"
          :style="{ width: rightWidth + 'px', borderLeft: '1px solid var(--qc-border)', background: 'var(--qc-bg)' }"
        >
          <!-- Right resize handle -->
          <div
            class="resize-handle resize-handle-left"
            @mousedown="startResize('right', $event)"
            @dblclick="resetWidth('right')"
          />
          <SidebarEditorPanel />
        </div>
      </transition>
    </div>

    <!-- Status Bar -->
    <UiStatusBar />
  </div>

  <!-- Settings Modal (outside the overflow-hidden container) -->
  <div
    v-if="appStore.settingsModalOpen"
    class="fixed inset-0 flex items-center justify-center"
    style="z-index: 10000; background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(2px)"
    @click="onSettingsOverlayClick"
    @contextmenu.prevent
  >
    <div
      class="rounded-xl shadow-2xl w-[480px] max-h-[80vh] overflow-y-auto"
      :style="{ background: 'var(--qc-bg-window)', border: '1px solid var(--qc-border)' }"
      @click.stop
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-5 py-4"
        :style="{ borderBottom: '1px solid var(--qc-border)' }"
      >
        <h2 class="text-sm font-semibold" :style="{ color: 'var(--qc-text)' }">Settings</h2>
        <button
          class="w-6 h-6 flex items-center justify-center rounded transition-colors text-xs hover:brightness-125"
          :style="{ color: 'var(--qc-text-muted)' }"
          @click="appStore.closeSettingsModal()"
        >
          &#10005;
        </button>
      </div>

      <!-- Content -->
      <div class="p-5 space-y-6">
        <!-- Appearance -->
        <div>
          <div class="text-[10px] uppercase tracking-wider mb-3 font-medium" :style="{ color: 'var(--qc-text-dim)' }">
            Appearance
          </div>
          <div class="flex gap-2">
            <button
              v-for="t in (['dark', 'light'] as Theme[])"
              :key="t"
              class="flex-1 px-3 py-2.5 rounded-lg text-xs font-medium transition-all"
              :style="{
                background: appStore.theme === t ? '#a0a0a8' : 'var(--qc-bg-surface)',
                color: appStore.theme === t ? '#fff' : 'var(--qc-text)',
                border: appStore.theme === t ? '1px solid #a0a0a8' : '1px solid var(--qc-border)',
              }"
              @click="appStore.setTheme(t)"
            >
              {{ t === 'dark' ? 'Dark' : 'Light' }}
            </button>
          </div>

          <!-- Font Size -->
          <div class="mt-3 flex items-center justify-between px-3 py-2.5 rounded-lg"
            :style="{
              background: 'var(--qc-bg-surface)',
              border: '1px solid var(--qc-border)',
              color: 'var(--qc-text)',
            }"
          >
            <span class="text-xs">Font Size</span>
            <div class="flex items-center gap-2">
              <button
                class="w-6 h-6 flex items-center justify-center rounded text-xs transition-colors"
                :style="{ background: 'var(--qc-bg-header)', color: 'var(--qc-text-muted)', border: '1px solid var(--qc-border)' }"
                @click="appStore.setFontSize(Math.max(11, appStore.fontSize - 1))"
              >
                &minus;
              </button>
              <span class="text-xs w-8 text-center font-medium">{{ appStore.fontSize }}px</span>
              <button
                class="w-6 h-6 flex items-center justify-center rounded text-xs transition-colors"
                :style="{ background: 'var(--qc-bg-header)', color: 'var(--qc-text-muted)', border: '1px solid var(--qc-border)' }"
                @click="appStore.setFontSize(Math.min(22, appStore.fontSize + 1))"
              >
                +
              </button>
            </div>
          </div>

          <!-- Code Minimap -->
          <button
            class="w-full text-left px-3 py-2.5 rounded-lg text-xs flex items-center justify-between transition-all mt-1"
            :style="{
              background: 'var(--qc-bg-surface)',
              color: 'var(--qc-text)',
              border: '1px solid var(--qc-border)',
            }"
            @click="appStore.toggleEditorMinimap()"
          >
            <span>Code Minimap</span>
            <span
              class="w-8 h-4 rounded-full relative inline-block transition-all"
              :style="{
                background: appStore.editorMinimap ? '#a0a0a8' : 'var(--qc-border)',
              }"
            >
              <span
                class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                :style="{ left: appStore.editorMinimap ? '18px' : '2px' }"
              />
            </span>
          </button>
        </div>

        <!-- Terminal Shell -->
        <div>
          <div class="text-[10px] uppercase tracking-wider mb-3 font-medium" :style="{ color: 'var(--qc-text-dim)' }">
            Default Terminal Shell
          </div>
          <select
            class="w-full px-3 py-2 rounded-lg text-xs font-medium appearance-none cursor-pointer transition-all"
            :style="dropdownStyle"
            :value="appStore.defaultShell"
            @change="appStore.setDefaultShell(($event.target as HTMLSelectElement).value as ShellType)"
          >
            <option
              v-for="shell in SHELL_OPTIONS"
              :key="shell.value"
              :value="shell.value"
            >
              {{ shell.label }}
            </option>
          </select>
        </div>

        <!-- Browser -->
        <div>
          <div class="text-[10px] uppercase tracking-wider mb-3 font-medium" :style="{ color: 'var(--qc-text-dim)' }">
            Browser
          </div>
          <select
            class="w-full px-3 py-2 rounded-lg text-xs font-medium appearance-none cursor-pointer transition-all"
            :style="dropdownStyle"
            :value="browserStore.searchEngine"
            @change="browserStore.setSearchEngine(($event.target as HTMLSelectElement).value as SearchEngine)"
          >
            <option
              v-for="engine in SEARCH_ENGINES"
              :key="engine.value"
              :value="engine.value"
            >
              {{ engine.label }}
            </option>
          </select>
        </div>

        <!-- Canvas -->
        <div>
          <div class="text-[10px] uppercase tracking-wider mb-3 font-medium" :style="{ color: 'var(--qc-text-dim)' }">
            Canvas
          </div>
          <button
            class="w-full text-left px-3 py-2.5 rounded-lg text-xs flex items-center justify-between transition-all"
            :style="{
              background: 'var(--qc-bg-surface)',
              color: 'var(--qc-text)',
              border: '1px solid var(--qc-border)',
            }"
            @click="appStore.toggleSnapToGrid()"
          >
            <span>Snap windows to grid</span>
            <span
              class="w-8 h-4 rounded-full relative inline-block transition-all"
              :style="{ background: appStore.snapToGrid ? '#a0a0a8' : 'var(--qc-border)' }"
            >
              <span
                class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                :style="{ left: appStore.snapToGrid ? '18px' : '2px' }"
              />
            </span>
          </button>
          <button
            class="w-full text-left px-3 py-2.5 rounded-lg text-xs flex items-center justify-between transition-all"
            :style="{
              background: 'var(--qc-bg-surface)',
              color: 'var(--qc-text)',
              border: '1px solid var(--qc-border)',
            }"
            @click="appStore.toggleSnapCameraToGrid()"
          >
            <span>Snap camera to grid</span>
            <span
              class="w-8 h-4 rounded-full relative inline-block transition-all"
              :style="{ background: appStore.snapCameraToGrid ? '#a0a0a8' : 'var(--qc-border)' }"
            >
              <span
                class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                :style="{ left: appStore.snapCameraToGrid ? '18px' : '2px' }"
              />
            </span>
          </button>
          <button
            class="w-full text-left px-3 py-2.5 rounded-lg text-xs flex items-center justify-between transition-all mt-1"
            :style="{
              background: 'var(--qc-bg-surface)',
              color: 'var(--qc-text)',
              border: '1px solid var(--qc-border)',
            }"
            @click="appStore.toggleCanvasHints()"
          >
            <span>Show canvas hints</span>
            <span
              class="w-8 h-4 rounded-full relative inline-block transition-all"
              :style="{ background: appStore.canvasHints ? '#a0a0a8' : 'var(--qc-border)' }"
            >
              <span
                class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                :style="{ left: appStore.canvasHints ? '18px' : '2px' }"
              />
            </span>
          </button>
        </div>

        <!-- Panels -->
        <div>
          <div class="text-[10px] uppercase tracking-wider mb-3 font-medium" :style="{ color: 'var(--qc-text-dim)' }">
            Panels
          </div>
          <div class="space-y-1">
            <button
              class="w-full text-left px-3 py-2.5 rounded-lg text-xs flex items-center justify-between transition-all"
              :style="{ background: 'var(--qc-bg-surface)', color: 'var(--qc-text)', border: '1px solid var(--qc-border)' }"
              @click="appStore.toggleFileExplorer()"
            >
              <span>File Explorer</span>
              <span class="text-[10px] font-medium" :style="{ color: appStore.fileExplorerVisible ? '#a0a0a8' : 'var(--qc-text-dim)' }">
                {{ appStore.fileExplorerVisible ? 'ON' : 'OFF' }}
              </span>
            </button>
            <button
              class="w-full text-left px-3 py-2.5 rounded-lg text-xs flex items-center justify-between transition-all"
              :style="{ background: 'var(--qc-bg-surface)', color: 'var(--qc-text)', border: '1px solid var(--qc-border)' }"
              @click="appStore.toggleEditor()"
            >
              <span>Editor Panel</span>
              <span class="text-[10px] font-medium" :style="{ color: appStore.editorVisible ? '#a0a0a8' : 'var(--qc-text-dim)' }">
                {{ appStore.editorVisible ? 'ON' : 'OFF' }}
              </span>
            </button>
          </div>
        </div>

        <!-- About / Updates -->
        <div>
          <div class="text-[10px] uppercase tracking-wider mb-3 font-medium" :style="{ color: 'var(--qc-text-dim)' }">
            About
          </div>
          <div class="px-3 py-2.5 rounded-lg text-xs space-y-2"
            :style="{
              background: 'var(--qc-bg-surface)',
              color: 'var(--qc-text)',
              border: '1px solid var(--qc-border)',
            }"
          >
            <div class="flex items-center justify-between">
              <span :style="{ color: 'var(--qc-text-muted)' }">QuantCode v{{ runtimeConfig.public.appVersion }}</span>
            </div>
            <div class="flex gap-2">
              <button
                class="px-3 py-1.5 rounded text-xs font-medium transition-all"
                :style="{
                  background: 'var(--qc-bg-header)',
                  color: 'var(--qc-text)',
                  border: '1px solid var(--qc-border)',
                }"
                :disabled="updateChecking"
                @click="checkForUpdate"
              >
                {{ updateChecking ? 'Checking...' : 'Check for Updates' }}
              </button>
              <button
                v-if="updateAvailable && updateDownloadUrl"
                class="px-3 py-1.5 rounded text-xs font-medium transition-all"
                :style="{
                  background: '#a0a0a8',
                  color: '#fff',
                  border: '1px solid #a0a0a8',
                }"
                :disabled="updateDownloading"
                @click="downloadUpdate"
              >
                {{ updateDownloading ? 'Downloading...' : `Download v${updateVersion}` }}
              </button>
            </div>
            <div v-if="updateStatus" class="text-[10px]" :style="{ color: 'var(--qc-text-muted)' }">
              {{ updateStatus }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.slide-left-enter-active,
.slide-left-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.slide-left-enter-from,
.slide-left-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 5px;
  cursor: col-resize;
  z-index: 10;
  transition: background 0.15s;
}

.resize-handle:hover,
.resize-handle:active {
  background: var(--qc-text-dim);
  opacity: 0.4;
}

.resize-handle-right {
  right: 0;
}

.resize-handle-left {
  left: 0;
}
</style>
