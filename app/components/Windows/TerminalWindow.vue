<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useWorkspacesStore } from '../../../stores/workspaces'
import { useCanvasStore } from '../../../stores/canvas'
import { useAppStore, SHELL_OPTIONS } from '../../../stores/app'
import type { CanvasWindow } from '../../../shared/types'

const props = defineProps<{
  window: CanvasWindow
}>()

const workspacesStore = useWorkspacesStore()
const canvasStore = useCanvasStore()
const appStore = useAppStore()
const terminalContainer = ref<HTMLElement | null>(null)
const workspaceId = computed(() => workspacesStore.activeWorkspaceId!)

let terminalInstance: any = null
let fitAddonInstance: any = null
let unlistenOutput: (() => void) | null = null

const terminalIdRef = ref<string | null>(null)

// Update window status to TTY
onMounted(async () => {
  canvasStore.updateWindow(workspaceId.value, props.window.id, { status: 'live' })

  if (!terminalContainer.value) return

  try {
    // Dynamically import xterm to avoid SSR issues
    const { Terminal } = await import('@xterm/xterm')
    const { FitAddon } = await import('@xterm/addon-fit')
    const { Unicode11Addon } = await import('@xterm/addon-unicode11')

    // Import xterm CSS
    await import('@xterm/xterm/css/xterm.css')

    const fitAddon = new FitAddon()
    const unicode11Addon = new Unicode11Addon()
    fitAddonInstance = fitAddon

    const darkTheme = {
      background: '#18181e',
      foreground: '#d4d4d8',
      cursor: '#f97316',
      cursorAccent: '#18181e',
      selectionBackground: '#f9731640',
      selectionForeground: '#d4d4d8',
      black: '#18181e',
      red: '#ef4444',
      green: '#22c55e',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#a855f7',
      cyan: '#22d3ee',
      white: '#e4e4e7',
      brightBlack: '#71717a',
      brightRed: '#f87171',
      brightGreen: '#4ade80',
      brightYellow: '#fbbf24',
      brightBlue: '#60a5fa',
      brightMagenta: '#c084fc',
      brightCyan: '#67e8f9',
      brightWhite: '#ffffff',
    }

    const lightTheme = {
      background: '#d8d8de',
      foreground: '#24242c',
      cursor: '#f97316',
      cursorAccent: '#d8d8de',
      selectionBackground: '#f9731640',
      selectionForeground: '#24242c',
      black: '#24242c',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#d97706',
      blue: '#2563eb',
      magenta: '#9333ea',
      cyan: '#0891b2',
      white: '#d8d8de',
      brightBlack: '#585864',
      brightRed: '#ef4444',
      brightGreen: '#22c55e',
      brightYellow: '#f59e0b',
      brightBlue: '#3b82f6',
      brightMagenta: '#a855f7',
      brightCyan: '#22d3ee',
      brightWhite: '#f4f4f5',
    }

    const term = new Terminal({
      theme: appStore.theme === 'light' ? lightTheme : darkTheme,
      fontFamily: '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", "Fira Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.0,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
    })

    term.loadAddon(fitAddon)
    term.loadAddon(unicode11Addon)
    term.unicode.activeVersion = '11'
    term.open(terminalContainer.value)

    // Use WebGL renderer for better Unicode glyph rendering
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl')
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
      term.loadAddon(webglAddon)
    } catch {
      // WebGL not available, fall back to canvas renderer
    }

    // Small delay to ensure container is measured, then fit
    setTimeout(() => {
      try {
        fitAddon.fit()
      } catch {
        // ignore fit errors during setup
      }
    }, 100)

    terminalInstance = term

    // Update terminal theme when app theme changes
    watch(() => appStore.theme, (newTheme) => {
      term.options.theme = newTheme === 'light' ? lightTheme : darkTheme
    })

    // Shift+Enter → send newline via bracketed paste so CLI agents
    // (Claude Code, Codex, etc.) insert a new line instead of submitting
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey) {
        if (terminalIdRef.value) {
          invoke('write_terminal', {
            id: terminalIdRef.value,
            data: '\x1b[200~\n\x1b[201~',
          }).catch(() => {})
        }
        return false
      }

      // Ctrl+C → copy selection to clipboard, or send SIGINT if nothing selected
      if (event.type === 'keydown' && event.key === 'c' && event.ctrlKey && !event.shiftKey && !event.altKey) {
        const selection = term.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {})
          term.clearSelection()
        } else if (terminalIdRef.value) {
          invoke('write_terminal', { id: terminalIdRef.value, data: '\x03' }).catch(() => {})
        }
        return false
      }

      // Ctrl+V → paste from clipboard into terminal
      if (event.type === 'keydown' && event.key === 'v' && event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        navigator.clipboard.readText().then((text) => {
          if (text && terminalIdRef.value) {
            invoke('write_terminal', { id: terminalIdRef.value, data: text }).catch(() => {})
          }
        }).catch(() => {})
        return false
      }

      return true
    })

    // Send user input to Tauri PTY
    term.onData((data: string) => {
      if (!terminalIdRef.value) return
      try {
        invoke('write_terminal', { id: terminalIdRef.value, data })
      } catch {
        // Terminal backend not available
      }
    })

    // Try to reconnect to an existing terminal, or spawn a new one
    const existingId = props.window.terminalId
    let connected = false

    if (existingId) {
      try {
        const alive = await invoke<boolean>('check_terminal_alive', { id: existingId })
        if (alive) {
          terminalIdRef.value = existingId
          // Reconnect — get buffered output and resume event streaming
          const buffered = await invoke<string>('reconnect_terminal', { id: existingId })
          if (buffered) {
            term.write(buffered)
          }
          connected = true
        }
      } catch {
        // Terminal gone, will spawn new below
      }
    }

    if (!connected) {
      try {
        const cwd = workspacesStore.activeWorkspace?.folderPath ?? '.'
        const shellOption = SHELL_OPTIONS.find(s => s.value === appStore.defaultShell)
        const shell = shellOption?.path ?? null
        const newId = await invoke<string>('spawn_terminal', { cwd, shell })
        terminalIdRef.value = newId
        // Persist the terminal ID in the canvas window so it survives workspace switches
        canvasStore.updateWindow(workspaceId.value, props.window.id, { terminalId: newId })
      } catch {
        term.writeln('\x1b[33m[Terminal] Backend not connected. Running in preview mode.\x1b[0m')
        term.writeln('')
      }
    }

    // Listen for terminal output from Tauri
    unlistenOutput = await listen<{ id: string; data: string }>(
      'terminal-output',
      (event) => {
        if (event.payload.id === terminalIdRef.value) {
          term.write(event.payload.data)
        }
      }
    )

    // Resize to fit after reconnect (terminal size may have changed)
    if (connected && terminalIdRef.value) {
      try {
        await invoke('resize_terminal', {
          id: terminalIdRef.value,
          cols: term.cols,
          rows: term.rows,
        })
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.error('Failed to initialize terminal:', err)
  }

  // Watch for window resize
  const observer = new ResizeObserver(() => {
    try {
      fitAddonInstance?.fit()
      if (terminalInstance && terminalIdRef.value) {
        invoke('resize_terminal', {
          id: terminalIdRef.value,
          cols: terminalInstance.cols,
          rows: terminalInstance.rows,
        }).catch(() => {})
      }
    } catch {
      // Ignore resize errors
    }
  })

  if (terminalContainer.value) {
    observer.observe(terminalContainer.value)
  }

  onUnmounted(() => {
    observer.disconnect()
    terminalInstance?.dispose()
    unlistenOutput?.()
    if (terminalIdRef.value) {
      // Disconnect only — the PTY process stays alive so we can reconnect
      // when the user switches back to this workspace. The terminal is only
      // killed when the user explicitly closes the window (X button).
      invoke('disconnect_terminal', { id: terminalIdRef.value }).catch(() => {})
    }
  })
})
</script>

<template>
  <div class="w-full h-full overflow-hidden" :style="{ background: 'var(--qc-bg)', fontSize: '12px', lineHeight: '1' }">
    <div
      ref="terminalContainer"
      class="w-full h-full"
    />
  </div>
</template>

<style scoped>
:deep(.xterm) {
  padding: 4px;
  height: 100%;
}

:deep(.xterm-viewport) {
  overflow-y: auto !important;
}

:deep(.xterm-viewport::-webkit-scrollbar) {
  width: 4px;
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background: #37373f;
  border-radius: 2px;
}
</style>
