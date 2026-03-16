<script setup lang="ts">
import { useWorkspacesStore } from '../stores/workspaces'
import { useCanvasStore } from '../stores/canvas'
import { useAppStore } from '../stores/app'
import { useEventListener } from '@vueuse/core'

const workspacesStore = useWorkspacesStore()
const canvasStore = useCanvasStore()
const appStore = useAppStore()

onMounted(async () => {
  // Apply saved theme and font size
  appStore.applyTheme(appStore.theme)
  appStore.applyFontSize(appStore.fontSize)

  await workspacesStore.loadFromDisk()
  if (workspacesStore.activeWorkspaceId) {
    canvasStore.initCanvas(workspacesStore.activeWorkspaceId)
    await canvasStore.loadCanvasState(workspacesStore.activeWorkspaceId)
  }
})

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  // Ctrl+B: toggle file explorer
  if (e.ctrlKey && !e.shiftKey && e.key === 'b') {
    e.preventDefault()
    appStore.toggleFileExplorer()
  }
  // Ctrl+Shift+B: toggle editor panel
  if (e.ctrlKey && e.shiftKey && e.key === 'B') {
    e.preventDefault()
    appStore.toggleEditor()
  }
  // Ctrl+Tab: cycle editor tabs
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault()
    const tabs = appStore.activeEditorTabs
    if (tabs.length <= 1) return
    const currentIndex = tabs.findIndex(t => t.id === appStore.activeTabId)
    const nextIndex = (currentIndex + 1) % tabs.length
    appStore.setActiveTab(tabs[nextIndex].id)
  }
  // Ctrl+O: open workspace (dispatches custom event for WorkspaceSwitcher to handle)
  if (e.ctrlKey && e.key === 'o') {
    e.preventDefault()
    window.dispatchEvent(new CustomEvent('quantcode:open-workspace'))
  }
})
</script>

<template>
  <div class="min-h-screen overflow-hidden select-none" style="background: var(--qc-bg); color: var(--qc-text);">
    <NuxtPage />
  </div>
</template>
