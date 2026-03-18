import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import type { EditorTab } from '../shared/types'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'])

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext)) return 'image'
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    vue: 'vue',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    rs: 'rust',
    py: 'python',
    go: 'go',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    sql: 'sql',
    graphql: 'graphql',
    xml: 'xml',
    svg: 'xml',
    pine: 'javascript',
  }
  return languageMap[ext] ?? 'plaintext'
}

function extractFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath
}

export type Theme = 'dark' | 'light'
export type ShellType = 'powershell' | 'cmd' | 'bash' | 'wsl' | 'git-bash'

export const SHELL_OPTIONS: { value: ShellType; label: string; path: string }[] = [
  { value: 'powershell', label: 'PowerShell', path: 'powershell.exe' },
  { value: 'cmd', label: 'Command Prompt', path: 'cmd.exe' },
  { value: 'bash', label: 'Bash', path: 'bash' },
  { value: 'wsl', label: 'WSL', path: 'wsl.exe' },
  { value: 'git-bash', label: 'Git Bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe' },
]

export const useAppStore = defineStore('app', () => {
  // ---- State ----
  const fileExplorerVisible = ref(true)
  const editorVisible = ref(true)
  const activeEditorTabs = ref<EditorTab[]>([])
  const activeTabId = ref<string | null>(null)
  const commandPaletteOpen = ref(false)
  const settingsOpen = ref(false)
  const settingsModalOpen = ref(false)
  const theme = ref<Theme>((typeof localStorage !== 'undefined' && localStorage.getItem('qc-theme') as Theme) || 'dark')
  const defaultShell = ref<ShellType>((typeof localStorage !== 'undefined' && localStorage.getItem('qc-shell') as ShellType) || 'powershell')
  const snapToGrid = ref<boolean>(typeof localStorage !== 'undefined' ? localStorage.getItem('qc-snap-grid') !== 'false' : true)
  const snapCameraToGrid = ref<boolean>(typeof localStorage !== 'undefined' ? localStorage.getItem('qc-snap-camera') === 'true' : false)
  const fontSize = ref<number>(typeof localStorage !== 'undefined' ? Number(localStorage.getItem('qc-font-size')) || 15 : 15)
  const canvasHints = ref<boolean>(typeof localStorage !== 'undefined' ? localStorage.getItem('qc-canvas-hints') !== 'false' : true)
  const editorMinimap = ref<boolean>(typeof localStorage !== 'undefined' ? localStorage.getItem('qc-editor-minimap') !== 'false' : true)

  // ---- Getters ----
  const activeTab = computed<EditorTab | undefined>(() => {
    if (!activeTabId.value) return undefined
    return activeEditorTabs.value.find(t => t.id === activeTabId.value)
  })

  // ---- Actions ----

  function toggleFileExplorer(): void {
    fileExplorerVisible.value = !fileExplorerVisible.value
  }

  function toggleEditor(): void {
    editorVisible.value = !editorVisible.value
  }

  function setTheme(t: Theme): void {
    theme.value = t
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('qc-theme', t)
    }
    applyTheme(t)
  }

  function toggleTheme(): void {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  function toggleSettings(): void {
    settingsOpen.value = !settingsOpen.value
  }

  function openSettingsModal(): void {
    settingsModalOpen.value = true
    settingsOpen.value = false
  }

  function closeSettingsModal(): void {
    settingsModalOpen.value = false
  }

  function setDefaultShell(shell: ShellType): void {
    defaultShell.value = shell
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('qc-shell', shell)
    }
  }

  function toggleSnapToGrid(): void {
    snapToGrid.value = !snapToGrid.value
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('qc-snap-grid', String(snapToGrid.value))
    }
  }

  function toggleSnapCameraToGrid(): void {
    snapCameraToGrid.value = !snapCameraToGrid.value
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('qc-snap-camera', String(snapCameraToGrid.value))
    }
  }

  function applyTheme(t: Theme): void {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', t)
    }
  }

  function setFontSize(size: number): void {
    fontSize.value = size
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('qc-font-size', String(size))
    }
    applyFontSize(size)
  }

  function toggleCanvasHints(): void {
    canvasHints.value = !canvasHints.value
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('qc-canvas-hints', String(canvasHints.value))
    }
  }

  function toggleEditorMinimap(): void {
    editorMinimap.value = !editorMinimap.value
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('qc-editor-minimap', String(editorMinimap.value))
    }
  }

  function applyFontSize(size: number): void {
    if (typeof document !== 'undefined') {
      document.documentElement.style.fontSize = size + 'px'
    }
  }

  function openTab(filePath: string, content: string): void {
    const existingTab = activeEditorTabs.value.find(t => t.filePath === filePath)
    if (existingTab) {
      activeTabId.value = existingTab.id
      return
    }

    const tab: EditorTab = {
      id: uuidv4(),
      filePath,
      fileName: extractFileName(filePath),
      content,
      savedContent: content,
      isDirty: false,
      cursorPosition: { line: 1, column: 1 },
      language: detectLanguage(filePath),
    }

    activeEditorTabs.value.push(tab)
    activeTabId.value = tab.id
  }

  function closeTab(tabId: string): void {
    const index = activeEditorTabs.value.findIndex(t => t.id === tabId)
    if (index === -1) return

    activeEditorTabs.value.splice(index, 1)

    if (activeTabId.value === tabId) {
      if (activeEditorTabs.value.length > 0) {
        const nextIndex = Math.min(index, activeEditorTabs.value.length - 1)
        activeTabId.value = activeEditorTabs.value[nextIndex].id
      } else {
        activeTabId.value = null
      }
    }
  }

  function setActiveTab(tabId: string): void {
    const tab = activeEditorTabs.value.find(t => t.id === tabId)
    if (tab) {
      activeTabId.value = tabId
    }
  }

  function updateTabContent(tabId: string, content: string): void {
    const tab = activeEditorTabs.value.find(t => t.id === tabId)
    if (!tab) return

    tab.content = content
    tab.isDirty = content !== tab.savedContent
  }

  function markTabClean(tabId: string): void {
    const tab = activeEditorTabs.value.find(t => t.id === tabId)
    if (tab) {
      tab.savedContent = tab.content
      tab.isDirty = false
    }
  }

  // Trigger for file explorer refresh — components watch this
  const fileExplorerRefreshKey = ref(0)

  function triggerFileExplorerRefresh(): void {
    fileExplorerRefreshKey.value++
  }

  // Normalize path for comparison: forward slashes, lowercase drive letter
  function normPath(p: string): string {
    return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => d.toLowerCase() + ':')
  }

  function pathsMatch(a: string, b: string): boolean {
    const na = normPath(a)
    const nb = normPath(b)
    return na === nb || na.endsWith('/' + nb) || nb.endsWith('/' + na)
  }

  function refreshTab(filePath: string, content: string): void {
    const tab = activeEditorTabs.value.find(t => pathsMatch(t.filePath, filePath))
    if (tab) {
      tab.content = content
      tab.savedContent = content
      tab.isDirty = false
    }
  }

  // Cross-editor file sync: when any editor saves, others can react
  const lastSavedFile = ref<{ filePath: string; content: string; ts: number } | null>(null)

  function notifyFileSaved(filePath: string, content: string): void {
    lastSavedFile.value = { filePath, content, ts: Date.now() }
    // Also update the sidebar editor tab if it exists
    refreshTab(filePath, content)
  }

  // Notify that a file was deleted — close matching sidebar tabs and canvas windows
  const lastDeletedFile = ref<{ filePath: string; ts: number } | null>(null)

  function notifyFileDeleted(filePath: string): void {
    // Close matching sidebar editor tab
    const tab = activeEditorTabs.value.find(t => pathsMatch(t.filePath, filePath))
    if (tab) {
      closeTab(tab.id)
    }
    // Signal canvas windows to close (FileWindow watches this)
    lastDeletedFile.value = { filePath, ts: Date.now() }
  }

  return {
    // State
    fileExplorerVisible,
    editorVisible,
    activeEditorTabs,
    activeTabId,
    commandPaletteOpen,
    settingsOpen,
    settingsModalOpen,
    theme,
    defaultShell,
    snapToGrid,
    snapCameraToGrid,
    fontSize,
    canvasHints,
    editorMinimap,
    // Getters
    activeTab,
    // Actions
    toggleFileExplorer,
    toggleEditor,
    setTheme,
    toggleTheme,
    toggleSettings,
    openSettingsModal,
    closeSettingsModal,
    setDefaultShell,
    toggleSnapToGrid,
    toggleSnapCameraToGrid,
    toggleCanvasHints,
    toggleEditorMinimap,
    setFontSize,
    applyFontSize,
    applyTheme,
    openTab,
    closeTab,
    setActiveTab,
    updateTabContent,
    markTabClean,
    fileExplorerRefreshKey,
    triggerFileExplorerRefresh,
    refreshTab,
    lastSavedFile,
    notifyFileSaved,
    pathsMatch,
    lastDeletedFile,
    notifyFileDeleted,
  }
})
