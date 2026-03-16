import { reactive, ref, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { TerminalSession } from '../shared/types'
import type { UnlistenFn } from '@tauri-apps/api/event'

export interface TerminalOutputEvent {
  id: string
  data: string
}

type TerminalOutputCallback = (terminalId: string, data: string) => void

export function useTerminal() {
  const sessions = reactive<Map<string, TerminalSession>>(new Map())
  const outputCallbacks = reactive<Map<string, Set<TerminalOutputCallback>>>(new Map())
  const globalUnlisten = ref<UnlistenFn | null>(null)
  const listenerInitialized = ref(false)

  // ---- Event Listener Setup ----

  async function ensureListener(): Promise<void> {
    if (listenerInitialized.value) return
    listenerInitialized.value = true

    try {
      globalUnlisten.value = await listen<TerminalOutputEvent>('terminal-output', (event) => {
        const { id, data } = event.payload
        dispatchOutput(id, data)
      })
    } catch (error) {
      console.error('Failed to set up terminal output listener:', error)
      listenerInitialized.value = false
    }
  }

  function dispatchOutput(terminalId: string, data: string): void {
    const callbacks = outputCallbacks.get(terminalId)
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(terminalId, data)
        } catch (error) {
          console.error('Terminal output callback error:', error)
        }
      }
    }
  }

  // ---- Session Management ----

  async function createTerminal(windowId: string, cwd: string): Promise<TerminalSession> {
    await ensureListener()

    // Spawn terminal process via Tauri - the ID is returned by Rust
    const id = await invoke<string>('spawn_terminal', { cwd })

    const session: TerminalSession = {
      id,
      windowId,
      cwd,
      active: true,
    }

    sessions.set(id, session)
    return session
  }

  async function writeToTerminal(id: string, data: string): Promise<void> {
    const session = sessions.get(id)
    if (!session || !session.active) {
      throw new Error(`Terminal session not found or inactive: ${id}`)
    }

    await invoke('write_terminal', { id, data })
  }

  async function resizeTerminal(id: string, cols: number, rows: number): Promise<void> {
    const session = sessions.get(id)
    if (!session || !session.active) return

    await invoke('resize_terminal', { id, cols, rows })
  }

  async function closeTerminal(id: string): Promise<void> {
    const session = sessions.get(id)
    if (!session) return

    try {
      await invoke('close_terminal', { id })
    } catch (error) {
      console.warn(`Error closing terminal ${id}:`, error)
    }

    session.active = false
    sessions.delete(id)
    outputCallbacks.delete(id)
  }

  // ---- Output Callbacks ----

  function onTerminalOutput(terminalId: string, callback: TerminalOutputCallback): () => void {
    if (!outputCallbacks.has(terminalId)) {
      outputCallbacks.set(terminalId, new Set())
    }

    outputCallbacks.get(terminalId)!.add(callback)

    // Return unsubscribe function
    return () => {
      const callbacks = outputCallbacks.get(terminalId)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          outputCallbacks.delete(terminalId)
        }
      }
    }
  }

  // ---- Getters ----

  function getSession(id: string): TerminalSession | undefined {
    return sessions.get(id)
  }

  function getSessionByWindowId(windowId: string): TerminalSession | undefined {
    for (const session of sessions.values()) {
      if (session.windowId === windowId) return session
    }
    return undefined
  }

  // ---- Cleanup ----

  function cleanup(): void {
    // Close all active sessions
    for (const [id, session] of sessions) {
      if (session.active) {
        invoke('close_terminal', { id }).catch(() => {})
      }
    }
    sessions.clear()
    outputCallbacks.clear()

    if (globalUnlisten.value) {
      globalUnlisten.value()
      globalUnlisten.value = null
      listenerInitialized.value = false
    }
  }

  // Auto-cleanup when the composable's component unmounts
  onUnmounted(() => {
    cleanup()
  })

  return {
    // State
    sessions,
    // Session management
    createTerminal,
    writeToTerminal,
    resizeTerminal,
    closeTerminal,
    // Output
    onTerminalOutput,
    // Getters
    getSession,
    getSessionByWindowId,
    // Cleanup
    cleanup,
  }
}
