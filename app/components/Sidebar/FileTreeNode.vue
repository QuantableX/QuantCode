<script setup lang="ts">
import type { FileNode, GitFileStatus } from '../../../shared/types'

const props = defineProps<{
  node: FileNode
  depth: number
  gitStatusStyle: Record<GitFileStatus, { letter: string; color: string }>
}>()

const emit = defineEmits<{
  (e: 'toggle', node: FileNode): void
  (e: 'open', node: FileNode): void
  (e: 'contextmenu', event: MouseEvent, node: FileNode): void
  (e: 'dragstart', event: DragEvent, node: FileNode): void
}>()

const paddingLeft = computed(() => `${props.depth * 16 + 8}px`)

function onClick() {
  if (props.node.isDirectory) {
    emit('toggle', props.node)
  } else {
    emit('open', props.node)
  }
}

function onContext(e: MouseEvent) {
  emit('contextmenu', e, props.node)
}

function onDragStart(e: DragEvent) {
  if (props.node.isDirectory) {
    e.preventDefault()
    return
  }
  emit('dragstart', e, props.node)
}

const gitInfo = computed(() => {
  const status = props.node.gitStatus
  if (!status || status === 'clean') return null
  return props.gitStatusStyle[status]
})
</script>

<template>
  <div>
    <!-- Node row -->
    <div
      class="flex items-center gap-1.5 py-0.5 px-1 cursor-pointer transition-colors group file-tree-row"
      :style="{ paddingLeft }"
      :draggable="!node.isDirectory"
      @click="onClick"
      @contextmenu.prevent="onContext"
      @dragstart="onDragStart"
    >
      <!-- Expand arrow (directories only) -->
      <span
        v-if="node.isDirectory"
        class="text-[10px] w-3 text-center flex-shrink-0 transition-transform"
        :class="{ 'rotate-90': node.expanded }"
        :style="{ color: 'var(--qc-text-muted)' }"
      >
        &#9656;
      </span>
      <span v-else class="w-3 flex-shrink-0" />

      <!-- Icon -->
      <span class="flex-shrink-0 flex items-center">
        <template v-if="node.isDirectory">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" :class="node.expanded ? 'text-amber-400' : 'text-amber-400/60'">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" :fill="node.expanded ? 'currentColor' : 'none'" />
          </svg>
        </template>
        <template v-else>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a5a65" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </template>
      </span>

      <!-- Name -->
      <span
        class="text-xs truncate flex-1"
        :style="{ color: node.isDirectory ? 'var(--qc-text)' : 'color-mix(in srgb, var(--qc-text) 80%, transparent)' }"
      >
        {{ node.name }}
      </span>

      <!-- Git status -->
      <span
        v-if="gitInfo"
        class="text-[9px] font-bold flex-shrink-0 mr-1"
        :class="gitInfo.color"
      >
        {{ gitInfo.letter }}
      </span>
    </div>

    <!-- Children (expanded directories) -->
    <template v-if="node.isDirectory && node.expanded && node.children">
      <SidebarFileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :git-status-style="gitStatusStyle"
        @toggle="emit('toggle', $event)"
        @open="emit('open', $event)"
        @contextmenu="(event, n) => emit('contextmenu', event, n)"
        @dragstart="(event, n) => emit('dragstart', event, n)"
      />
    </template>
  </div>
</template>
