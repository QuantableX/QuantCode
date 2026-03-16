<script setup lang="ts">
import type { CanvasWindow, FileDiff, DiffHunk } from '../../../shared/types'

const props = defineProps<{
  window: CanvasWindow
  diffs?: FileDiff[]
}>()

const emit = defineEmits<{
  (e: 'accept-hunk', hunkId: string): void
  (e: 'reject-hunk', hunkId: string): void
  (e: 'accept-all'): void
  (e: 'reject-all'): void
}>()

const viewMode = ref<'inline' | 'side-by-side'>('inline')
const activeFileIndex = ref(0)

const fileDiffs = computed<FileDiff[]>(() => {
  if (props.diffs && props.diffs.length > 0) return props.diffs

  // Demo data when no diffs provided
  return [
    {
      filePath: 'src/main.ts',
      isNew: false,
      isDeleted: false,
      hunks: [
        {
          id: 'demo-1',
          filePath: 'src/main.ts',
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 5,
          oldContent: 'const app = createApp()\napp.use(router)\napp.mount("#app")',
          newContent: 'import { pinia } from "./stores"\n\nconst app = createApp()\napp.use(router)\napp.use(pinia)\napp.mount("#app")',
          accepted: undefined,
        },
      ],
    },
  ]
})

const activeFile = computed(() => fileDiffs.value[activeFileIndex.value])

function getOldLines(hunk: DiffHunk): string[] {
  return hunk.oldContent.split('\n')
}

function getNewLines(hunk: DiffHunk): string[] {
  return hunk.newContent.split('\n')
}

interface DiffLine {
  type: 'unchanged' | 'added' | 'removed'
  content: string
  oldLineNum: number | null
  newLineNum: number | null
}

function computeInlineDiff(hunk: DiffHunk): DiffLine[] {
  const oldLines = getOldLines(hunk)
  const newLines = getNewLines(hunk)
  const lines: DiffLine[] = []

  // Simple diff: show all old lines as removed, then all new as added
  // For matching lines, show as unchanged
  const maxLen = Math.max(oldLines.length, newLines.length)
  let oldIdx = 0
  let newIdx = 0

  // Try to match lines
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldIdx < oldLines.length ? oldLines[oldIdx] : null
    const newLine = newIdx < newLines.length ? newLines[newIdx] : null

    if (oldLine !== null && newLine !== null && oldLine === newLine) {
      lines.push({
        type: 'unchanged',
        content: oldLine,
        oldLineNum: hunk.oldStart + oldIdx,
        newLineNum: hunk.newStart + newIdx,
      })
      oldIdx++
      newIdx++
    } else {
      // Check if the old line appears later in new (insertion before it)
      if (newLine !== null && oldLine !== null && newLines.indexOf(oldLine, newIdx) > newIdx) {
        lines.push({
          type: 'added',
          content: newLine,
          oldLineNum: null,
          newLineNum: hunk.newStart + newIdx,
        })
        newIdx++
        i-- // retry the old line
      } else if (oldLine !== null && newLine !== null && oldLines.indexOf(newLine, oldIdx) > oldIdx) {
        lines.push({
          type: 'removed',
          content: oldLine,
          oldLineNum: hunk.oldStart + oldIdx,
          newLineNum: null,
        })
        oldIdx++
        i-- // retry the new line
      } else {
        if (oldLine !== null) {
          lines.push({
            type: 'removed',
            content: oldLine,
            oldLineNum: hunk.oldStart + oldIdx,
            newLineNum: null,
          })
          oldIdx++
        }
        if (newLine !== null) {
          lines.push({
            type: 'added',
            content: newLine,
            oldLineNum: null,
            newLineNum: hunk.newStart + newIdx,
          })
          newIdx++
        }
      }
    }
  }

  return lines
}

function acceptHunk(hunkId: string) {
  const file = activeFile.value
  if (!file) return
  const hunk = file.hunks.find(h => h.id === hunkId)
  if (hunk) hunk.accepted = true
  emit('accept-hunk', hunkId)
}

function rejectHunk(hunkId: string) {
  const file = activeFile.value
  if (!file) return
  const hunk = file.hunks.find(h => h.id === hunkId)
  if (hunk) hunk.accepted = false
  emit('reject-hunk', hunkId)
}

function acceptAll() {
  for (const file of fileDiffs.value) {
    for (const hunk of file.hunks) {
      hunk.accepted = true
    }
  }
  emit('accept-all')
}

function rejectAll() {
  for (const file of fileDiffs.value) {
    for (const hunk of file.hunks) {
      hunk.accepted = false
    }
  }
  emit('reject-all')
}

function extractFileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex items-center justify-between px-3 py-1.5 flex-shrink-0" :style="{ borderBottom: '1px solid var(--qc-border)', background: 'var(--qc-bg-header)' }">
      <div class="flex items-center gap-2">
        <button
          class="px-2 py-0.5 text-[10px] rounded transition-colors"
          :style="viewMode === 'inline' ? { background: 'var(--qc-bg-surface)', color: 'var(--qc-text)' } : { color: 'var(--qc-text-dim)' }"
          @click="viewMode = 'inline'"
        >
          Inline
        </button>
        <button
          class="px-2 py-0.5 text-[10px] rounded transition-colors"
          :style="viewMode === 'side-by-side' ? { background: 'var(--qc-bg-surface)', color: 'var(--qc-text)' } : { color: 'var(--qc-text-dim)' }"
          @click="viewMode = 'side-by-side'"
        >
          Side by Side
        </button>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="px-2 py-0.5 text-[10px] text-green-400 bg-green-400/10 rounded hover:bg-green-400/20 transition-colors"
          @click="acceptAll"
        >
          Accept All
        </button>
        <button
          class="px-2 py-0.5 text-[10px] text-red-400 bg-red-400/10 rounded hover:bg-red-400/20 transition-colors"
          @click="rejectAll"
        >
          Reject All
        </button>
      </div>
    </div>

    <!-- File tabs -->
    <div class="flex items-center gap-0 overflow-x-auto flex-shrink-0" :style="{ borderBottom: '1px solid var(--qc-border)', background: 'var(--qc-bg)' }">
      <button
        v-for="(file, idx) in fileDiffs"
        :key="file.filePath"
        class="px-3 py-1.5 text-[10px] transition-colors flex items-center gap-1.5 flex-shrink-0"
        :style="{
          borderRight: '1px solid var(--qc-border)',
          background: idx === activeFileIndex ? 'var(--qc-bg-window)' : 'transparent',
          color: idx === activeFileIndex ? 'var(--qc-text)' : 'var(--qc-text-dim)',
          borderBottom: idx === activeFileIndex ? '2px solid var(--color-accent)' : '2px solid transparent',
        }"
        @click="activeFileIndex = idx"
      >
        <span
          v-if="file.isNew"
          class="text-green-400"
        >N</span>
        <span
          v-else-if="file.isDeleted"
          class="text-red-400"
        >D</span>
        <span
          v-else
          class="text-amber-400"
        >M</span>
        {{ extractFileName(file.filePath) }}
      </button>
    </div>

    <!-- Diff content -->
    <div class="flex-1 min-h-0 overflow-auto font-mono text-xs">
      <template v-if="activeFile">
        <div
          v-for="hunk in activeFile.hunks"
          :key="hunk.id"
          :style="{ borderBottom: '1px solid var(--qc-border)' }"
        >
          <!-- Hunk header -->
          <div class="flex items-center justify-between px-3 py-1 text-[10px]" :style="{ background: 'var(--qc-bg-header)', color: 'var(--qc-text-dim)' }">
            <span>@@ -{{ hunk.oldStart }},{{ hunk.oldLines }} +{{ hunk.newStart }},{{ hunk.newLines }} @@</span>
            <div class="flex items-center gap-1.5">
              <span
                v-if="hunk.accepted === true"
                class="text-green-400"
              >Accepted</span>
              <span
                v-else-if="hunk.accepted === false"
                class="text-red-400"
              >Rejected</span>
              <button
                class="px-1.5 py-0.5 text-green-400 bg-green-400/10 rounded hover:bg-green-400/20 transition-colors"
                @click="acceptHunk(hunk.id)"
              >
                &#10003;
              </button>
              <button
                class="px-1.5 py-0.5 text-red-400 bg-red-400/10 rounded hover:bg-red-400/20 transition-colors"
                @click="rejectHunk(hunk.id)"
              >
                &#10005;
              </button>
            </div>
          </div>

          <!-- Inline view -->
          <template v-if="viewMode === 'inline'">
            <div
              v-for="(line, lineIdx) in computeInlineDiff(hunk)"
              :key="lineIdx"
              class="flex"
              :class="{
                'bg-red-500/10': line.type === 'removed',
                'bg-green-500/10': line.type === 'added',
              }"
            >
              <span class="w-10 text-right pr-2 select-none flex-shrink-0" :style="{ color: 'var(--qc-text-dim)', borderRight: '1px solid var(--qc-border)' }">
                {{ line.oldLineNum ?? '' }}
              </span>
              <span class="w-10 text-right pr-2 select-none flex-shrink-0" :style="{ color: 'var(--qc-text-dim)', borderRight: '1px solid var(--qc-border)' }">
                {{ line.newLineNum ?? '' }}
              </span>
              <span class="w-5 text-center flex-shrink-0" :class="{
                'text-red-400': line.type === 'removed',
                'text-green-400': line.type === 'added',
              }">
                {{ line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' ' }}
              </span>
              <span class="px-2 whitespace-pre">{{ line.content }}</span>
            </div>
          </template>

          <!-- Side by side view -->
          <template v-else>
            <div class="flex">
              <!-- Old side -->
              <div class="flex-1" :style="{ borderRight: '1px solid var(--qc-border)' }">
                <div
                  v-for="(line, lineIdx) in getOldLines(hunk)"
                  :key="'old-' + lineIdx"
                  class="flex bg-red-500/5"
                >
                  <span class="w-10 text-right pr-2 select-none flex-shrink-0" :style="{ color: 'var(--qc-text-dim)', borderRight: '1px solid var(--qc-border)' }">
                    {{ hunk.oldStart + lineIdx }}
                  </span>
                  <span class="px-2 whitespace-pre text-red-300">{{ line }}</span>
                </div>
              </div>
              <!-- New side -->
              <div class="flex-1">
                <div
                  v-for="(line, lineIdx) in getNewLines(hunk)"
                  :key="'new-' + lineIdx"
                  class="flex bg-green-500/5"
                >
                  <span class="w-10 text-right pr-2 select-none flex-shrink-0" :style="{ color: 'var(--qc-text-dim)', borderRight: '1px solid var(--qc-border)' }">
                    {{ hunk.newStart + lineIdx }}
                  </span>
                  <span class="px-2 whitespace-pre text-green-300">{{ line }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>
