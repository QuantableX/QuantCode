<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import type { CanvasWindow, SpecFile, SpecStatus } from '../../../shared/types'
import { useWorkspacesStore } from '../../../stores/workspaces'
import { useAppStore } from '../../../stores/app'
import { findSpecFiles, updateSpecField, serializeSpec } from '../../../lib/specs/engine'

const props = defineProps<{
  window: CanvasWindow
}>()

const workspacesStore = useWorkspacesStore()
const appStore = useAppStore()

const specs = ref<SpecFile[]>([])
const expandedSpecPath = ref<string | null>(null)
const loading = ref(false)
const errorMsg = ref('')

// New spec form
const newTitle = ref('')
const newPriority = ref<string>('medium')
const creating = ref(false)

const statusOrder: SpecStatus[] = ['planned', 'in-progress', 'done', 'blocked']

const statusConfig: Record<SpecStatus, { label: string; color: string; bg: string; dotColor: string }> = {
  planned: { label: 'Planned', color: 'text-blue-400', bg: 'bg-blue-400/10', dotColor: '#3b82f6' },
  'in-progress': { label: 'In Progress', color: 'text-amber-400', bg: 'bg-amber-400/10', dotColor: '#f59e0b' },
  done: { label: 'Done', color: 'text-green-400', bg: 'bg-green-400/10', dotColor: '#22c55e' },
  blocked: { label: 'Blocked', color: 'text-red-400', bg: 'bg-red-400/10', dotColor: '#ef4444' },
}

const priorityConfig: Record<string, { label: string; color: string }> = {
  critical: { label: 'CRIT', color: 'text-red-400' },
  high: { label: 'HIGH', color: 'text-orange-400' },
  medium: { label: 'MED', color: 'text-amber-400' },
  low: { label: 'LOW', color: 'text-blue-400' },
}

const groupedSpecs = computed(() => {
  const groups: Record<SpecStatus, SpecFile[]> = {
    planned: [],
    'in-progress': [],
    done: [],
    blocked: [],
  }
  for (const spec of specs.value) {
    const status = spec.frontmatter.status
    if (groups[status]) {
      groups[status].push(spec)
    }
  }
  return groups
})

async function loadSpecs() {
  loading.value = true
  errorMsg.value = ''
  try {
    const workspace = workspacesStore.activeWorkspace
    if (!workspace) {
      errorMsg.value = 'No workspace open'
      return
    }

    specs.value = await findSpecFiles(workspace.folderPath)
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
    specs.value = []
  } finally {
    loading.value = false
  }
}

const confirmOverwrite = ref(false)
const pendingSpec = ref<{ spec: SpecFile; fullPath: string } | null>(null)

// Delete confirmation
const confirmDeleteVisible = ref(false)
const pendingDeleteSpec = ref<SpecFile | null>(null)

async function createSpec() {
  const title = newTitle.value.trim()
  if (!title) return

  const workspace = workspacesStore.activeWorkspace
  if (!workspace) return

  creating.value = true
  try {
    const now = new Date().toISOString()
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const fileName = `${slug}.spec.md`
    const relativePath = `.quantcode/specs/${fileName}`
    const fullPath = workspace.folderPath + '/' + relativePath

    const content = `\n## Requirements\n\n- \n\n## Current State\n\n- `

    const spec: SpecFile = {
      path: relativePath,
      frontmatter: {
        title,
        status: 'planned',
        priority: newPriority.value as SpecFile['frontmatter']['priority'],
        linkedFiles: [relativePath],
        createdAt: now,
        updatedAt: now,
      },
      content,
      rawContent: '',
    }
    spec.rawContent = serializeSpec(spec)

    // Check if file already exists
    let exists = false
    try {
      await invoke<string>('read_file', { path: fullPath })
      exists = true
    } catch {
      // File doesn't exist — good
    }

    if (exists) {
      pendingSpec.value = { spec, fullPath }
      confirmOverwrite.value = true
      return
    }

    await writeSpec(spec, fullPath)
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  } finally {
    creating.value = false
  }
}

function refreshExplorer() {
  try {
    if (typeof appStore.triggerFileExplorerRefresh === 'function') {
      appStore.triggerFileExplorerRefresh()
    } else {
      // Fallback: directly increment the ref
      appStore.fileExplorerRefreshKey++
    }
  } catch { /* HMR */ }
}

async function writeSpec(spec: SpecFile, fullPath: string) {
  await invoke('write_file', { path: fullPath, content: spec.rawContent })

  newTitle.value = ''
  newPriority.value = 'medium'

  // Refresh dashboard
  await loadSpecs()

  // Refresh file explorer (preserves expanded folders)
  refreshExplorer()

  // Refresh any open spec tabs in the editor
  try {
    for (const tab of appStore.activeEditorTabs) {
      if (!tab.filePath.endsWith('.spec.md')) continue
      if (appStore.pathsMatch(tab.filePath, spec.path) || appStore.pathsMatch(tab.filePath, fullPath)) {
        appStore.notifyFileSaved(tab.filePath, spec.rawContent)
        continue
      }
      // Other spec tabs: re-read from disk
      try {
        const workspace = workspacesStore.activeWorkspace
        if (!workspace) continue
        const content = await invoke<string>('read_file', {
          path: tab.filePath.includes(':') || tab.filePath.startsWith('/')
            ? tab.filePath
            : workspace.folderPath + '/' + tab.filePath,
        })
        appStore.refreshTab(tab.filePath, content)
      } catch { /* Tab file may have been deleted */ }
    }
  } catch { /* HMR */ }
}

async function handleOverwrite(overwrite: boolean) {
  confirmOverwrite.value = false
  if (overwrite && pendingSpec.value) {
    try {
      await writeSpec(pendingSpec.value.spec, pendingSpec.value.fullPath)
    } catch (err) {
      errorMsg.value = err instanceof Error ? err.message : String(err)
    }
  }
  pendingSpec.value = null
  creating.value = false
}

async function openInEditor(spec: SpecFile) {
  const workspace = workspacesStore.activeWorkspace
  if (!workspace) return

  try {
    const content = await invoke<string>('read_file', {
      path: workspace.folderPath + '/' + spec.path,
    })
    appStore.openTab(spec.path, content)
    if (!appStore.editorVisible) {
      appStore.toggleEditor()
    }
  } catch {
    appStore.openTab(spec.path, spec.rawContent)
    if (!appStore.editorVisible) {
      appStore.toggleEditor()
    }
  }
}

function toggleExpand(path: string) {
  expandedSpecPath.value = expandedSpecPath.value === path ? null : path
}

async function changeStatus(spec: SpecFile, newSt: SpecStatus) {
  const workspace = workspacesStore.activeWorkspace
  spec.frontmatter.status = newSt
  spec.frontmatter.updatedAt = new Date().toISOString()

  let updated = updateSpecField(spec.rawContent, 'status', newSt)
  updated = updateSpecField(updated, 'updatedAt', spec.frontmatter.updatedAt)
  spec.rawContent = updated

  if (workspace) {
    try {
      await invoke('write_file', {
        path: workspace.folderPath + '/' + spec.path,
        content: updated,
      })
    } catch {
      // File write may fail if path doesn't exist
    }
  }
}

function requestDeleteSpec(spec: SpecFile) {
  pendingDeleteSpec.value = spec
  confirmDeleteVisible.value = true
}

async function handleDelete(confirmed: boolean) {
  confirmDeleteVisible.value = false
  if (!confirmed || !pendingDeleteSpec.value) {
    pendingDeleteSpec.value = null
    return
  }

  const spec = pendingDeleteSpec.value
  pendingDeleteSpec.value = null

  const workspace = workspacesStore.activeWorkspace
  if (!workspace) return

  try {
    const fullPath = workspace.folderPath + '/' + spec.path
    await invoke('delete_file', { path: fullPath })
    if (expandedSpecPath.value === spec.path) expandedSpecPath.value = null

    // Close from sidebar editor + canvas windows
    appStore.notifyFileDeleted(fullPath)

    // Refresh dashboard
    await loadSpecs()

    // Refresh file explorer
    refreshExplorer()
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  }
}

// Refresh spec list when a file is deleted from the explorer
watch(() => appStore.lastDeletedFile, (deleted) => {
  if (deleted?.filePath.endsWith('.spec.md')) {
    loadSpecs()
  }
})

onMounted(() => {
  loadSpecs()
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header bar -->
    <div class="flex items-center justify-between px-3 py-1.5 flex-shrink-0" :style="{ borderBottom: '1px solid var(--qc-border)', background: 'var(--qc-bg-header)' }">
      <span class="text-[10px]" :style="{ color: 'var(--qc-text-dim)' }">{{ specs.length }} specs</span>
      <button
        class="text-[10px] transition-colors"
        :style="{ color: 'var(--qc-text-dim)' }"
        :disabled="loading"
        @click="loadSpecs"
      >
        {{ loading ? '...' : 'Refresh' }}
      </button>
    </div>

    <!-- Create new spec form — single row: title + priority + create -->
    <div class="px-2 py-2 flex-shrink-0 flex items-center gap-1.5" :style="{ borderBottom: '1px solid var(--qc-border)' }">
      <input
        v-model="newTitle"
        type="text"
        placeholder="New spec title..."
        class="text-xs px-2 py-1.5 rounded outline-none flex-1 min-w-0"
        :style="{ background: 'var(--qc-bg)', border: '1px solid var(--qc-border)', color: 'var(--qc-text)' }"
        @keydown.enter="createSpec"
      >
      <select
        v-model="newPriority"
        class="text-[10px] rounded px-1.5 py-1.5 outline-none"
        :style="{ background: 'var(--qc-bg)', border: '1px solid var(--qc-border)', color: 'var(--qc-text)' }"
      >
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <button
        class="text-[10px] px-2.5 py-1.5 rounded transition-colors flex-shrink-0"
        :style="{
          background: newTitle.trim() ? 'var(--color-accent, #6366f1)' : 'var(--qc-bg-surface)',
          color: newTitle.trim() ? '#fff' : 'var(--qc-text-dim)',
          opacity: creating ? 0.5 : 1,
        }"
        :disabled="!newTitle.trim() || creating"
        @click="createSpec"
      >
        {{ creating ? '...' : 'Create' }}
      </button>
    </div>

    <!-- Overwrite confirmation -->
    <div
      v-if="confirmOverwrite"
      class="px-2 py-2 flex items-center gap-2 flex-shrink-0 text-[10px]"
      :style="{ borderBottom: '1px solid var(--qc-border)', background: 'rgba(239,68,68,0.05)' }"
    >
      <span class="text-red-400 flex-1">File already exists. Overwrite?</span>
      <button
        class="px-2 py-0.5 rounded text-red-400"
        :style="{ border: '1px solid var(--qc-border)' }"
        @click="handleOverwrite(true)"
      >
        Overwrite
      </button>
      <button
        class="px-2 py-0.5 rounded"
        :style="{ color: 'var(--qc-text-dim)', border: '1px solid var(--qc-border)' }"
        @click="handleOverwrite(false)"
      >
        Cancel
      </button>
    </div>

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
          <div class="text-xs font-bold" :style="{ color: 'var(--qc-text)' }">Delete Spec</div>
          <p class="text-xs leading-relaxed" :style="{ color: 'var(--qc-text-dim)' }">
            Are you sure you want to delete
            <span class="text-red-400 font-medium">"{{ pendingDeleteSpec?.frontmatter.title }}"</span>?
            This cannot be undone.
          </p>
          <div class="flex items-center justify-end gap-2 pt-1">
            <button
              class="text-[10px] px-3 py-1.5 rounded transition-colors"
              :style="{ color: 'var(--qc-text-dim)', border: '1px solid var(--qc-border)' }"
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

    <!-- Loading state -->
    <div v-if="loading" class="flex-1 flex items-center justify-center text-xs" :style="{ color: 'var(--qc-text-dim)' }">
      Loading specs...
    </div>

    <!-- Error state -->
    <div
      v-else-if="errorMsg"
      class="flex-1 flex items-center justify-center text-xs px-4 text-center"
      :style="{ color: 'var(--qc-text-dim)' }"
    >
      {{ errorMsg }}
    </div>

    <!-- Specs content — always show all status groups -->
    <div v-else class="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-3">
      <div
        v-for="status in statusOrder"
        :key="status"
        class="space-y-1"
      >
        <!-- Group header — always visible -->
        <div class="flex items-center gap-2 px-1 py-1">
          <span
            class="w-1.5 h-1.5 rounded-full flex-shrink-0"
            :style="{ backgroundColor: statusConfig[status].dotColor }"
          />
          <span
            class="text-[10px] font-bold uppercase tracking-wider"
            :class="statusConfig[status].color"
          >
            {{ statusConfig[status].label }}
          </span>
          <span class="text-[10px]" :style="{ color: 'var(--qc-text-dim)' }">{{ groupedSpecs[status].length }}</span>
        </div>

        <!-- Spec cards -->
        <div
          v-for="spec in groupedSpecs[status]"
          :key="spec.path"
          class="rounded-md overflow-hidden"
          :style="{ background: 'var(--qc-bg)', border: '1px solid var(--qc-border)' }"
        >
          <!-- Card header -->
          <div
            class="flex items-center gap-2 px-2.5 py-2 cursor-pointer transition-colors hover:brightness-95"
            @click="toggleExpand(spec.path)"
          >
            <span
              class="w-1.5 h-1.5 rounded-full flex-shrink-0"
              :style="{ backgroundColor: statusConfig[spec.frontmatter.status].dotColor }"
            />
            <span class="text-xs flex-1 truncate" :style="{ color: 'var(--qc-text)' }">{{ spec.frontmatter.title }}</span>

            <!-- Priority badge -->
            <span
              v-if="spec.frontmatter.priority"
              class="text-[9px] px-1 py-0.5 rounded"
              :class="priorityConfig[spec.frontmatter.priority]?.color ?? ''"
              :style="{ backgroundColor: 'rgba(255,255,255,0.05)' }"
            >
              {{ priorityConfig[spec.frontmatter.priority]?.label ?? spec.frontmatter.priority }}
            </span>

            <!-- Agent -->
            <span
              v-if="spec.frontmatter.assignedTo"
              class="text-[9px] text-[#22d3ee]"
            >
              {{ spec.frontmatter.assignedTo }}
            </span>

            <!-- Files count -->
            <span
              v-if="spec.frontmatter.linkedFiles?.length"
              class="text-[9px]"
              :style="{ color: 'var(--qc-text-dim)' }"
            >
              {{ spec.frontmatter.linkedFiles.length }} files
            </span>

            <span class="text-[10px]" :style="{ color: 'var(--qc-text-dim)' }">{{ expandedSpecPath === spec.path ? '\u25B4' : '\u25BE' }}</span>
          </div>

          <!-- Expanded content -->
          <div
            v-if="expandedSpecPath === spec.path"
            class="px-2.5 py-2 space-y-2"
            :style="{ borderTop: '1px solid var(--qc-border)' }"
          >
            <p class="text-xs leading-relaxed whitespace-pre-wrap" :style="{ color: 'var(--qc-text)' }">{{ spec.content }}</p>

            <!-- Linked files -->
            <div v-if="spec.frontmatter.linkedFiles?.length" class="space-y-0.5">
              <div class="text-[10px]" :style="{ color: 'var(--qc-text-dim)' }">Linked files:</div>
              <div
                v-for="f in spec.frontmatter.linkedFiles"
                :key="f"
                class="text-[10px] text-[#22d3ee] font-mono pl-2"
              >
                {{ f }}
              </div>
            </div>

            <!-- Actions row -->
            <div class="flex items-center gap-2 pt-1">
              <span class="text-[10px]" :style="{ color: 'var(--qc-text-dim)' }">Status:</span>
              <select
                :value="spec.frontmatter.status"
                class="text-[10px] rounded px-1.5 py-0.5 outline-none"
                :style="{ background: 'var(--qc-bg-surface)', border: '1px solid var(--qc-border)', color: 'var(--qc-text)' }"
                @change="changeStatus(spec, ($event.target as HTMLSelectElement).value as SpecStatus)"
              >
                <option value="planned">Planned</option>
                <option value="in-progress">In Progress</option>
                <option value="done">Done</option>
                <option value="blocked">Blocked</option>
              </select>

              <button
                class="text-[10px] px-1.5 py-0.5 rounded transition-colors ml-auto"
                :style="{ color: 'var(--qc-text-dim)', border: '1px solid var(--qc-border)' }"
                @click.stop="openInEditor(spec)"
              >
                Open in Editor
              </button>
              <button
                class="text-[10px] px-1.5 py-0.5 rounded transition-colors text-red-400"
                :style="{ border: '1px solid var(--qc-border)' }"
                @click.stop="requestDeleteSpec(spec)"
              >
                &times;
              </button>
            </div>
          </div>
        </div>

        <!-- Empty group hint -->
        <div
          v-if="groupedSpecs[status].length === 0"
          class="text-[10px] px-3 py-1.5 italic"
          :style="{ color: 'var(--qc-text-dim)', opacity: 0.5 }"
        >
          No specs
        </div>
      </div>
    </div>
  </div>
</template>
