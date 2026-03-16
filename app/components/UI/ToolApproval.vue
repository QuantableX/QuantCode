<script setup lang="ts">
import type { ToolApprovalRequest } from '../../../shared/types'

const props = defineProps<{
  request: ToolApprovalRequest
}>()

const emit = defineEmits<{
  (e: 'approve', alwaysApprove: boolean): void
  (e: 'deny'): void
}>()

const alwaysApprove = ref(false)

const formattedArgs = computed(() => {
  try {
    return JSON.stringify(props.request.toolCall.arguments, null, 2)
  } catch {
    return String(props.request.toolCall.arguments)
  }
})

function approve() {
  emit('approve', alwaysApprove.value)
}

function deny() {
  emit('deny')
}

// Handle Escape key to deny
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    deny()
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    approve()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="fixed inset-0 z-[10000] flex items-center justify-center">
    <!-- Backdrop -->
    <div
      class="absolute inset-0 bg-black/60 backdrop-blur-sm"
      @click="deny"
    />

    <!-- Modal -->
    <div class="relative bg-[#18181e] border border-[#37373f] rounded-xl shadow-2xl w-[480px] max-w-[90vw] max-h-[80vh] flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="flex items-center gap-3 px-5 py-4 border-b border-[#37373f]">
        <div class="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
          <span class="text-amber-400 text-sm">&#9888;</span>
        </div>
        <div>
          <h3 class="text-sm font-semibold text-[#d4d4d8]">Tool Approval Required</h3>
          <p class="text-[10px] text-[#5a5a65] mt-0.5">
            An agent wants to execute a tool. Review and approve or deny.
          </p>
        </div>
      </div>

      <!-- Content -->
      <div class="px-5 py-4 space-y-4 overflow-y-auto flex-1">
        <!-- Tool name -->
        <div class="space-y-1">
          <label class="text-[10px] text-[#5a5a65] uppercase tracking-wider font-bold">Tool</label>
          <div class="bg-[#16161c] rounded-lg px-3 py-2">
            <span class="text-xs text-[#22d3ee] font-mono">{{ request.toolCall.name }}</span>
          </div>
        </div>

        <!-- Arguments -->
        <div class="space-y-1">
          <label class="text-[10px] text-[#5a5a65] uppercase tracking-wider font-bold">Arguments</label>
          <pre class="bg-[#16161c] rounded-lg px-3 py-2 text-[10px] text-[#d4d4d8] font-mono overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap">{{ formattedArgs }}</pre>
        </div>

        <!-- Session info -->
        <div class="text-[10px] text-[#5a5a65]">
          Session: <span class="text-[#d4d4d8] font-mono">{{ request.sessionId.substring(0, 8) }}...</span>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-5 py-4 border-t border-[#37373f] space-y-3">
        <!-- Always approve checkbox -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            v-model="alwaysApprove"
            type="checkbox"
            class="w-3.5 h-3.5 rounded border-[#37373f] bg-[#16161c] text-[#a0a0a8] accent-[#a0a0a8]"
          />
          <span class="text-[10px] text-[#5a5a65]">Always approve this tool</span>
        </label>

        <!-- Buttons -->
        <div class="flex items-center justify-end gap-2">
          <button
            class="px-4 py-2 text-xs text-red-400 bg-red-400/10 rounded-lg hover:bg-red-400/20 transition-colors"
            @click="deny"
          >
            Deny
          </button>
          <button
            class="px-4 py-2 text-xs text-green-400 bg-green-400/10 rounded-lg hover:bg-green-400/20 transition-colors"
            @click="approve"
          >
            Approve
          </button>
        </div>

        <p class="text-[9px] text-[#5a5a65] text-center">
          Ctrl+Enter to approve &middot; Esc to deny
        </p>
      </div>
    </div>
  </div>
</template>
