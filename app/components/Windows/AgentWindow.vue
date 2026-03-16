<script setup lang="ts">
import { useWorkspacesStore } from '../../../stores/workspaces'
import { useCanvasStore } from '../../../stores/canvas'
import type { CanvasWindow, AgentProvider, AgentRole, ChatMessage } from '../../../shared/types'

const props = defineProps<{
  window: CanvasWindow
}>()

const workspacesStore = useWorkspacesStore()
const canvasStore = useCanvasStore()
const workspaceId = computed(() => workspacesStore.activeWorkspaceId!)

const agent = useAgent()

const inputText = ref('')
const messagesContainer = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const sessionId = ref<string | null>(null)

const config = props.window.agentConfig ?? {
  provider: 'anthropic' as AgentProvider,
  model: 'claude-sonnet-4-20250514',
  role: 'general' as AgentRole,
}

const selectedModel = ref(config.model)
const selectedProvider = ref<AgentProvider>(config.provider)

const models: Record<AgentProvider, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-235-20241022'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1-preview'],
  ollama: ['llama3', 'codellama', 'mistral'],
}

const roleLabels: Record<AgentRole, string> = {
  coder: 'Coder',
  reviewer: 'Reviewer',
  tester: 'Tester',
  coordinator: 'Coordinator',
  verifier: 'Verifier',
  general: 'General',
}

const currentSession = computed(() => {
  if (!sessionId.value) return null
  return agent.getSession(sessionId.value) ?? null
})

const visibleMessages = computed<ChatMessage[]>(() => {
  if (!currentSession.value) return []
  return currentSession.value.messages.filter(m => m.role !== 'system')
})

const isStreaming = computed(() => {
  if (!currentSession.value) return false
  const msgs = currentSession.value.messages
  if (msgs.length === 0) return false
  const last = msgs[msgs.length - 1]
  return last.role === 'assistant' && last.streaming === true
})

const streamingMessage = computed<ChatMessage | null>(() => {
  if (!isStreaming.value || !currentSession.value) return null
  const msgs = currentSession.value.messages
  const last = msgs[msgs.length - 1]
  if (last.role === 'assistant' && last.streaming) return last
  return null
})

const sessionStatus = computed(() => currentSession.value?.status ?? 'idle')
const sessionConfig = computed(() => currentSession.value?.config ?? config)

// Auto-scroll to bottom
function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

watch(
  () => visibleMessages.value.length,
  () => scrollToBottom()
)

watch(
  () => streamingMessage.value?.content,
  () => scrollToBottom()
)

// Sync session status to canvas window status
watch(sessionStatus, (status) => {
  canvasStore.updateWindow(workspaceId.value, props.window.id, { status })
})

onMounted(() => {
  agent.setWorkspacePath(workspacesStore.activeWorkspace?.folderPath ?? '')
  const session = agent.createSession(props.window.id, config)
  sessionId.value = session.id
})

onUnmounted(() => {
  if (sessionId.value) {
    agent.deleteSession(sessionId.value)
  }
})

// Send message
async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || isStreaming.value || !sessionId.value) return

  inputText.value = ''

  try {
    await agent.sendMessage(sessionId.value, text)
  } catch (err) {
    console.error('Agent message error:', err)
  }
}

function stopStreaming() {
  if (sessionId.value) {
    agent.cancelStream(sessionId.value)
  }
  canvasStore.updateWindow(workspaceId.value, props.window.id, { status: 'idle' })
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

function updateModel() {
  if (!currentSession.value) return
  currentSession.value.config.model = selectedModel.value
  currentSession.value.config.provider = selectedProvider.value
}

watch(selectedProvider, (p) => {
  selectedModel.value = models[p][0]
  updateModel()
})

watch(selectedModel, () => updateModel())
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Model selector bar -->
    <div class="flex items-center gap-2 px-3 py-1.5 flex-shrink-0" :style="{ borderBottom: '1px solid var(--qc-border)', background: 'var(--qc-bg)' }">
      <select
        v-model="selectedProvider"
        class="text-[10px] rounded px-1.5 py-0.5 outline-none"
        :style="{ background: 'var(--qc-bg-header)', border: '1px solid var(--qc-border)', color: 'var(--qc-text)' }"
      >
        <option value="anthropic">Anthropic</option>
        <option value="openai">OpenAI</option>
        <option value="ollama">Ollama</option>
      </select>

      <select
        v-model="selectedModel"
        class="text-[10px] rounded px-1.5 py-0.5 outline-none flex-1 min-w-0"
        :style="{ background: 'var(--qc-bg-header)', border: '1px solid var(--qc-border)', color: 'var(--qc-text)' }"
      >
        <option v-for="m in models[selectedProvider]" :key="m" :value="m">{{ m }}</option>
      </select>

      <span class="text-[10px] px-1.5 py-0.5 rounded" :style="{ color: 'var(--qc-text-muted)', background: 'var(--qc-bg-header)', border: '1px solid var(--qc-border)' }">
        {{ roleLabels[sessionConfig.role] }}
      </span>
    </div>

    <!-- Messages area -->
    <div
      ref="messagesContainer"
      class="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3"
    >
      <!-- Empty state -->
      <div
        v-if="visibleMessages.length === 0 && !isStreaming"
        class="flex items-center justify-center h-full text-xs"
        :style="{ color: 'var(--qc-text-muted)' }"
      >
        Start a conversation...
      </div>

      <!-- Messages (excluding streaming assistant message) -->
      <UiMessageBubble
        v-for="msg in visibleMessages.filter(m => !m.streaming)"
        :key="msg.id"
        :message="msg"
      />

      <!-- Streaming message -->
      <div
        v-if="streamingMessage && streamingMessage.content"
        class="text-left"
      >
        <div class="text-xs whitespace-pre-wrap leading-relaxed" :style="{ color: 'var(--qc-text)' }">
          {{ streamingMessage.content }}<span class="animate-pulse text-[#a0a0a8]">|</span>
        </div>
      </div>

      <!-- Thinking indicator -->
      <div
        v-if="isStreaming && (!streamingMessage || !streamingMessage.content)"
        class="flex items-center gap-2 text-xs"
        :style="{ color: 'var(--qc-text-muted)' }"
      >
        <span class="thinking-dots">Thinking</span>
      </div>
    </div>

    <!-- Input area -->
    <div class="p-2 flex-shrink-0" :style="{ borderTop: '1px solid var(--qc-border)' }">
      <div class="flex items-end gap-2">
        <textarea
          ref="inputRef"
          v-model="inputText"
          placeholder="Message..."
          rows="1"
          class="flex-1 rounded-lg px-3 py-2 text-xs outline-none resize-none focus:border-[#a0a0a8]/50 transition-colors"
          :style="{ background: 'var(--qc-bg-input)', border: '1px solid var(--qc-border)', color: 'var(--qc-text)' }"
          :disabled="isStreaming"
          @keydown="onInputKeydown"
        />
        <button
          v-if="isStreaming"
          class="px-3 py-2 bg-red-500/20 text-red-400 text-xs rounded-lg hover:bg-red-500/30 transition-colors flex-shrink-0"
          @click="stopStreaming"
        >
          Stop
        </button>
        <button
          v-else
          class="px-3 py-2 bg-[#a0a0a8]/20 text-[#a0a0a8] text-xs rounded-lg hover:bg-[#a0a0a8]/30 transition-colors flex-shrink-0 disabled:opacity-30"
          :disabled="!inputText.trim()"
          @click="sendMessage"
        >
          Send
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thinking-dots::after {
  content: '';
  animation: dots 1.5s steps(4, end) infinite;
}

@keyframes dots {
  0% { content: ''; }
  25% { content: '.'; }
  50% { content: '..'; }
  75% { content: '...'; }
  100% { content: ''; }
}

textarea {
  min-height: 32px;
  max-height: 120px;
  field-sizing: content;
}
</style>
