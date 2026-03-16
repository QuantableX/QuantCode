<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { Webview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import { pictureDir, join } from '@tauri-apps/api/path'
import { useWorkspacesStore } from '../../../stores/workspaces'
import { useCanvasStore } from '../../../stores/canvas'
import { useAppStore } from '../../../stores/app'
import type { CanvasWindow as CanvasWindowType, WindowStatus } from '../../../shared/types'

const props = defineProps<{
  window: CanvasWindowType
}>()

const workspacesStore = useWorkspacesStore()
const canvasStore = useCanvasStore()
const appStore = useAppStore()

const GRID_SIZE = 20

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

const workspaceId = computed(() => workspacesStore.activeWorkspaceId!)

// Drag state
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const dragPositionStart = ref({ x: 0, y: 0 })

// Resize state
const isResizing = ref(false)
const resizeHandle = ref('')
const resizeStart = ref({ x: 0, y: 0 })
const resizeDimStart = ref({ x: 0, y: 0, width: 0, height: 0 })

const MIN_WIDTH = 300
const MIN_HEIGHT = 200

const windowStyle = computed(() => ({
  position: 'absolute' as const,
  left: `${props.window.position.x}px`,
  top: `${props.window.position.y}px`,
  width: `${props.window.position.width}px`,
  height: props.window.minimized ? 'auto' : `${props.window.position.height}px`,
  zIndex: props.window.zIndex,
  background: 'var(--qc-bg-window)',
  border: '1px solid var(--qc-border)',
}))

const statusColor = computed(() => {
  const colors: Record<WindowStatus, string> = {
    idle: '#57606f',
    thinking: '#ffa502',
    live: '#2ed573',
    error: '#ff4757',
    minimized: '#57606f',
  }
  return colors[props.window.status]
})

const typeIcon = computed(() => {
  const icons: Record<string, string> = {
    agent: '\u25C7',
    terminal: '\u2588',
    diff: '\u00B1',
    spec: '\u25A3',
    file: '\u25A0',
    browser: '\u260D',
  }
  return icons[props.window.type] ?? '\u25C7'
})

function bringToFront() {
  canvasStore.bringToFront(workspaceId.value, props.window.id)
}

// ---- Drag handling ----
function startDrag(e: MouseEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()

  bringToFront()
  isDragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY }
  dragPositionStart.value = { x: props.window.position.x, y: props.window.position.y }

  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent) {
  if (!isDragging.value) return

  const canvasState = canvasStore.activeCanvasState
  const scale = canvasState?.transform.scale ?? 1

  const dx = (e.clientX - dragStart.value.x) / scale
  const dy = (e.clientY - dragStart.value.y) / scale

  canvasStore.updateWindowPosition(workspaceId.value, props.window.id, {
    x: dragPositionStart.value.x + dx,
    y: dragPositionStart.value.y + dy,
  })
}

function onDragEnd() {
  isDragging.value = false
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)

  // Snap to grid if enabled
  if (appStore.snapToGrid) {
    canvasStore.updateWindowPosition(workspaceId.value, props.window.id, {
      x: snapToGrid(props.window.position.x),
      y: snapToGrid(props.window.position.y),
    })
  }

  canvasStore.saveCanvasState(workspaceId.value)
}

// ---- Resize handling ----
function startResize(handle: string, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()

  bringToFront()
  isResizing.value = true
  resizeHandle.value = handle
  resizeStart.value = { x: e.clientX, y: e.clientY }
  resizeDimStart.value = {
    x: props.window.position.x,
    y: props.window.position.y,
    width: props.window.position.width,
    height: props.window.position.height,
  }

  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  if (!isResizing.value) return

  const canvasState = canvasStore.activeCanvasState
  const scale = canvasState?.transform.scale ?? 1

  const dx = (e.clientX - resizeStart.value.x) / scale
  const dy = (e.clientY - resizeStart.value.y) / scale
  const h = resizeHandle.value

  let newX = resizeDimStart.value.x
  let newY = resizeDimStart.value.y
  let newW = resizeDimStart.value.width
  let newH = resizeDimStart.value.height

  if (h.includes('e')) newW = Math.max(MIN_WIDTH, resizeDimStart.value.width + dx)
  if (h.includes('s')) newH = Math.max(MIN_HEIGHT, resizeDimStart.value.height + dy)
  if (h.includes('w')) {
    const proposedW = resizeDimStart.value.width - dx
    if (proposedW >= MIN_WIDTH) {
      newW = proposedW
      newX = resizeDimStart.value.x + dx
    }
  }
  if (h.includes('n')) {
    const proposedH = resizeDimStart.value.height - dy
    if (proposedH >= MIN_HEIGHT) {
      newH = proposedH
      newY = resizeDimStart.value.y + dy
    }
  }

  canvasStore.updateWindowPosition(workspaceId.value, props.window.id, {
    x: newX,
    y: newY,
    width: newW,
    height: newH,
  })
}

function onResizeEnd() {
  isResizing.value = false
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)

  // Snap to grid if enabled
  if (appStore.snapToGrid) {
    canvasStore.updateWindowPosition(workspaceId.value, props.window.id, {
      x: snapToGrid(props.window.position.x),
      y: snapToGrid(props.window.position.y),
      width: snapToGrid(props.window.position.width),
      height: snapToGrid(props.window.position.height),
    })
  }

  canvasStore.saveCanvasState(workspaceId.value)
}

function toggleMinimize() {
  canvasStore.updateWindow(workspaceId.value, props.window.id, {
    minimized: !props.window.minimized,
  })
}

async function closeWindow() {
  // Kill the terminal process when user explicitly closes the window
  if (props.window.type === 'terminal' && props.window.terminalId) {
    try {
      await invoke('close_terminal', { id: props.window.terminalId })
    } catch {
      // Terminal may have already exited
    }
  }
  // Destroy all tab webviews when user explicitly closes the browser window
  if (props.window.type === 'browser') {
    const sanitizedId = props.window.id.replace(/[^a-zA-Z0-9_-]/g, '_')
    const tabs = props.window.browserConfig?.tabs ?? []
    for (const tab of tabs) {
      const tabLabel = `browser-${sanitizedId}-${tab.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
      try {
        const wv = await Webview.getByLabel(tabLabel)
        if (wv) await wv.close()
      } catch { /* ignore */ }
    }
    // Legacy single-webview label fallback
    const legacyLabel = `browser-${sanitizedId}`
    try {
      const wv = await Webview.getByLabel(legacyLabel)
      if (wv) await wv.close()
    } catch { /* ignore */ }
  }
  canvasStore.removeWindow(workspaceId.value, props.window.id)
}

async function attachFile() {
  if (props.window.type !== 'terminal' || !props.window.terminalId) return

  try {
    // Default to Screenshots folder on Windows
    let defaultPath: string | undefined
    try {
      const pictures = await pictureDir()
      defaultPath = await join(pictures, 'Screenshots')
    } catch {
      // Fall back to no default path
    }

    const selected = await open({
      defaultPath,
      multiple: false,
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (selected) {
      // Paste the file path (quoted for spaces) into the terminal
      await invoke('write_terminal', {
        id: props.window.terminalId,
        data: `"${selected}" `,
      })
    }
  } catch {
    // Dialog cancelled or error
  }
}

function onWindowClick() {
  bringToFront()
}
</script>

<template>
  <div
    :data-window-id="window.id"
    :style="windowStyle"
    class="rounded-lg shadow-2xl flex flex-col overflow-hidden group"
    @mousedown="onWindowClick"
    @contextmenu.stop
  >
    <!-- Header -->
    <div
      class="h-8 flex items-center px-3 gap-2 flex-shrink-0 cursor-move select-none"
      :style="{ background: 'var(--qc-bg-header)', borderBottom: '1px solid var(--qc-border)' }"
      @mousedown="startDrag"
    >
      <!-- Icon + Title -->
      <span class="text-xs text-[#a0a0a8]">{{ typeIcon }}</span>
      <span class="text-xs font-medium truncate flex-1" :style="{ color: 'var(--qc-text)' }">{{ window.title }}</span>

      <!-- Attach file (terminal only) -->
      <button
        v-if="window.type === 'terminal'"
        class="w-5 h-5 flex items-center justify-center transition-colors rounded"
        :style="{ color: 'var(--qc-text-muted)' }"
        @mousedown.stop
        @click.stop="attachFile"
        title="Attach file"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>

      <!-- Status badge -->
      <span
        class="w-2 h-2 rounded-full flex-shrink-0"
        :style="{ backgroundColor: statusColor }"
        :title="window.status"
      />

      <!-- Minimize -->
      <button
        class="w-5 h-5 flex items-center justify-center transition-colors rounded text-xs"
        :style="{ color: 'var(--qc-text-muted)' }"
        @mousedown.stop
        @click.stop="toggleMinimize"
        title="Minimize"
      >
        &#8722;
      </button>

      <!-- Close -->
      <button
        class="w-5 h-5 flex items-center justify-center text-red-400/60 hover:text-red-400 transition-colors rounded text-xs"
        @mousedown.stop
        @click.stop="closeWindow"
        title="Close"
      >
        &#10005;
      </button>
    </div>

    <!-- Body -->
    <div
      v-if="!window.minimized"
      class="flex-1 min-h-0 overflow-hidden canvas-window-body"
    >
      <WindowsAgentWindow
        v-if="window.type === 'agent'"
        :window="window"
      />
      <WindowsTerminalWindow
        v-else-if="window.type === 'terminal'"
        :window="window"
      />
      <WindowsDiffWindow
        v-else-if="window.type === 'diff'"
        :window="window"
      />
      <WindowsSpecWindow
        v-else-if="window.type === 'spec'"
        :window="window"
      />
      <WindowsFileWindow
        v-else-if="window.type === 'file'"
        :window="window"
      />
      <WindowsBrowserWindow
        v-else-if="window.type === 'browser'"
        :window="window"
      />
    </div>

    <!-- Resize handles (hidden when minimized) -->
    <template v-if="!window.minimized">
      <!-- Edge handles -->
      <div class="absolute -top-1 left-3 right-3 h-2.5 cursor-n-resize" @mousedown="startResize('n', $event)" />
      <div class="absolute -bottom-1 left-3 right-3 h-2.5 cursor-s-resize" @mousedown="startResize('s', $event)" />
      <div class="absolute -left-1 top-3 bottom-3 w-2.5 cursor-w-resize" @mousedown="startResize('w', $event)" />
      <div class="absolute -right-1 top-3 bottom-3 w-2.5 cursor-e-resize" @mousedown="startResize('e', $event)" />
      <!-- Corner handles -->
      <div class="absolute -top-1 -left-1 w-5 h-5 cursor-nw-resize" @mousedown="startResize('nw', $event)" />
      <div class="absolute -top-1 -right-1 w-5 h-5 cursor-ne-resize" @mousedown="startResize('ne', $event)" />
      <div class="absolute -bottom-1 -left-1 w-5 h-5 cursor-sw-resize" @mousedown="startResize('sw', $event)" />
      <div class="absolute -bottom-1 -right-1 w-5 h-5 cursor-se-resize" @mousedown="startResize('se', $event)" />
    </template>
  </div>
</template>
