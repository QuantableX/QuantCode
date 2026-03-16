<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { useAppStore, type Theme } from '../../../stores/app'
import { marked } from 'marked'

const appStore = useAppStore()

const editorContainer = ref<HTMLElement | null>(null)
let editorInstance: any = null
let monacoModule: any = null
let ignoreChanges = false

const tabs = computed(() => appStore.activeEditorTabs)
const activeTabId = computed(() => appStore.activeTabId)
const activeTab = computed(() => appStore.activeTab)

// Markdown preview toggle
const showMarkdownPreview = ref(false)

const isMarkdownTab = computed(() => activeTab.value?.language === 'markdown')
const isImageTab = computed(() => activeTab.value?.language === 'image')

const renderedMarkdown = computed(() => {
  if (!isMarkdownTab.value || !activeTab.value) return ''
  return marked.parse(activeTab.value.content) as string
})

// Reset preview when switching away from markdown tabs
watch(activeTabId, () => {
  if (!isMarkdownTab.value) {
    showMarkdownPreview.value = false
  }
})

async function initMonaco() {
  if (!editorContainer.value) return

  try {
    monacoModule = await import('monaco-editor')

    // Configure Monaco theme
    monacoModule.editor.defineTheme('quantcode-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '71717a', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'c084fc' },
        { token: 'string', foreground: '4ade80' },
        { token: 'number', foreground: 'f59e0b' },
        { token: 'type', foreground: '22d3ee' },
        { token: 'function', foreground: '60a5fa' },
      ],
      colors: {
        'editor.background': '#18181e',
        'editor.foreground': '#d4d4d8',
        'editor.lineHighlightBackground': '#24242a40',
        'editor.selectionBackground': '#a0a0a830',
        'editorCursor.foreground': '#f97316',
        'editor.inactiveSelectionBackground': '#a0a0a815',
        'editorLineNumber.foreground': '#5a5a65',
        'editorLineNumber.activeForeground': '#d4d4d8',
        'editorGutter.background': '#18181e',
        'editorWidget.background': '#1f1f25',
        'editorWidget.border': '#37373f',
        'input.background': '#16161c',
        'input.border': '#37373f',
        'input.foreground': '#d4d4d8',
        'list.activeSelectionBackground': '#a0a0a830',
        'list.hoverBackground': '#24242a',
        'scrollbarSlider.background': '#37373f80',
        'scrollbarSlider.hoverBackground': '#4a4a5280',
      },
    })

    monacoModule.editor.defineTheme('quantcode-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6b6b80', fontStyle: 'italic' },
        { token: 'keyword', foreground: '7c3aed' },
        { token: 'string', foreground: '16a34a' },
        { token: 'number', foreground: 'd97706' },
        { token: 'type', foreground: '0891b2' },
        { token: 'function', foreground: '2563eb' },
      ],
      colors: {
        'editor.background': '#d8d8de',
        'editor.foreground': '#24242c',
        'editor.lineHighlightBackground': '#d0d0d640',
        'editor.selectionBackground': '#a0a0a830',
        'editorCursor.foreground': '#f97316',
        'editorLineNumber.foreground': '#888892',
        'editorLineNumber.activeForeground': '#24242c',
        'editorGutter.background': '#d8d8de',
        'editorWidget.background': '#e0e0e5',
        'editorWidget.border': '#babac2',
      },
    })

    editorInstance = monacoModule.editor.create(editorContainer.value, {
      value: activeTab.value?.content ?? '',
      language: activeTab.value?.language ?? 'plaintext',
      theme: appStore.theme === 'light' ? 'quantcode-light' : 'quantcode-dark',
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontLigatures: true,
      lineNumbers: 'on',
      minimap: { enabled: appStore.editorMinimap, maxColumn: 80 },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 8, bottom: 8 },
      renderLineHighlight: 'line',
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      smoothScrolling: true,
      bracketPairColorization: { enabled: true },
      wordWrap: 'off',
      tabSize: 2,
      insertSpaces: true,
    })

    // Listen for content changes (only user edits, not programmatic setValue)
    editorInstance.onDidChangeModelContent(() => {
      if (ignoreChanges) return
      if (activeTabId.value) {
        const content = editorInstance.getValue()
        appStore.updateTabContent(activeTabId.value, content)
      }
    })

    // Listen for cursor position changes
    editorInstance.onDidChangeCursorPosition((e: any) => {
      if (activeTab.value) {
        activeTab.value.cursorPosition = {
          line: e.position.lineNumber,
          column: e.position.column,
        }
      }
    })

    // Ctrl+S to save
    editorInstance.addAction({
      id: 'quantcode-save',
      label: 'Save File',
      keybindings: [monacoModule.KeyMod.CtrlCmd | monacoModule.KeyCode.KeyS],
      run: () => saveFile(),
    })
  } catch (err) {
    console.error('Failed to initialize Monaco:', err)
  }
}

// Switch editor content when active tab changes
watch(activeTabId, () => {
  if (!editorInstance || !monacoModule) return

  if (!activeTab.value) {
    editorInstance.setValue('')
    return
  }

  const model = editorInstance.getModel()
  if (model) {
    // Update language if different
    const currentLang = model.getLanguageId()
    if (currentLang !== activeTab.value.language) {
      monacoModule.editor.setModelLanguage(model, activeTab.value.language)
    }
  }

  ignoreChanges = true
  editorInstance.setValue(activeTab.value.content)
  ignoreChanges = false
})

async function saveFile() {
  if (!activeTab.value || !editorInstance) return
  try {
    const content = editorInstance.getValue()
    await invoke('write_file', {
      path: activeTab.value.filePath,
      content,
    })
    appStore.markTabClean(activeTab.value.id)
  } catch (e) {
    console.error('Failed to save file:', e)
  }
}

function switchTab(tabId: string) {
  appStore.setActiveTab(tabId)
}

function closeTab(tabId: string, e: Event) {
  e.stopPropagation()
  appStore.closeTab(tabId)
}

onMounted(() => {
  initMonaco()
})

onUnmounted(() => {
  editorInstance?.dispose()
})

// Switch Monaco theme when app theme changes
watch(() => appStore.theme, (t: Theme) => {
  if (monacoModule) {
    monacoModule.editor.setTheme(t === 'light' ? 'quantcode-light' : 'quantcode-dark')
  }
})

// Toggle minimap reactively
watch(() => appStore.editorMinimap, (enabled) => {
  editorInstance?.updateOptions({ minimap: { enabled } })
})

// Handle resize
const resizeObserver = ref<ResizeObserver | null>(null)
onMounted(() => {
  if (editorContainer.value) {
    resizeObserver.value = new ResizeObserver(() => {
      editorInstance?.layout()
    })
    resizeObserver.value.observe(editorContainer.value)
  }
})

onUnmounted(() => {
  resizeObserver.value?.disconnect()
})
</script>

<template>
  <div class="flex flex-col h-full" :style="{ background: 'var(--qc-bg-titlebar)' }">
    <!-- Tab bar -->
    <div class="flex items-center overflow-x-auto flex-shrink-0" :style="{ borderBottom: '1px solid var(--qc-border)', background: 'var(--qc-bg-titlebar)' }">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer transition-colors flex-shrink-0"
        :class="tab.id === activeTabId ? 'border-b-2 border-b-[#a0a0a8]' : ''"
        :style="{
          borderRight: '1px solid var(--qc-border)',
          color: tab.id === activeTabId ? 'var(--qc-text)' : 'var(--qc-text-muted)',
          background: tab.id === activeTabId ? 'var(--qc-bg-window)' : 'transparent',
        }"
        @click="switchTab(tab.id)"
        @mousedown.middle.prevent="closeTab(tab.id, $event)"
      >
        <!-- Dirty indicator -->
        <span
          v-if="tab.isDirty"
          class="w-1.5 h-1.5 rounded-full bg-[#a0a0a8] flex-shrink-0"
        />

        <span class="truncate max-w-[120px]">{{ tab.fileName }}</span>

        <!-- Close button -->
        <button
          class="w-4 h-4 flex items-center justify-center rounded text-[10px] flex-shrink-0"
          :style="{ color: 'var(--qc-text-muted)' }"
          @click="closeTab(tab.id, $event)"
        >
          &#10005;
        </button>
      </div>

      <!-- Empty state hint -->
      <div
        v-if="tabs.length === 0"
        class="px-3 py-1.5 text-xs"
        :style="{ color: 'var(--qc-text-muted)' }"
      >
        No files open &middot; <span class="text-[10px]">Click a file in the explorer to open it</span>
      </div>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Markdown preview toggle -->
      <button
        v-if="isMarkdownTab"
        class="flex-shrink-0 px-2 py-1 text-[10px] transition-colors mr-1"
        :style="{
          color: showMarkdownPreview ? 'var(--qc-text)' : 'var(--qc-text-muted)',
          background: showMarkdownPreview ? 'var(--qc-bg-window)' : 'transparent',
          borderRadius: '4px',
        }"
        :title="showMarkdownPreview ? 'Show source' : 'Show preview'"
        @click="showMarkdownPreview = !showMarkdownPreview"
      >
        {{ showMarkdownPreview ? '&lt;/&gt; Source' : 'Preview' }}
      </button>
    </div>

    <!-- Image viewer -->
    <div
      v-if="isImageTab"
      class="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4"
      :style="{ background: 'repeating-conic-gradient(var(--qc-bg-surface) 0% 25%, var(--qc-bg) 0% 50%) 50% / 16px 16px' }"
    >
      <img
        v-if="activeTab?.content"
        :src="activeTab.content"
        :alt="activeTab.fileName"
        class="max-w-full max-h-full object-contain"
        draggable="false"
      />
    </div>

    <!-- Monaco Editor (hidden when markdown preview or image is active) -->
    <div v-show="!showMarkdownPreview && !isImageTab" ref="editorContainer" class="flex-1 min-h-0" />

    <!-- Markdown rendered preview -->
    <div
      v-if="showMarkdownPreview && isMarkdownTab"
      class="flex-1 min-h-0 overflow-auto markdown-body p-4"
      :style="{ background: 'var(--qc-bg-window)' }"
      v-html="renderedMarkdown"
    />

  </div>
</template>

<style scoped>
/* Markdown rendered output styling */
.markdown-body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 13px;
  line-height: 1.6;
  color: var(--qc-text);
}

.markdown-body :deep(h1) {
  font-size: 1.6em;
  font-weight: 700;
  margin: 0.6em 0 0.4em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--qc-border);
}

.markdown-body :deep(h2) {
  font-size: 1.3em;
  font-weight: 600;
  margin: 0.6em 0 0.3em;
  padding-bottom: 0.2em;
  border-bottom: 1px solid var(--qc-border);
}

.markdown-body :deep(h3) {
  font-size: 1.1em;
  font-weight: 600;
  margin: 0.5em 0 0.3em;
}

.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-size: 1em;
  font-weight: 600;
  margin: 0.4em 0 0.2em;
}

.markdown-body :deep(p) {
  margin: 0.4em 0;
}

.markdown-body :deep(a) {
  color: #60a5fa;
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(strong) {
  font-weight: 700;
  color: var(--qc-text);
}

.markdown-body :deep(em) {
  font-style: italic;
}

.markdown-body :deep(code) {
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.88em;
  padding: 0.15em 0.35em;
  border-radius: 4px;
  background: var(--qc-bg-surface);
  color: #f59e0b;
}

.markdown-body :deep(pre) {
  margin: 0.5em 0;
  padding: 10px 14px;
  border-radius: 6px;
  background: var(--qc-bg-surface);
  overflow-x: auto;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: none;
  color: var(--qc-text);
  font-size: 12px;
  line-height: 1.5;
}

.markdown-body :deep(blockquote) {
  margin: 0.5em 0;
  padding: 0.3em 1em;
  border-left: 3px solid var(--qc-border);
  color: var(--qc-text-muted);
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.5em;
}

.markdown-body :deep(li) {
  margin: 0.15em 0;
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--qc-border);
  margin: 0.8em 0;
}

.markdown-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5em 0;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--qc-border);
  font-size: 12px;
}

.markdown-body :deep(th) {
  font-weight: 600;
  background: var(--qc-bg-surface);
}

.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 4px;
}

.markdown-body :deep(input[type="checkbox"]) {
  margin-right: 0.4em;
}
</style>
