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
          <div class="space-y-1">
            <button
              v-for="shell in SHELL_OPTIONS"
              :key="shell.value"
              class="w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-all"
              :style="{
                background: appStore.defaultShell === shell.value ? 'var(--qc-bg-surface)' : 'transparent',
                color: 'var(--qc-text)',
                border: appStore.defaultShell === shell.value ? '1px solid var(--qc-border)' : '1px solid transparent',
              }"
              @click="appStore.setDefaultShell(shell.value as ShellType)"
            >
              <span>{{ shell.label }}</span>
              <span v-if="appStore.defaultShell === shell.value" class="text-[#a0a0a8]">&#10003;</span>
            </button>
          </div>
        </div>

        <!-- Browser -->
        <div>
          <div class="text-[10px] uppercase tracking-wider mb-3 font-medium" :style="{ color: 'var(--qc-text-dim)' }">
            Browser
          </div>
          <div class="space-y-1">
            <button
              v-for="engine in SEARCH_ENGINES"
              :key="engine.value"
              class="w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-all"
              :style="{
                background: browserStore.searchEngine === engine.value ? 'var(--qc-bg-surface)' : 'transparent',
                color: 'var(--qc-text)',
                border: browserStore.searchEngine === engine.value ? '1px solid var(--qc-border)' : '1px solid transparent',
              }"
              @click="browserStore.setSearchEngine(engine.value)"
            >
              <span>{{ engine.label }}</span>
              <span v-if="browserStore.searchEngine === engine.value" class="text-[#a0a0a8]">&#10003;</span>
            </button>
          </div>
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
              :style="{
                background: appStore.snapToGrid ? '#a0a0a8' : 'var(--qc-border)',
              }"
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
              :style="{
                background: appStore.snapCameraToGrid ? '#a0a0a8' : 'var(--qc-border)',
              }"
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
              :style="{
                background: appStore.canvasHints ? '#a0a0a8' : 'var(--qc-border)',
              }"
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
              :style="{
                background: 'var(--qc-bg-surface)',
                color: 'var(--qc-text)',
                border: '1px solid var(--qc-border)',
              }"
              @click="appStore.toggleFileExplorer()"
            >
              <span>File Explorer</span>
              <span class="text-[10px] font-medium" :style="{ color: appStore.fileExplorerVisible ? '#a0a0a8' : 'var(--qc-text-dim)' }">
                {{ appStore.fileExplorerVisible ? 'ON' : 'OFF' }}
              </span>
            </button>
            <button
              class="w-full text-left px-3 py-2.5 rounded-lg text-xs flex items-center justify-between transition-all"
              :style="{
                background: 'var(--qc-bg-surface)',
                color: 'var(--qc-text)',
                border: '1px solid var(--qc-border)',
              }"
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
