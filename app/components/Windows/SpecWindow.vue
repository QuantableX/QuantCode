<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import type { CanvasWindow, SpecFile, SpecStatus } from '../../../shared/types'
import { useWorkspacesStore } from '../../../stores/workspaces'

const props = defineProps<{
  window: CanvasWindow
}>()

const workspacesStore = useWorkspacesStore()

const specs = ref<SpecFile[]>([])
const expandedSpecPath = ref<string | null>(null)
const loading = ref(false)

const statusOrder: SpecStatus[] = ['in-progress', 'planned', 'blocked', 'done']

const statusConfig: Record<SpecStatus, { label: string; color: string; bg: string }> = {
  planned: { label: 'Planned', color: 'text-blue-400', bg: 'bg-blue-400/10' },
  'in-progress': { label: 'In Progress', color: 'text-amber-400', bg: 'bg-amber-400/10' },
  done: { label: 'Done', color: 'text-green-400', bg: 'bg-green-400/10' },
  blocked: { label: 'Blocked', color: 'text-red-400', bg: 'bg-red-400/10' },
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
  try {
    const workspace = workspacesStore.activeWorkspace
    if (!workspace) return

    const result = await invoke<SpecFile[]>('load_specs', {
      workspacePath: workspace.folderPath,
    })
    specs.value = result
  } catch {
    // If Tauri not available, use demo data
    specs.value = [
      {
        path: 'specs/auth-system.md',
        frontmatter: {
          title: 'Authentication System',
          status: 'in-progress',
          priority: 'high',
          assignedTo: 'Agent-1',
          linkedFiles: ['src/auth.ts', 'src/middleware.ts'],
          tags: ['security', 'core'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        content: 'Implement OAuth2 and session-based authentication for all API endpoints.',
        rawContent: '---\ntitle: Authentication System\n---\nImplement OAuth2...',
      },
      {
        path: 'specs/canvas-ui.md',
        frontmatter: {
          title: 'Canvas UI Components',
          status: 'planned',
          priority: 'medium',
          linkedFiles: ['src/components/Canvas.vue'],
          tags: ['ui'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        content: 'Build infinity canvas with pan, zoom, and window management.',
        rawContent: '',
      },
      {
        path: 'specs/terminal-pty.md',
        frontmatter: {
          title: 'Terminal PTY Integration',
          status: 'done',
          priority: 'high',
          assignedTo: 'Agent-2',
          linkedFiles: ['src-tauri/src/terminal.rs'],
          tags: ['terminal'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        content: 'Integrate xterm.js with Tauri PTY backend for full terminal support.',
        rawContent: '',
      },
      {
        path: 'specs/api-rate-limit.md',
        frontmatter: {
          title: 'API Rate Limiting',
          status: 'blocked',
          priority: 'low',
          tags: ['api'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        content: 'Implement rate limiting. Blocked: waiting for provider API changes.',
        rawContent: '',
      },
    ]
  } finally {
    loading.value = false
  }
}

function toggleExpand(path: string) {
  expandedSpecPath.value = expandedSpecPath.value === path ? null : path
}

async function changeStatus(spec: SpecFile, newStatus: SpecStatus) {
  spec.frontmatter.status = newStatus
  spec.frontmatter.updatedAt = new Date().toISOString()
  try {
    await invoke('update_spec_status', {
      specPath: spec.path,
      status: newStatus,
    })
  } catch {
    // ignore if Tauri not available
  }
}

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
        @click="loadSpecs"
      >
        Refresh
      </button>
    </div>

    <!-- Specs content -->
    <div class="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-3">
      <div v-if="loading" class="flex items-center justify-center h-full text-xs" :style="{ color: 'var(--qc-text-dim)' }">
        Loading specs...
      </div>

      <template v-else>
        <div
          v-for="status in statusOrder"
          :key="status"
          class="space-y-1"
        >
          <!-- Group header -->
          <div
            v-if="groupedSpecs[status].length > 0"
            class="flex items-center gap-2 px-1 py-1"
          >
            <span
              class="text-[10px] font-bold uppercase tracking-wider"
              :class="statusConfig[status].color"
            >
              {{ statusConfig[status].label }}
            </span>
            <span class="text-[10px]" :style="{ color: 'var(--qc-text-dim)' }">({{ groupedSpecs[status].length }})</span>
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
                :class="statusConfig[spec.frontmatter.status].bg"
                :style="{ backgroundColor: statusConfig[spec.frontmatter.status].color.replace('text-', '').includes('blue') ? '#3b82f6' : statusConfig[spec.frontmatter.status].color.replace('text-', '').includes('amber') ? '#f59e0b' : statusConfig[spec.frontmatter.status].color.replace('text-', '').includes('green') ? '#22c55e' : '#ef4444' }"
              />
              <span class="text-xs flex-1 truncate" :style="{ color: 'var(--qc-text)' }">{{ spec.frontmatter.title }}</span>

              <!-- Priority badge -->
              <span
                v-if="spec.frontmatter.priority"
                class="text-[9px] px-1 py-0.5 rounded"
                :class="[
                  priorityConfig[spec.frontmatter.priority]?.color ?? '',
                  'bg-current/10',
                ]"
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

              <!-- Status change -->
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
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
