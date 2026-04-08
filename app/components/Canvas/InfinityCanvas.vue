<script setup lang="ts">
import { useWorkspacesStore } from '../../../stores/workspaces'
import { useCanvasStore } from '../../../stores/canvas'
import { useAppStore } from '../../../stores/app'
import { v4 as uuidv4 } from 'uuid'
import type { CanvasWindow as CanvasWindowType, WindowType, FilePreviewKind } from '../../../shared/types'
import { useEventListener } from '@vueuse/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'

const workspacesStore = useWorkspacesStore()
const canvasStore = useCanvasStore()
const appStore = useAppStore()

const canvasRef = ref<HTMLElement | null>(null)

// Share canvas element with child components (e.g. Minimap)
provide('canvasRef', canvasRef)

// Share context menu visibility so browser webviews can hide when menu is open
const contextMenuVisible = computed(() => contextMenu.value.visible)
provide('contextMenuVisible', contextMenuVisible)

// Clipboard for window copy/paste
const copiedWindow = ref<CanvasWindowType | null>(null)
provide('copiedWindow', copiedWindow)

// Pan/zoom state
const isPanning = ref(false)
const isSpacePanning = ref(false)
const spaceHeld = ref(false)
const panStart = ref({ x: 0, y: 0 })
const transformStart = ref({ x: 0, y: 0 })

// Context menu
const contextMenu = ref({ visible: false, x: 0, y: 0 })

const canvasState = computed(() => canvasStore.activeCanvasState)
const transform = computed(() => canvasState.value?.transform ?? { x: 0, y: 0, scale: 1 })
const windows = computed(() => canvasState.value?.windows ?? [])
const workspaceId = computed(() => workspacesStore.activeWorkspaceId)
const zoomPercent = computed(() => Math.round(transform.value.scale * 100))
const tileCount = computed(() => windows.value.length)

const canvasTransformStyle = computed(() => {
  const { x, y, scale } = transform.value
  return `translate(${x}px, ${y}px) scale(${scale})`
})

const dotGridStyle = computed(() => {
  const scale = transform.value.scale
  const size = 20 * scale
  const majorSize = size * 5
  const ox = transform.value.x % size
  const oy = transform.value.y % size
  const majorOx = transform.value.x % majorSize
  const majorOy = transform.value.y % majorSize
  return {
    background: 'var(--qc-bg)',
    backgroundImage: `radial-gradient(circle, var(--qc-dot-grid-bright) 2px, transparent 2px), radial-gradient(circle, var(--qc-dot-grid) 1.5px, transparent 1.5px)`,
    backgroundSize: `${majorSize}px ${majorSize}px, ${size}px ${size}px`,
    backgroundPosition: `${majorOx}px ${majorOy}px, ${ox}px ${oy}px`,
  }
})

// ---- Panning ----
function onMouseDown(e: MouseEvent) {
  // Middle mouse button or space+left click for panning
  if (e.button === 1 || (spaceHeld.value && e.button === 0)) {
    e.preventDefault()
    isPanning.value = true
    if (spaceHeld.value) isSpacePanning.value = true
    panStart.value = { x: e.clientX, y: e.clientY }
    transformStart.value = { x: transform.value.x, y: transform.value.y }
  }
}

function onMouseMove(e: MouseEvent) {
  if (!isPanning.value || !workspaceId.value) return

  const dx = e.clientX - panStart.value.x
  const dy = e.clientY - panStart.value.y

  canvasStore.updateTransform(workspaceId.value, {
    x: transformStart.value.x + dx,
    y: transformStart.value.y + dy,
  })
}

const GRID_SIZE = 20

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

function onMouseUp() {
  if (isPanning.value && appStore.snapCameraToGrid && workspaceId.value) {
    canvasStore.updateTransform(workspaceId.value, {
      x: snapToGrid(transform.value.x),
      y: snapToGrid(transform.value.y),
    })
  }
  isPanning.value = false
  isSpacePanning.value = false
}

// ---- Zooming ----
function doZoom(e: WheelEvent) {
  if (!workspaceId.value) return

  const currentScale = transform.value.scale
  // Snap to 5% intervals
  const currentPercent = Math.round(currentScale * 100)
  const newPercent = e.deltaY > 0 ? currentPercent - 5 : currentPercent + 5
  const newScale = Math.min(Math.max(newPercent / 100, 0.1), 5)

  // Zoom toward cursor position
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return

  const cursorX = e.clientX - rect.left
  const cursorY = e.clientY - rect.top

  const scaleChange = newScale / currentScale
  const newX = cursorX - (cursorX - transform.value.x) * scaleChange
  const newY = cursorY - (cursorY - transform.value.y) * scaleChange

  canvasStore.updateTransform(workspaceId.value, {
    x: newX,
    y: newY,
    scale: newScale,
  })
}

function onWheel(e: WheelEvent) {
  if (!workspaceId.value) return

  // Ctrl+wheel is handled by the document-level capture listener below
  if (e.ctrlKey) return

  const target = e.target as HTMLElement
  const overWindow = target.closest('.canvas-window-body')
  if (overWindow) return

  e.preventDefault()
  doZoom(e)
}

// Document-level capture listener intercepts Ctrl+wheel before WebView2 native zoom
// or Monaco editors can consume it
useEventListener(document, 'wheel', (e: WheelEvent) => {
  if (!e.ctrlKey || !workspaceId.value) return
  e.preventDefault()
  e.stopPropagation()
  doZoom(e)
}, { capture: true, passive: false })

// ---- Ctrl+V to paste copied window ----
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.ctrlKey && e.key === 'v' && !e.shiftKey && !e.altKey) {
    // Only paste window when focus is on canvas or a window header, not inside terminals/inputs
    const target = e.target as HTMLElement
    if (target.closest('.xterm') || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
    if (!copiedWindow.value) return
    e.preventDefault()
    pasteWindow()
  }
})

// ---- Space key for panning ----
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
    spaceHeld.value = true
  }
})

useEventListener(window, 'keyup', (e: KeyboardEvent) => {
  if (e.code === 'Space') {
    spaceHeld.value = false
    if (isSpacePanning.value) {
      isPanning.value = false
      isSpacePanning.value = false
    }
  }
})

// ---- Context menu ----
function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY }
}

function closeContextMenu() {
  contextMenu.value.visible = false
}

function createWindow(type: WindowType) {
  if (!workspaceId.value) return

  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return

  // Convert screen position to canvas coordinates
  const scale = transform.value.scale
  const canvasX = (contextMenu.value.x - rect.left - transform.value.x) / scale
  const canvasY = (contextMenu.value.y - rect.top - transform.value.y) / scale

  const titles: Record<WindowType, string> = {
    agent: 'Agent',
    terminal: 'Terminal',
    diff: 'Diff Viewer',
    spec: 'Spec Dashboard',
    file: 'File',
    browser: 'Browser',
  }

  const sizes: Record<WindowType, { width: number; height: number }> = {
    agent: { width: 480, height: 500 },
    terminal: { width: 600, height: 400 },
    diff: { width: 700, height: 500 },
    spec: { width: 500, height: 450 },
    file: { width: 500, height: 400 },
    browser: { width: 700, height: 500 },
  }

  const win: CanvasWindowType = {
    id: uuidv4(),
    type,
    title: titles[type],
    position: {
      x: canvasX,
      y: canvasY,
      ...sizes[type],
    },
    status: 'idle',
    minimized: false,
    zIndex: 0,
    ...(type === 'agent'
      ? {
          agentConfig: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            role: 'general',
          },
        }
      : {}),
    ...(type === 'terminal' ? { terminalId: uuidv4() } : {}),
    ...(type === 'browser' ? { browserConfig: { url: 'http://localhost:3000' } } : {}),
  }

  canvasStore.addWindow(workspaceId.value, win)
  closeContextMenu()
}

// ---- Open file via system dialog ----

async function openFileOnCanvas() {
  const menuX = contextMenu.value.x
  const menuY = contextMenu.value.y
  closeContextMenu()

  try {
    const selected = await openDialog({
      multiple: false,
      directory: false,
    })
    if (selected) {
      createFileWindow(selected as string, menuX, menuY)
    }
  } catch {
    // User cancelled or dialog error
  }
}

// ---- File preview helpers ----

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'])
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'vue', 'rs', 'py', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
  'css', 'scss', 'less', 'html', 'xml', 'json', 'yaml', 'yml', 'toml', 'sql', 'graphql',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'rb', 'php', 'swift', 'kt', 'lua', 'r', 'dart',
  'zig', 'nim', 'ex', 'exs', 'erl', 'hrl', 'clj', 'scala', 'tf', 'hcl',
  'pine',
])

function detectPreviewKind(filePath: string): FilePreviewKind {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'md' || ext === 'mdx') return 'markdown'
  if (CODE_EXTS.has(ext)) return 'code'
  // Try text for common config/dotfiles
  if (['txt', 'log', 'env', 'gitignore', 'editorconfig', 'prettierrc', 'eslintrc'].includes(ext)) return 'text'
  // Files without extension or unknown — try text
  if (!ext || ext === filePath) return 'text'
  return 'binary'
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
    vue: 'vue', html: 'html', css: 'css', scss: 'scss', json: 'json', md: 'markdown',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', rs: 'rust', py: 'python', go: 'go',
    sh: 'shell', sql: 'sql', xml: 'xml', svg: 'xml', pine: 'javascript',
  }
  return map[ext] ?? 'plaintext'
}

function createFileWindow(filePath: string, screenX: number, screenY: number) {
  if (!workspaceId.value) return

  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return

  const scale = transform.value.scale
  const canvasX = (screenX - rect.left - transform.value.x) / scale
  const canvasY = (screenY - rect.top - transform.value.y) / scale

  const fileName = filePath.split(/[/\\]/).pop() ?? filePath
  const previewKind = detectPreviewKind(filePath)

  const isImage = previewKind === 'image'

  const win: CanvasWindowType = {
    id: uuidv4(),
    type: 'file',
    title: fileName,
    position: {
      x: canvasX,
      y: canvasY,
      width: isImage ? 450 : 500,
      height: isImage ? 350 : 400,
    },
    status: 'idle',
    minimized: false,
    zIndex: 0,
    fileConfig: {
      filePath,
      previewKind,
      language: detectLanguage(filePath),
    },
  }

  canvasStore.addWindow(workspaceId.value, win)
}

// ---- Drag & drop from file explorer ----

const isDragOver = ref(false)

function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('application/x-quantcode-file')) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    isDragOver.value = true
  }
}

function onDragLeave() {
  isDragOver.value = false
}

function onDrop(e: DragEvent) {
  isDragOver.value = false
  if (!e.dataTransfer) return

  const filePath = e.dataTransfer.getData('application/x-quantcode-file')
  if (filePath) {
    e.preventDefault()
    createFileWindow(filePath, e.clientX, e.clientY)
  }
}

// Listen for "Open on Canvas" events from the file explorer
useEventListener(window, 'qc-open-file-on-canvas', ((e: CustomEvent) => {
  const filePath = e.detail?.filePath
  if (!filePath) return

  // Place near center of the visible canvas area
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2

  createFileWindow(filePath, centerX, centerY)
}) as EventListener)

// ---- Window copy/paste ----
function pasteWindow() {
  if (!copiedWindow.value || !workspaceId.value) return

  const source = copiedWindow.value

  const win: CanvasWindowType = {
    id: uuidv4(),
    type: source.type,
    title: source.title,
    position: {
      x: source.position.x,
      y: source.position.y,
      width: source.position.width,
      height: source.position.height,
    },
    status: 'idle',
    minimized: false,
    zIndex: 0,
    ...(source.type === 'agent' && source.agentConfig
      ? { agentConfig: { ...source.agentConfig } }
      : {}),
    ...(source.type === 'terminal' ? { terminalId: uuidv4() } : {}),
    ...(source.type === 'file' && source.fileConfig
      ? { fileConfig: { ...source.fileConfig } }
      : {}),
    ...(source.type === 'browser' && source.browserConfig
      ? { browserConfig: { ...source.browserConfig } }
      : {}),
  }

  canvasStore.addWindow(workspaceId.value, win)
}

provide('pasteWindow', pasteWindow)

useEventListener(window, 'click', () => {
  if (contextMenu.value.visible) closeContextMenu()
})
</script>

<template>
  <div
    ref="canvasRef"
    class="w-full h-full relative overflow-hidden"
    :class="{ 'cursor-grab': spaceHeld && !isPanning, 'cursor-grabbing': isPanning }"
    :style="dotGridStyle"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @mouseleave="onMouseUp"
    @wheel="onWheel"
    @contextmenu="onContextMenu"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Drag-drop overlay -->
    <div
      v-if="isDragOver"
      class="absolute inset-0 z-30 pointer-events-none flex items-center justify-center"
      :style="{ background: 'rgba(59, 130, 246, 0.08)', border: '2px dashed rgba(59, 130, 246, 0.4)' }"
    >
      <span class="text-blue-400 text-xs font-medium px-3 py-1.5 rounded" :style="{ background: 'var(--qc-bg-header)' }">
        Drop file to open on canvas
      </span>
    </div>

    <!-- Zoom / tile count overlay -->
    <div class="absolute top-2 left-1/2 -translate-x-1/2 z-10 text-[10px] pointer-events-none select-none px-2 py-1 rounded" :style="{ color: 'var(--qc-text-dim)', background: 'color-mix(in srgb, var(--qc-bg) 80%, transparent)' }">
      zoom {{ zoomPercent }}% &middot; {{ tileCount }} tiles
    </div>

    <!-- Windows container - transformed -->
    <div
      class="absolute top-0 left-0 origin-top-left"
      :style="{ transform: canvasTransformStyle }"
    >
      <CanvasWindow
        v-for="win in windows"
        :key="win.id"
        :window="win"
      />
    </div>

    <!-- Minimap -->
    <CanvasMinimap />

    <!-- Context menu -->
    <div
      v-if="contextMenu.visible"
      class="fixed z-[9999] rounded-lg shadow-2xl py-1 min-w-[180px]"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px', background: 'var(--qc-bg-header)', border: '1px solid var(--qc-border)' }"
      @click.stop
    >
      <button
        class="w-full text-left px-4 py-2 text-xs transition-colors flex items-center gap-2 hover:brightness-125"
        :style="{ color: 'var(--qc-text)' }"
        @click="createWindow('agent')"
      >
        <span class="text-[#f97316]">&#9671;</span> New Agent Window
      </button>
      <button
        class="w-full text-left px-4 py-2 text-xs transition-colors flex items-center gap-2 hover:brightness-125"
        :style="{ color: 'var(--qc-text)' }"
        @click="createWindow('terminal')"
      >
        <span class="text-[#22d3ee]">&#9645;</span> New Terminal
      </button>
      <button
        class="w-full text-left px-4 py-2 text-xs transition-colors flex items-center gap-2 hover:brightness-125"
        :style="{ color: 'var(--qc-text)' }"
        @click="createWindow('diff')"
      >
        <span class="text-green-400">&#177;</span> New Diff Viewer
      </button>
      <button
        class="w-full text-left px-4 py-2 text-xs transition-colors flex items-center gap-2 hover:brightness-125"
        :style="{ color: 'var(--qc-text)' }"
        @click="createWindow('spec')"
      >
        <span class="text-blue-400">&#9635;</span> New Spec Dashboard
      </button>
      <button
        class="w-full text-left px-4 py-2 text-xs transition-colors flex items-center gap-2 hover:brightness-125"
        :style="{ color: 'var(--qc-text)' }"
        @click="createWindow('browser')"
      >
        <span class="text-sky-400">&#9741;</span> New Browser
      </button>
      <div :style="{ borderTop: '1px solid var(--qc-border)', margin: '4px 0' }" />
      <button
        class="w-full text-left px-4 py-2 text-xs transition-colors flex items-center gap-2 hover:brightness-125"
        :style="{ color: 'var(--qc-text)' }"
        @click="openFileOnCanvas"
      >
        <span class="text-purple-400">&#128196;</span> Open File on Canvas...
      </button>
      <template v-if="copiedWindow">
        <div :style="{ borderTop: '1px solid var(--qc-border)', margin: '4px 0' }" />
        <button
          class="w-full text-left px-4 py-2 text-xs transition-colors flex items-center gap-2 hover:brightness-125"
          :style="{ color: 'var(--qc-text)' }"
          @click="pasteWindow(); closeContextMenu()"
        >
          <span class="text-emerald-400">&#9112;</span> Paste Window
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
</style>
