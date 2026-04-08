<script setup lang="ts">
import { useAppStore, SHELL_OPTIONS } from '../../../stores/app'
import type { ShellType, Theme } from '../../../stores/app'
import { useBrowserStore } from '../../../stores/browser'
import type { SearchEngine } from '../../../shared/types'
import { invoke } from '@tauri-apps/api/core'

const appStore = useAppStore()
const browserStore = useBrowserStore()
const runtimeConfig = useRuntimeConfig()

const updateChecking = ref(false)
const updateAvailable = ref(false)
const updateVersion = ref('')
const updateDownloadUrl = ref('')
const updateStatus = ref('')
const updateDownloading = ref(false)

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

const SEARCH_ENGINES = [
  { value: 'google' as const, label: 'Google' },
  { value: 'duckduckgo' as const, label: 'DuckDuckGo' },
  { value: 'bing' as const, label: 'Bing' },
  { value: 'brave' as const, label: 'Brave Search' },
]

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    appStore.closeSettingsModal()
  }
}

onMounted(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && appStore.settingsModalOpen) {
      appStore.closeSettingsModal()
    }
  }
  window.addEventListener('keydown', handler)
  onUnmounted(() => window.removeEventListener('keydown', handler))
})
</script>

<template>
  <div
    v-if="appStore.settingsModalOpen"
    class="fixed inset-0 z-[10000] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(2px)"
    @click="onOverlayClick"
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
      <div class="p-5 space-y-5">
        <!-- Appearance -->
        <div>
          <div class="settings-label" :style="{ color: 'var(--qc-text-dim)' }">Appearance</div>
          <div class="settings-group">
            <div class="flex gap-2">
              <button
                v-for="t in (['dark', 'light'] as Theme[])"
                :key="t"
                class="flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all"
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
            <div class="settings-row">
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
          </div>
        </div>

        <!-- Defaults -->
        <div>
          <div class="settings-label" :style="{ color: 'var(--qc-text-dim)' }">Defaults</div>
          <div class="settings-group">
            <div class="settings-row">
              <span class="text-xs">Terminal Shell</span>
              <select
                class="settings-select"
                :style="{
                  background: 'var(--qc-bg-header)',
                  color: 'var(--qc-text)',
                  border: '1px solid var(--qc-border)',
                }"
                :value="appStore.defaultShell"
                @change="appStore.setDefaultShell(($event.target as HTMLSelectElement).value as ShellType)"
              >
                <option v-for="shell in SHELL_OPTIONS" :key="shell.value" :value="shell.value">
                  {{ shell.label }}
                </option>
              </select>
            </div>
            <div class="settings-row">
              <span class="text-xs">Search Engine</span>
              <select
                class="settings-select"
                :style="{
                  background: 'var(--qc-bg-header)',
                  color: 'var(--qc-text)',
                  border: '1px solid var(--qc-border)',
                }"
                :value="browserStore.searchEngine"
                @change="browserStore.setSearchEngine(($event.target as HTMLSelectElement).value as SearchEngine)"
              >
                <option v-for="engine in SEARCH_ENGINES" :key="engine.value" :value="engine.value">
                  {{ engine.label }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- Editor -->
        <div>
          <div class="settings-label" :style="{ color: 'var(--qc-text-dim)' }">Editor</div>
          <div class="settings-group">
            <button class="settings-toggle" @click="appStore.toggleEditorMinimap()">
              <span class="text-xs">Code Minimap</span>
              <span
                class="w-8 h-4 rounded-full relative inline-block transition-all shrink-0"
                :style="{ background: appStore.editorMinimap ? '#a0a0a8' : 'var(--qc-border)' }"
              >
                <span
                  class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                  :style="{ left: appStore.editorMinimap ? '18px' : '2px' }"
                />
              </span>
            </button>
            <button class="settings-toggle" @click="appStore.toggleFileExplorer()">
              <span class="text-xs">File Explorer</span>
              <span
                class="w-8 h-4 rounded-full relative inline-block transition-all shrink-0"
                :style="{ background: appStore.fileExplorerVisible ? '#a0a0a8' : 'var(--qc-border)' }"
              >
                <span
                  class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                  :style="{ left: appStore.fileExplorerVisible ? '18px' : '2px' }"
                />
              </span>
            </button>
            <button class="settings-toggle" @click="appStore.toggleEditor()">
              <span class="text-xs">Editor Panel</span>
              <span
                class="w-8 h-4 rounded-full relative inline-block transition-all shrink-0"
                :style="{ background: appStore.editorVisible ? '#a0a0a8' : 'var(--qc-border)' }"
              >
                <span
                  class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                  :style="{ left: appStore.editorVisible ? '18px' : '2px' }"
                />
              </span>
            </button>
          </div>
        </div>

        <!-- Canvas -->
        <div>
          <div class="settings-label" :style="{ color: 'var(--qc-text-dim)' }">Canvas</div>
          <div class="settings-group">
            <button class="settings-toggle" @click="appStore.toggleSnapToGrid()">
              <span class="text-xs">Snap windows to grid</span>
              <span
                class="w-8 h-4 rounded-full relative inline-block transition-all shrink-0"
                :style="{ background: appStore.snapToGrid ? '#a0a0a8' : 'var(--qc-border)' }"
              >
                <span
                  class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                  :style="{ left: appStore.snapToGrid ? '18px' : '2px' }"
                />
              </span>
            </button>
            <button class="settings-toggle" @click="appStore.toggleSnapCameraToGrid()">
              <span class="text-xs">Snap camera to grid</span>
              <span
                class="w-8 h-4 rounded-full relative inline-block transition-all shrink-0"
                :style="{ background: appStore.snapCameraToGrid ? '#a0a0a8' : 'var(--qc-border)' }"
              >
                <span
                  class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                  :style="{ left: appStore.snapCameraToGrid ? '18px' : '2px' }"
                />
              </span>
            </button>
            <button class="settings-toggle" @click="appStore.toggleCanvasMinimap()">
              <span class="text-xs">Canvas Minimap</span>
              <span
                class="w-8 h-4 rounded-full relative inline-block transition-all shrink-0"
                :style="{ background: appStore.canvasMinimap ? '#a0a0a8' : 'var(--qc-border)' }"
              >
                <span
                  class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                  :style="{ left: appStore.canvasMinimap ? '18px' : '2px' }"
                />
              </span>
            </button>
          </div>
        </div>

        <!-- About / Updates -->
        <div>
          <div class="settings-label" :style="{ color: 'var(--qc-text-dim)' }">About</div>
          <div class="px-3 py-2.5 text-xs space-y-2 rounded-lg" :style="{ background: 'var(--qc-bg-surface)', border: '1px solid var(--qc-border)', color: 'var(--qc-text)' }">
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
.settings-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 500;
  margin-bottom: 8px;
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--qc-text);
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--qc-bg-surface);
  border: 1px solid var(--qc-border);
  border-radius: 8px;
}

.settings-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  background: var(--qc-bg-surface);
  border: 1px solid var(--qc-border);
  border-radius: 8px;
  transition: background 0.15s;
}

.settings-toggle:hover {
  background: var(--qc-bg-header);
}

.settings-select {
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  outline: none;
  cursor: pointer;
  min-width: 120px;
  text-align: right;
}

.settings-select option {
  background: var(--qc-bg-surface);
  color: var(--qc-text);
}
</style>
