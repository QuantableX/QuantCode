<script setup lang="ts">
import { useCanvasStore } from '../../../stores/canvas'
import { useWorkspacesStore } from '../../../stores/workspaces'
import { useAppStore } from '../../../stores/app'

const canvasStore = useCanvasStore()
const workspacesStore = useWorkspacesStore()
const appStore = useAppStore()

const rightSidebarWidth = inject<Ref<number>>('rightSidebarWidth', ref(220))

const visible = ref(true)
const minimapRef = ref<HTMLElement | null>(null)
const canvasRef = inject<Ref<HTMLElement | null>>('canvasRef', ref(null))

const MINIMAP_W = 200
const MINIMAP_H = 150
const PADDING = 20

const workspaceId = computed(() => workspacesStore.activeWorkspaceId)
const canvasState = computed(() => canvasStore.activeCanvasState)
const windows = computed(() => canvasState.value?.windows ?? [])
const transform = computed(() => canvasState.value?.transform ?? { x: 0, y: 0, scale: 1 })

// Track actual canvas container size
const containerSize = ref({ width: 800, height: 600 })

function updateContainerSize() {
  const el = canvasRef?.value
  if (el) {
    containerSize.value = { width: el.clientWidth, height: el.clientHeight }
  }
}

let resizeObserver: ResizeObserver | null = null

watch(canvasRef, (el) => {
  resizeObserver?.disconnect()
  if (el) {
    updateContainerSize()
    resizeObserver = new ResizeObserver(updateContainerSize)
    resizeObserver.observe(el)
  }
}, { immediate: true })

onUnmounted(() => {
  resizeObserver?.disconnect()
})

// Compute bounding box that includes all windows AND the current viewport
const bounds = computed(() => {
  const scale = transform.value.scale
  const viewX = -transform.value.x / scale
  const viewY = -transform.value.y / scale
  const viewW = containerSize.value.width / scale
  const viewH = containerSize.value.height / scale

  let minX = viewX
  let minY = viewY
  let maxX = viewX + viewW
  let maxY = viewY + viewH

  for (const w of windows.value) {
    minX = Math.min(minX, w.position.x)
    minY = Math.min(minY, w.position.y)
    maxX = Math.max(maxX, w.position.x + w.position.width)
    maxY = Math.max(maxY, w.position.y + w.position.height)
  }

  // Add some padding
  const rangeX = maxX - minX || 400
  const rangeY = maxY - minY || 300
  const padX = rangeX * 0.15
  const padY = rangeY * 0.15
  return {
    minX: minX - padX,
    minY: minY - padY,
    maxX: maxX + padX,
    maxY: maxY + padY,
  }
})

const worldWidth = computed(() => bounds.value.maxX - bounds.value.minX)
const worldHeight = computed(() => bounds.value.maxY - bounds.value.minY)
const minimapScale = computed(() => {
  const sw = (MINIMAP_W - PADDING * 2) / worldWidth.value
  const sh = (MINIMAP_H - PADDING * 2) / worldHeight.value
  return Math.min(sw, sh)
})

function toMinimapCoords(x: number, y: number) {
  return {
    x: PADDING + (x - bounds.value.minX) * minimapScale.value,
    y: PADDING + (y - bounds.value.minY) * minimapScale.value,
  }
}

// Window rectangles on the minimap
const windowRects = computed(() =>
  windows.value.map((w) => {
    const pos = toMinimapCoords(w.position.x, w.position.y)
    const colors: Record<string, string> = {
      agent: '#a0a0a8',
      terminal: '#22d3ee',
      diff: '#2ed573',
      spec: '#3b82f6',
    }
    return {
      id: w.id,
      x: pos.x,
      y: pos.y,
      width: w.position.width * minimapScale.value,
      height: w.position.height * minimapScale.value,
      color: colors[w.type] ?? '#57606f',
    }
  })
)

// Viewport rectangle
const viewportRect = computed(() => {
  const scale = transform.value.scale
  const cw = containerSize.value.width
  const ch = containerSize.value.height

  // The visible area in world coordinates
  const viewX = -transform.value.x / scale
  const viewY = -transform.value.y / scale
  const viewW = cw / scale
  const viewH = ch / scale

  const pos = toMinimapCoords(viewX, viewY)
  return {
    x: pos.x,
    y: pos.y,
    width: viewW * minimapScale.value,
    height: viewH * minimapScale.value,
  }
})

function onMinimapClick(e: MouseEvent) {
  if (!workspaceId.value || !minimapRef.value) return

  const rect = minimapRef.value.getBoundingClientRect()
  const clickX = e.clientX - rect.left
  const clickY = e.clientY - rect.top

  // Convert minimap coords to world coords
  const worldX = (clickX - PADDING) / minimapScale.value + bounds.value.minX
  const worldY = (clickY - PADDING) / minimapScale.value + bounds.value.minY

  // Center the viewport on this point
  const cw = containerSize.value.width
  const ch = containerSize.value.height
  const scale = transform.value.scale

  canvasStore.updateTransform(workspaceId.value, {
    x: -worldX * scale + cw / 2,
    y: -worldY * scale + ch / 2,
  })
}
</script>

<template>
  <div class="absolute bottom-3 z-10 transition-[right] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]" :style="{ right: appStore.editorVisible ? (rightSidebarWidth + 12) + 'px' : '12px' }">
    <!-- Toggle button -->
    <button
      v-if="!visible"
      class="rounded px-2 py-1 text-[10px] transition-colors"
      :style="{ background: 'var(--qc-bg-header)', border: '1px solid var(--qc-border)', color: 'var(--qc-text-muted)' }"
      @click="visible = true"
    >
      Map
    </button>

    <!-- Minimap -->
    <div
      v-if="visible"
      ref="minimapRef"
      class="rounded-lg overflow-hidden cursor-pointer relative"
      :style="{ width: MINIMAP_W + 'px', height: MINIMAP_H + 'px', background: 'color-mix(in srgb, var(--qc-bg-titlebar) 90%, transparent)', border: '1px solid var(--qc-border)' }"
      @click="onMinimapClick"
    >
      <!-- Close button -->
      <button
        class="absolute top-1 right-1 z-10 w-4 h-4 flex items-center justify-center text-[8px] transition-colors"
        :style="{ color: 'var(--qc-text-muted)' }"
        @click.stop="visible = false"
      >
        &#10005;
      </button>

      <!-- Window rectangles -->
      <div
        v-for="wr in windowRects"
        :key="wr.id"
        class="absolute rounded-sm opacity-70"
        :style="{
          left: wr.x + 'px',
          top: wr.y + 'px',
          width: Math.max(4, wr.width) + 'px',
          height: Math.max(3, wr.height) + 'px',
          backgroundColor: wr.color,
        }"
      />

      <!-- Viewport rectangle -->
      <div
        class="absolute border border-white/30 rounded-sm pointer-events-none"
        :style="{
          left: viewportRect.x + 'px',
          top: viewportRect.y + 'px',
          width: viewportRect.width + 'px',
          height: viewportRect.height + 'px',
        }"
      />
    </div>
  </div>
</template>
