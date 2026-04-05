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

// Pointer-based drag and drop state (HTML5 drag API doesn't work in Tauri)
const draggedSpec = ref<SpecFile | null>(null)
const dragOverStatus = ref<SpecStatus | null>(null)
const isDragging = ref(false)
const dragGhost = ref<HTMLElement | null>(null)
const dragStartY = ref(0)
const dragThreshold = 5 // px before drag activates
const pendingDragSpec = ref<SpecFile | null>(null)
const groupElements = ref<Map<SpecStatus, HTMLElement>>(new Map())

const statusOrder: SpecStatus[] = ['planned', 'in-progress', 'done', 'blocked']
const collapsedGroups = ref<Set<SpecStatus>>(new Set())

const statusConfig: Record<SpecStatus, { label: string; color: string; bg: string; dotColor: string; borderColor: string }> = {
  planned: { label: 'Planned', color: 'text-blue-400', bg: 'bg-blue-400/10', dotColor: '#3b82f6', borderColor: '#3b82f620' },
  'in-progress': { label: 'In Progress', color: 'text-amber-400', bg: 'bg-amber-400/10', dotColor: '#f59e0b', borderColor: '#f59e0b20' },
  done: { label: 'Done', color: 'text-green-400', bg: 'bg-green-400/10', dotColor: '#22c55e', borderColor: '#22c55e20' },
  blocked: { label: 'Blocked', color: 'text-red-400', bg: 'bg-red-400/10', dotColor: '#ef4444', borderColor: '#ef444420' },
}

const priorityConfig: Record<string, { label: string; color: string; bg: string }> = {
  critical: { label: 'CRIT', color: '#ef4444', bg: '#ef444418' },
  high: { label: 'HIGH', color: '#f97316', bg: '#f9731618' },
  medium: { label: 'MED', color: '#f59e0b', bg: '#f59e0b18' },
  low: { label: 'LOW', color: '#3b82f6', bg: '#3b82f618' },
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

function toggleGroup(status: SpecStatus) {
  if (collapsedGroups.value.has(status)) {
    collapsedGroups.value.delete(status)
  } else {
    collapsedGroups.value.add(status)
  }
  // Force reactivity
  collapsedGroups.value = new Set(collapsedGroups.value)
}

// Pointer-based drag and drop (works in Tauri unlike HTML5 drag API)
function onHandleMouseDown(e: MouseEvent, spec: SpecFile) {
  e.preventDefault()
  e.stopPropagation()
  pendingDragSpec.value = spec
  dragStartY.value = e.clientY

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!pendingDragSpec.value && !isDragging.value) return

  // Activate drag after threshold
  if (pendingDragSpec.value && !isDragging.value) {
    if (Math.abs(e.clientY - dragStartY.value) < dragThreshold) return
    isDragging.value = true
    draggedSpec.value = pendingDragSpec.value
    pendingDragSpec.value = null
    createGhost(e)
  }

  if (!isDragging.value || !dragGhost.value) return

  // Move ghost
  dragGhost.value.style.top = `${e.clientY - 14}px`
  dragGhost.value.style.left = `${e.clientX - 40}px`

  // Hit-test which group we're over
  let foundStatus: SpecStatus | null = null
  for (const [status, el] of groupElements.value) {
    const rect = el.getBoundingClientRect()
    if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
      foundStatus = status
      break
    }
  }
  dragOverStatus.value = foundStatus
}

async function onMouseUp(e: MouseEvent) {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)

  if (isDragging.value && draggedSpec.value && dragOverStatus.value) {
    const targetStatus = dragOverStatus.value
    if (draggedSpec.value.frontmatter.status !== targetStatus) {
      // Uncollapse the target group
      collapsedGroups.value.delete(targetStatus)
      collapsedGroups.value = new Set(collapsedGroups.value)

      await changeStatus(draggedSpec.value, targetStatus)
    }
  }

  // Cleanup
  removeGhost()
  isDragging.value = false
  draggedSpec.value = null
  dragOverStatus.value = null
  pendingDragSpec.value = null
}

function createGhost(e: MouseEvent) {
  const ghost = document.createElement('div')
  ghost.className = 'spec-drag-ghost'
  ghost.textContent = draggedSpec.value?.frontmatter.title ?? ''
  ghost.style.cssText = `
    position: fixed;
    top: ${e.clientY - 14}px;
    left: ${e.clientX - 40}px;
    z-index: 99999;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    color: #fff;
    background: var(--qc-accent, #6e8efb);
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    pointer-events: none;
    white-space: nowrap;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.95;
  `
  document.body.appendChild(ghost)
  dragGhost.value = ghost
}

function removeGhost() {
  if (dragGhost.value) {
    dragGhost.value.remove()
    dragGhost.value = null
  }
}

function registerGroupEl(status: SpecStatus, el: HTMLElement | null) {
  if (el) {
    groupElements.value.set(status, el)
  }
}

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

  // Reload so grouped view updates
  await loadSpecs()
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

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  removeGhost()
})
</script>

<template>
  <div class="spec-dashboard flex flex-col h-full">
    <!-- Create new spec form -->
    <div class="px-3 py-2.5 flex-shrink-0 spec-create-form">
      <div class="flex items-center gap-1.5">
        <input
          v-model="newTitle"
          type="text"
          placeholder="New spec title..."
          class="spec-input text-xs px-2.5 py-1.5 rounded-md outline-none flex-1 min-w-0 transition-all"
          @keydown.enter="createSpec"
        >
        <select
          v-model="newPriority"
          class="spec-select text-[10px] rounded-md px-1.5 py-1.5 outline-none"
        >
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button
          class="spec-create-btn text-[10px] px-3 py-1.5 rounded-md transition-all flex-shrink-0 font-medium"
          :class="{ active: newTitle.trim(), disabled: !newTitle.trim() || creating }"
          :disabled="!newTitle.trim() || creating"
          @click="createSpec"
        >
          {{ creating ? '...' : '+ Create' }}
        </button>
        <button
          class="spec-refresh-btn text-[10px] px-1.5 py-1.5 rounded-md transition-all flex-shrink-0"
          :disabled="loading"
          title="Refresh specs"
          @click="loadSpecs"
        >
          <span :class="{ 'inline-block animate-spin': loading }">&#8635;</span>
        </button>
      </div>
    </div>

    <!-- Overwrite confirmation -->
    <div
      v-if="confirmOverwrite"
      class="px-3 py-2 flex items-center gap-2 flex-shrink-0 text-[10px] spec-overwrite-bar"
    >
      <span class="text-red-400 flex-1">File already exists. Overwrite?</span>
      <button
        class="px-2 py-0.5 rounded text-red-400 spec-btn-outline"
        @click="handleOverwrite(true)"
      >
        Overwrite
      </button>
      <button
        class="px-2 py-0.5 rounded spec-btn-outline"
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
        style="background: rgba(0,0,0,0.5); backdrop-filter: blur(4px)"
        @click.self="handleDelete(false)"
      >
        <div class="spec-modal rounded-lg shadow-2xl p-5 min-w-[280px] max-w-[360px] space-y-3">
          <div class="text-xs font-bold" :style="{ color: 'var(--qc-text)' }">Delete Spec</div>
          <p class="text-xs leading-relaxed" :style="{ color: 'var(--qc-text-dim)' }">
            Are you sure you want to delete
            <span class="text-red-400 font-medium">"{{ pendingDeleteSpec?.frontmatter.title }}"</span>?
            This cannot be undone.
          </p>
          <div class="flex items-center justify-end gap-2 pt-1">
            <button
              class="text-[10px] px-3 py-1.5 rounded-md transition-colors spec-btn-outline"
              @click="handleDelete(false)"
            >
              Cancel
            </button>
            <button
              class="text-[10px] px-3 py-1.5 rounded-md transition-colors text-white bg-red-500 hover:bg-red-600"
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
      <span class="animate-pulse">Loading specs...</span>
    </div>

    <!-- Error state -->
    <div
      v-else-if="errorMsg"
      class="flex-1 flex items-center justify-center text-xs px-4 text-center"
      :style="{ color: 'var(--qc-text-dim)' }"
    >
      {{ errorMsg }}
    </div>

    <!-- Specs content with drag-and-drop groups -->
    <div v-else class="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2">
      <div
        v-for="status in statusOrder"
        :key="status"
        :ref="(el: any) => registerGroupEl(status, el as HTMLElement)"
        class="spec-group"
        :class="{ 'drag-over': dragOverStatus === status && draggedSpec?.frontmatter.status !== status }"
      >
        <!-- Group header -->
        <button
          class="spec-group-header w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all"
          :style="{ '--group-color': statusConfig[status].dotColor }"
          @click="toggleGroup(status)"
        >
          <span
            class="w-2 h-2 rounded-full flex-shrink-0 transition-all"
            :style="{ backgroundColor: statusConfig[status].dotColor, boxShadow: `0 0 6px ${statusConfig[status].dotColor}50` }"
          />
          <span
            class="text-[10px] font-bold uppercase tracking-wider flex-1 text-left"
            :class="statusConfig[status].color"
          >
            {{ statusConfig[status].label }}
          </span>
          <span class="spec-count text-[10px]">{{ groupedSpecs[status].length }}</span>
          <span
            class="text-[9px] transition-transform duration-200"
            :style="{ color: 'var(--qc-text-dim)', transform: collapsedGroups.has(status) ? 'rotate(-90deg)' : 'rotate(0deg)' }"
          >
            &#9662;
          </span>
        </button>

        <!-- Drop zone indicator -->
        <div
          v-if="isDragging && draggedSpec && draggedSpec.frontmatter.status !== status && dragOverStatus === status"
          class="spec-drop-indicator mx-1 my-1"
        >
          <span class="text-[9px]">Drop to move to {{ statusConfig[status].label }}</span>
        </div>

        <!-- Spec cards with transition -->
        <div
          v-show="!collapsedGroups.has(status)"
          class="spec-cards-container space-y-1 mt-1"
        >
          <div
            v-for="(spec, idx) in groupedSpecs[status]"
            :key="spec.path"
            class="spec-card rounded-md overflow-hidden transition-all duration-200"
            :class="{
              'expanded': expandedSpecPath === spec.path,
              'dragging': draggedSpec?.path === spec.path,
            }"
            :style="{ '--card-accent': statusConfig[spec.frontmatter.status].dotColor }"
          >
            <!-- Card header -->
            <div
              class="spec-card-header flex items-center gap-2 px-2.5 py-2 cursor-pointer"
              @click="toggleExpand(spec.path)"
            >
              <!-- Drag handle (pointer-based) -->
              <span
                class="spec-drag-handle text-[8px] cursor-grab active:cursor-grabbing flex-shrink-0"
                title="Drag to change status"
                @mousedown="onHandleMouseDown($event, spec)"
              >&#9776;</span>

              <span class="text-xs flex-1 truncate font-medium" :style="{ color: 'var(--qc-text)' }">
                {{ spec.frontmatter.title }}
              </span>

              <!-- Priority badge -->
              <span
                v-if="spec.frontmatter.priority && priorityConfig[spec.frontmatter.priority]"
                class="spec-priority-badge text-[8px] px-1.5 py-0.5 rounded-sm font-bold tracking-wider"
                :style="{
                  color: priorityConfig[spec.frontmatter.priority].color,
                  backgroundColor: priorityConfig[spec.frontmatter.priority].bg,
                }"
              >
                {{ priorityConfig[spec.frontmatter.priority].label }}
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
                class="spec-files-count text-[9px] flex items-center gap-0.5"
              >
                <span style="font-size: 7px">&#128196;</span>
                {{ spec.frontmatter.linkedFiles.length }}
              </span>

              <span
                class="text-[9px] transition-transform duration-200"
                :style="{ color: 'var(--qc-text-dim)', transform: expandedSpecPath === spec.path ? 'rotate(180deg)' : 'rotate(0deg)' }"
              >
                &#9662;
              </span>
            </div>

            <!-- Expanded content -->
            <div
              v-if="expandedSpecPath === spec.path"
              class="spec-card-body px-2.5 py-2.5 space-y-2.5"
            >
              <p class="text-[11px] leading-relaxed whitespace-pre-wrap" :style="{ color: 'var(--qc-text-muted)' }">{{ spec.content }}</p>

              <!-- Linked files -->
              <div v-if="spec.frontmatter.linkedFiles?.length" class="space-y-1">
                <div class="text-[9px] uppercase tracking-wider font-medium" :style="{ color: 'var(--qc-text-dim)' }">Linked files</div>
                <div
                  v-for="f in spec.frontmatter.linkedFiles"
                  :key="f"
                  class="text-[10px] text-[#22d3ee] font-mono pl-2 py-0.5 rounded spec-linked-file"
                >
                  {{ f }}
                </div>
              </div>

              <!-- Actions row -->
              <div class="flex items-center gap-2 pt-1 spec-actions">
                <select
                  :value="spec.frontmatter.status"
                  class="spec-select text-[10px] rounded-md px-1.5 py-1 outline-none"
                  @change="changeStatus(spec, ($event.target as HTMLSelectElement).value as SpecStatus)"
                >
                  <option value="planned">Planned</option>
                  <option value="in-progress">In Progress</option>
                  <option value="done">Done</option>
                  <option value="blocked">Blocked</option>
                </select>

                <div class="flex-1" />

                <button
                  class="spec-action-btn text-[10px] px-2 py-1 rounded-md transition-all"
                  @click.stop="openInEditor(spec)"
                >
                  Edit
                </button>
                <button
                  class="spec-action-btn spec-delete-btn text-[10px] px-1.5 py-1 rounded-md transition-all"
                  @click.stop="requestDeleteSpec(spec)"
                >
                  &#10005;
                </button>
              </div>
            </div>
          </div>

          <!-- Empty group hint -->
          <div
            v-if="groupedSpecs[status].length === 0 && !(draggedSpec && dragOverStatus === status)"
            class="text-[10px] px-3 py-2 italic spec-empty-hint"
          >
            No specs
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.spec-dashboard {
  background: var(--qc-bg-window);
}

.spec-header {
  border-bottom: 1px solid var(--qc-border);
  background: var(--qc-bg-header);
}

.spec-count-badge {
  color: var(--qc-text-muted);
  background: var(--qc-bg-surface);
  padding: 1px 6px;
  border-radius: 8px;
}

.spec-refresh-btn {
  color: var(--qc-text-dim);
  background: transparent;
  border: 1px solid transparent;
}
.spec-refresh-btn:hover {
  color: var(--qc-text-muted);
  background: var(--qc-bg-surface);
  border-color: var(--qc-border);
}

.spec-create-form {
  border-bottom: 1px solid var(--qc-border);
  background: var(--qc-bg-header);
}

.spec-input {
  background: var(--qc-bg);
  border: 1px solid var(--qc-border);
  color: var(--qc-text);
}
.spec-input:focus {
  border-color: var(--qc-accent);
  box-shadow: 0 0 0 1px var(--qc-accent);
}
.spec-input::placeholder {
  color: var(--qc-text-dim);
}

.spec-select {
  background: var(--qc-bg);
  border: 1px solid var(--qc-border);
  color: var(--qc-text);
}
.spec-select:focus {
  border-color: var(--qc-accent);
}

.spec-create-btn {
  color: var(--qc-text-dim);
  background: var(--qc-bg-surface);
  border: 1px solid var(--qc-border);
}
.spec-create-btn.active {
  color: #fff;
  background: var(--qc-accent);
  border-color: var(--qc-accent);
}
.spec-create-btn.active:hover {
  filter: brightness(1.1);
}
.spec-create-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spec-overwrite-bar {
  border-bottom: 1px solid var(--qc-border);
  background: rgba(239, 68, 68, 0.05);
}

.spec-btn-outline {
  color: var(--qc-text-dim);
  border: 1px solid var(--qc-border);
}
.spec-btn-outline:hover {
  background: var(--qc-bg-surface);
}

.spec-modal {
  background: var(--qc-bg-header);
  border: 1px solid var(--qc-border);
}

/* Group styles */
.spec-group {
  border-radius: 6px;
  transition: all 0.2s ease;
  padding: 2px;
}
.spec-group.drag-over {
  background: var(--qc-bg-surface);
  outline: 1px dashed var(--qc-accent);
  outline-offset: -1px;
}

.spec-group-header {
  background: transparent;
  border: none;
}
.spec-group-header:hover {
  background: var(--qc-bg-surface);
}

.spec-count {
  color: var(--qc-text-dim);
  background: var(--qc-bg-surface);
  padding: 0 5px;
  border-radius: 6px;
  min-width: 18px;
  text-align: center;
}

/* Drop indicator */
.spec-drop-indicator {
  border: 1px dashed var(--qc-accent);
  border-radius: 6px;
  padding: 8px;
  text-align: center;
  color: var(--qc-accent);
  background: rgba(110, 142, 251, 0.05);
  animation: pulse-border 1.5s ease infinite;
}
@keyframes pulse-border {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

/* Card styles */
.spec-card {
  background: var(--qc-bg);
  border: 1px solid var(--qc-border);
  border-left: 2px solid var(--card-accent, var(--qc-border));
  position: relative;
}
.spec-card:hover {
  border-color: var(--qc-border-subtle);
  background: color-mix(in srgb, var(--qc-bg) 95%, var(--card-accent) 5%);
}
.spec-card.expanded {
  border-color: var(--qc-border-subtle);
}
.spec-card.dragging {
  opacity: 0.4;
  transform: scale(0.98);
}

.spec-card-header:hover {
  background: rgba(255, 255, 255, 0.02);
}

.spec-drag-handle {
  color: var(--qc-text-dim);
  opacity: 0.4;
  transition: opacity 0.15s, color 0.15s;
  line-height: 1;
}
.spec-card:hover .spec-drag-handle {
  opacity: 0.7;
}
.spec-drag-handle:hover {
  opacity: 1 !important;
  color: var(--qc-accent);
}

.spec-priority-badge {
  letter-spacing: 0.05em;
}

.spec-files-count {
  color: var(--qc-text-dim);
}

.spec-card-body {
  border-top: 1px solid var(--qc-border);
  background: var(--qc-bg-header);
}

.spec-linked-file {
  background: rgba(34, 211, 238, 0.05);
}
.spec-linked-file:hover {
  background: rgba(34, 211, 238, 0.1);
}

.spec-actions {
  border-top: 1px solid var(--qc-border);
  padding-top: 8px;
}

.spec-action-btn {
  color: var(--qc-text-dim);
  background: var(--qc-bg-surface);
  border: 1px solid var(--qc-border);
}
.spec-action-btn:hover {
  color: var(--qc-text);
  border-color: var(--qc-border-subtle);
}

.spec-delete-btn:hover {
  color: #ef4444;
  border-color: #ef444440;
  background: #ef444410;
}

.spec-empty-hint {
  color: var(--qc-text-dim);
  opacity: 0.5;
}

/* Smooth scrollbar */
.spec-dashboard ::-webkit-scrollbar {
  width: 4px;
}
.spec-dashboard ::-webkit-scrollbar-track {
  background: transparent;
}
.spec-dashboard ::-webkit-scrollbar-thumb {
  background: var(--qc-scrollbar-thumb);
  border-radius: 4px;
}
.spec-dashboard ::-webkit-scrollbar-thumb:hover {
  background: var(--qc-scrollbar-thumb-hover);
}
</style>
