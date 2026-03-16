<script setup lang="ts">
import { useWorkspacesStore } from '../../../stores/workspaces'
import { invoke } from '@tauri-apps/api/core'

const workspacesStore = useWorkspacesStore()

const gitBranch = ref<string | null>(null)

const workspacePath = computed(() => {
  const ws = workspacesStore.activeWorkspace
  return ws?.folderPath ?? ''
})

const displayPath = computed(() => {
  const p = workspacePath.value
  if (!p) return 'No workspace'
  // Shorten long paths: show last 2-3 segments
  const parts = p.replace(/\\/g, '/').split('/')
  if (parts.length <= 3) return p
  return '.../' + parts.slice(-2).join('/')
})

async function loadGitBranch() {
  if (!workspacePath.value) return
  try {
    const branch = await invoke<string>('get_git_branch', {
      path: workspacePath.value,
    })
    gitBranch.value = branch
  } catch {
    gitBranch.value = null
  }
}

watch(workspacePath, () => {
  loadGitBranch()
}, { immediate: true })
</script>

<template>
  <div
    class="h-6 text-xs px-3 flex items-center justify-between flex-shrink-0 select-none"
    :style="{ background: 'var(--qc-bg-titlebar)', borderTop: '1px solid var(--qc-border)', color: 'var(--qc-text-muted)' }"
  >
    <!-- Left side: shortcuts -->
    <div class="flex items-center gap-3">
      <span>
        <kbd class="text-[10px]" :style="{ color: 'var(--qc-text-muted)' }">Ctrl+B</kbd>
        <span class="mx-0.5" :style="{ color: 'var(--qc-text-dim)' }">explorer</span>
      </span>
      <span :style="{ color: 'var(--qc-border)' }">|</span>
      <span>
        <kbd class="text-[10px]" :style="{ color: 'var(--qc-text-muted)' }">Ctrl+Shift+B</kbd>
        <span class="mx-0.5" :style="{ color: 'var(--qc-text-dim)' }">editor</span>
      </span>
      <span :style="{ color: 'var(--qc-border)' }">|</span>
      <span>
        <span :style="{ color: 'var(--qc-text-dim)' }">right click</span>
        <span class="mx-0.5" :style="{ color: 'var(--qc-text-dim)' }">new agent</span>
      </span>
    </div>

    <!-- Right side: workspace info -->
    <div class="flex items-center gap-3">
      <!-- Git branch -->
      <div v-if="gitBranch" class="flex items-center gap-1">
        <span class="text-[10px]">&#9678;</span>
        <span class="text-[10px] text-[#22d3ee]">{{ gitBranch }}</span>
      </div>

      <!-- Workspace path -->
      <span class="text-[10px] truncate max-w-[200px]" :style="{ color: 'var(--qc-text-muted)' }" :title="workspacePath">
        {{ displayPath }}
      </span>
    </div>
  </div>
</template>
