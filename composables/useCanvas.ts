import { computed, ref } from 'vue'
import { useCanvasStore } from '../stores/canvas'
import { useWorkspacesStore } from '../stores/workspaces'

export function useCanvas() {
  const canvasStore = useCanvasStore()
  const workspacesStore = useWorkspacesStore()

  const isDragging = ref(false)
  const isPanning = ref(false)

  // Track the last mouse/pointer position during pan
  const panStartX = ref(0)
  const panStartY = ref(0)

  const MIN_SCALE = 0.1
  const MAX_SCALE = 3.0

  // ---- Computed State ----

  const transform = computed(() => {
    const state = canvasStore.activeCanvasState
    return state?.transform ?? { x: 0, y: 0, scale: 1 }
  })

  const canvasStyle = computed(() => {
    const t = transform.value
    return `translate(${t.x}px, ${t.y}px) scale(${t.scale})`
  })

  // ---- Pan Methods ----

  function startPan(event: MouseEvent | PointerEvent): void {
    // Middle mouse button (button 1) or handle two-finger via pointer events
    if (event.button !== 1 && event.button !== 0) return
    // Only start pan on middle click, or let caller decide (e.g., when space is held)
    if (event.button === 0 && !isPanning.value) return

    isPanning.value = true
    panStartX.value = event.clientX
    panStartY.value = event.clientY
  }

  function startPanForce(event: MouseEvent | PointerEvent): void {
    // Force-start pan regardless of button (for space+drag or two-finger gestures)
    isPanning.value = true
    panStartX.value = event.clientX
    panStartY.value = event.clientY
  }

  function onPan(event: MouseEvent | PointerEvent): void {
    if (!isPanning.value) return

    const workspaceId = workspacesStore.activeWorkspaceId
    if (!workspaceId) return

    const dx = event.clientX - panStartX.value
    const dy = event.clientY - panStartY.value

    panStartX.value = event.clientX
    panStartY.value = event.clientY

    const current = transform.value
    canvasStore.updateTransform(workspaceId, {
      x: current.x + dx,
      y: current.y + dy,
    })
  }

  function endPan(): void {
    isPanning.value = false
  }

  // ---- Zoom ----

  function zoom(delta: number, centerX: number, centerY: number): void {
    const workspaceId = workspacesStore.activeWorkspaceId
    if (!workspaceId) return

    const current = transform.value
    // Snap to 5% intervals
    const currentPercent = Math.round(current.scale * 100)
    const newPercent = delta > 0 ? currentPercent - 5 : currentPercent + 5
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newPercent / 100))

    // Zoom toward the cursor point
    // The math: to keep the point under the cursor fixed, adjust x/y
    const scaleRatio = newScale / current.scale
    const newX = centerX - (centerX - current.x) * scaleRatio
    const newY = centerY - (centerY - current.y) * scaleRatio

    canvasStore.updateTransform(workspaceId, {
      x: newX,
      y: newY,
      scale: newScale,
    })
  }

  // ---- Reset ----

  function resetView(): void {
    const workspaceId = workspacesStore.activeWorkspaceId
    if (!workspaceId) return

    canvasStore.updateTransform(workspaceId, {
      x: 0,
      y: 0,
      scale: 1,
    })
  }

  // ---- Coordinate Conversion ----

  function canvasToScreen(x: number, y: number): { x: number; y: number } {
    const t = transform.value
    return {
      x: x * t.scale + t.x,
      y: y * t.scale + t.y,
    }
  }

  function screenToCanvas(x: number, y: number): { x: number; y: number } {
    const t = transform.value
    return {
      x: (x - t.x) / t.scale,
      y: (y - t.y) / t.scale,
    }
  }

  return {
    // State
    transform,
    isDragging,
    isPanning,
    canvasStyle,
    // Pan
    startPan,
    startPanForce,
    onPan,
    endPan,
    // Zoom
    zoom,
    // Reset
    resetView,
    // Coordinate conversion
    canvasToScreen,
    screenToCanvas,
  }
}
