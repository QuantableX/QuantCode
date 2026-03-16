<script setup lang="ts">
import type { ChatMessage } from '../../../shared/types'

const props = defineProps<{
  message: ChatMessage
}>()

const showTimestamp = ref(false)

const formattedTime = computed(() => {
  try {
    const d = new Date(props.message.timestamp)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
})

// Basic markdown rendering
function renderMarkdown(text: string): string {
  let html = escapeHtml(text)

  // Code blocks: ```lang\n...\n```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<div class="code-block-wrapper"><pre class="code-block"><code>${code.trim()}</code></pre><button class="copy-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">Copy</button></div>`
  })

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

  // Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  // Italic: *text*
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')

  // Unordered list items: - item
  html = html.replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li[^>]*>.*?<\/li>\n?)+)/g, '<ul class="my-1">$1</ul>')

  // Line breaks (but not inside code blocks)
  html = html.replace(/\n/g, '<br />')

  return html
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (c) => map[c])
}

const toolStatusIcon = computed(() => {
  if (!props.message.toolCalls?.length) return ''
  const status = props.message.toolCalls[0].status
  const icons: Record<string, string> = {
    pending: '\u23F3',
    approved: '\u2705',
    denied: '\u274C',
    completed: '\u2705',
    error: '\u26A0\uFE0F',
  }
  return icons[status] ?? ''
})
</script>

<template>
  <div
    @mouseenter="showTimestamp = true"
    @mouseleave="showTimestamp = false"
  >
    <!-- User message -->
    <div v-if="message.role === 'user'" class="flex justify-end">
      <div class="max-w-[85%]">
        <div class="bg-[#1c1c22] rounded-lg px-4 py-2 text-xs text-[#d4d4d8] leading-relaxed">
          <div v-html="renderMarkdown(message.content)" />
        </div>
        <div
          v-if="showTimestamp"
          class="text-[9px] text-[#5a5a65] mt-0.5 text-right transition-opacity"
        >
          {{ formattedTime }}
        </div>
      </div>
    </div>

    <!-- Assistant message -->
    <div v-else-if="message.role === 'assistant'" class="text-left">
      <div class="text-xs text-[#d4d4d8] whitespace-pre-wrap leading-relaxed markdown-content">
        <div v-html="renderMarkdown(message.content)" />
        <span v-if="message.streaming" class="animate-pulse text-[#a0a0a8]">|</span>
      </div>
      <div
        v-if="showTimestamp"
        class="text-[9px] text-[#5a5a65] mt-0.5 transition-opacity"
      >
        {{ formattedTime }}
      </div>
    </div>

    <!-- System message -->
    <div v-else-if="message.role === 'system'" class="text-center">
      <span class="text-[10px] text-[#5a5a65] italic">{{ message.content }}</span>
    </div>

    <!-- Tool message -->
    <div v-else-if="message.role === 'tool'" class="pl-4">
      <!-- Tool calls from the message -->
      <div v-if="message.toolCalls?.length" class="space-y-1">
        <div
          v-for="tc in message.toolCalls"
          :key="tc.id"
          class="space-y-1"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-[10px]">{{ toolStatusIcon }}</span>
            <span class="text-[10px] bg-[#22d3ee]/10 text-[#22d3ee] px-1.5 py-0.5 rounded font-mono">
              {{ tc.name }}
            </span>
            <span class="text-[9px] text-[#5a5a65]">{{ tc.status }}</span>
          </div>
          <!-- Tool result -->
          <div
            v-if="tc.result"
            class="bg-[#16161c] rounded px-3 py-2 text-[10px] font-mono text-[#d4d4d8] overflow-x-auto"
            :class="{ 'border-l-2 border-red-400': tc.result.isError }"
          >
            <pre class="whitespace-pre-wrap">{{ tc.result.content }}</pre>
          </div>
        </div>
      </div>

      <!-- Direct tool result content -->
      <div
        v-else-if="message.content"
        class="bg-[#16161c] rounded px-3 py-2 text-[10px] font-mono text-[#d4d4d8] overflow-x-auto"
      >
        <pre class="whitespace-pre-wrap">{{ message.content }}</pre>
      </div>

      <div
        v-if="showTimestamp"
        class="text-[9px] text-[#5a5a65] mt-0.5 transition-opacity"
      >
        {{ formattedTime }}
      </div>
    </div>
  </div>
</template>

<style scoped>
:deep(.code-block-wrapper) {
  position: relative;
  margin: 4px 0;
}

:deep(.code-block) {
  background: #16161c;
  border-radius: 6px;
  padding: 8px 12px;
  overflow-x: auto;
  font-size: 11px;
  line-height: 1.5;
}

:deep(.copy-btn) {
  position: absolute;
  top: 4px;
  right: 4px;
  background: #37373f;
  color: #5a5a65;
  border: none;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 9px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}

:deep(.code-block-wrapper:hover .copy-btn) {
  opacity: 1;
}

:deep(.copy-btn:hover) {
  color: #d4d4d8;
}

:deep(.inline-code) {
  background: #1c1c22;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 11px;
}

:deep(strong) {
  font-weight: 700;
  color: #d4d4d8;
}

:deep(em) {
  font-style: italic;
  color: #d4d4d8;
}

:deep(ul) {
  padding-left: 8px;
}

:deep(li) {
  margin: 2px 0;
}

.markdown-content :deep(br + br) {
  display: block;
  content: '';
  margin-top: 4px;
}
</style>
