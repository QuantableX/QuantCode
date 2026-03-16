import { reactive, ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import type {
  AgentSession,
  AgentConfig,
  ChatMessage,
  ToolCall,
  ToolResult,
  ToolApprovalRequest,
  ProviderMessage,
  ProviderContentBlock,
  StreamChunk,
  MCPTool,
} from '../shared/types'
import { AnthropicProvider } from '../lib/providers/anthropic'
import { OpenAIProvider } from '../lib/providers/openai'
import { OllamaProvider } from '../lib/providers/ollama'
import { BUILT_IN_TOOLS } from '../lib/mcp/tools'
import { executeTool } from '../lib/mcp/client'
import { getRoleSystemPrompt } from '../lib/agents/roles'
import type { BaseProvider } from '../lib/providers/base'

type ApprovalHandler = (request: ToolApprovalRequest) => Promise<boolean>

export function useAgent() {
  const sessions = reactive<Map<string, AgentSession>>(new Map())
  const activeAbortControllers = reactive<Map<string, AbortController>>(new Map())
  const approvalHandler = ref<ApprovalHandler | null>(null)
  const workspacePath = ref<string>('')

  // ---- Provider Factory ----

  function createProvider(config: AgentConfig): BaseProvider {
    switch (config.provider) {
      case 'anthropic':
        return new AnthropicProvider(config.apiKey || '', config.baseUrl)
      case 'openai':
        return new OpenAIProvider(config.apiKey || '', config.baseUrl)
      case 'ollama':
        return new OllamaProvider(config.apiKey, config.baseUrl)
      default:
        throw new Error(`Unknown provider: ${config.provider}`)
    }
  }

  // ---- Session Management ----

  function createSession(windowId: string, config: AgentConfig): AgentSession {
    const session: AgentSession = {
      id: uuidv4(),
      windowId,
      config,
      messages: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
    }

    // Add system prompt as first message
    const systemPrompt = config.systemPrompt || getRoleSystemPrompt(config.role)
    session.messages.push({
      id: uuidv4(),
      role: 'system',
      content: systemPrompt,
      timestamp: new Date().toISOString(),
    })

    sessions.set(session.id, session)
    return session
  }

  function getSession(sessionId: string): AgentSession | undefined {
    return sessions.get(sessionId)
  }

  function clearSession(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (!session) return

    // Keep only the system message
    const systemMsg = session.messages.find(m => m.role === 'system')
    session.messages = systemMsg ? [systemMsg] : []
    session.status = 'idle'
  }

  function deleteSession(sessionId: string): void {
    cancelStream(sessionId)
    sessions.delete(sessionId)
  }

  // ---- Message Handling ----

  async function sendMessage(sessionId: string, content: string): Promise<void> {
    const session = sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Add user message
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    }
    session.messages.push(userMessage)

    // Start streaming response
    await generateResponse(session)
  }

  async function generateResponse(session: AgentSession): Promise<void> {
    const provider = createProvider(session.config)

    // Create assistant message for streaming
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      streaming: true,
      toolCalls: [],
    }
    session.messages.push(assistantMessage)
    session.status = 'thinking'

    // Set up abort controller
    const abortController = new AbortController()
    activeAbortControllers.set(session.id, abortController)

    // Convert messages to provider format
    const providerMessages = convertToProviderMessages(session.messages)

    // Track active tool calls during streaming
    let pendingToolCalls: ToolCall[] = []
    let currentToolCall: Partial<ToolCall> | null = null

    try {
      await provider.chat(providerMessages, {
        model: session.config.model,
        apiKey: session.config.apiKey,
        baseUrl: session.config.baseUrl,
        tools: BUILT_IN_TOOLS,
        onStream: (chunk: StreamChunk) => {
          if (abortController.signal.aborted) return

          switch (chunk.type) {
            case 'text':
              assistantMessage.content += chunk.text || ''
              break

            case 'tool_use_start':
              currentToolCall = {
                id: chunk.toolCall?.id || uuidv4(),
                name: chunk.toolCall?.name || '',
                arguments: {},
                status: 'pending',
              }
              break

            case 'tool_use_delta':
              // Input JSON is still streaming, nothing to update yet
              break

            case 'tool_use_end':
              if (chunk.toolCall) {
                const toolCall: ToolCall = {
                  id: chunk.toolCall.id || currentToolCall?.id || uuidv4(),
                  name: chunk.toolCall.name || currentToolCall?.name || '',
                  arguments: chunk.toolCall.arguments || {},
                  status: 'pending',
                }
                pendingToolCalls.push(toolCall)
                if (!assistantMessage.toolCalls) assistantMessage.toolCalls = []
                assistantMessage.toolCalls.push(toolCall)
              }
              currentToolCall = null
              break

            case 'done':
              assistantMessage.streaming = false
              break

            case 'error':
              assistantMessage.streaming = false
              session.status = 'error'
              if (chunk.error) {
                assistantMessage.content += `\n\n[Error: ${chunk.error}]`
              }
              break
          }
        },
      })

      // Handle tool calls if any were collected
      if (pendingToolCalls.length > 0 && !abortController.signal.aborted) {
        session.status = 'live'
        await handleToolCalls(session, assistantMessage, pendingToolCalls)
        pendingToolCalls = []
      } else {
        session.status = 'idle'
      }
    } catch (error) {
      assistantMessage.streaming = false
      session.status = 'error'
      const message = error instanceof Error ? error.message : String(error)
      assistantMessage.content += `\n\n[Error: ${message}]`
    } finally {
      activeAbortControllers.delete(session.id)
      assistantMessage.streaming = false
    }
  }

  async function handleToolCalls(
    session: AgentSession,
    assistantMessage: ChatMessage,
    toolCalls: ToolCall[],
  ): Promise<void> {
    const toolResults: ToolResult[] = []

    for (const toolCall of toolCalls) {
      // Request approval
      const approved = await requestApproval(session.id, toolCall)

      if (!approved) {
        toolCall.status = 'denied'
        toolResults.push({
          toolCallId: toolCall.id,
          content: 'Tool call was denied by the user.',
          isError: true,
        })
        continue
      }

      toolCall.status = 'approved'

      // Execute the tool
      try {
        const result = await executeTool(toolCall.name, toolCall.arguments, workspacePath.value)
        toolCall.status = 'completed'
        toolCall.result = {
          toolCallId: toolCall.id,
          content: result.content,
          isError: result.isError,
        }
        toolResults.push(toolCall.result)
      } catch (error) {
        toolCall.status = 'error'
        const errorMsg = error instanceof Error ? error.message : String(error)
        const result: ToolResult = {
          toolCallId: toolCall.id,
          content: `Tool execution error: ${errorMsg}`,
          isError: true,
        }
        toolCall.result = result
        toolResults.push(result)
      }
    }

    // Add tool results as messages and continue the conversation
    assistantMessage.toolResults = toolResults

    // Build tool result message to send back to the provider
    const toolResultMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: '',
      timestamp: new Date().toISOString(),
      toolResults,
    }
    session.messages.push(toolResultMessage)

    // Continue the conversation with tool results
    await generateResponse(session)
  }

  async function requestApproval(sessionId: string, toolCall: ToolCall): Promise<boolean> {
    if (!approvalHandler.value) {
      // Auto-approve if no handler is set
      return true
    }

    return approvalHandler.value({
      sessionId,
      toolCall,
    })
  }

  // ---- Stream Control ----

  function cancelStream(sessionId: string): void {
    const controller = activeAbortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      activeAbortControllers.delete(sessionId)
    }

    const session = sessions.get(sessionId)
    if (session) {
      session.status = 'idle'
      // Mark any streaming messages as done
      for (const msg of session.messages) {
        if (msg.streaming) {
          msg.streaming = false
          msg.content += '\n\n[Cancelled]'
        }
      }
    }
  }

  // ---- Configuration ----

  function setApprovalHandler(handler: ApprovalHandler): void {
    approvalHandler.value = handler
  }

  function setWorkspacePath(path: string): void {
    workspacePath.value = path
  }

  // ---- Message Format Conversion ----

  function convertToProviderMessages(messages: ChatMessage[]): ProviderMessage[] {
    const providerMessages: ProviderMessage[] = []

    for (const msg of messages) {
      if (msg.role === 'system') {
        providerMessages.push({
          role: 'system',
          content: msg.content,
        })
        continue
      }

      if (msg.role === 'user') {
        // Check if this is a tool result message
        if (msg.toolResults && msg.toolResults.length > 0) {
          const blocks: ProviderContentBlock[] = msg.toolResults.map(result => ({
            type: 'tool_result' as const,
            tool_use_id: result.toolCallId,
            content: result.content,
            is_error: result.isError,
          }))
          providerMessages.push({ role: 'user', content: blocks })
        } else {
          providerMessages.push({ role: 'user', content: msg.content })
        }
        continue
      }

      if (msg.role === 'assistant') {
        // Check if this message has tool calls
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const blocks: ProviderContentBlock[] = []

          if (msg.content) {
            blocks.push({ type: 'text', text: msg.content })
          }

          for (const tc of msg.toolCalls) {
            blocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            })
          }

          providerMessages.push({ role: 'assistant', content: blocks })
        } else {
          providerMessages.push({ role: 'assistant', content: msg.content })
        }
        continue
      }
    }

    return providerMessages
  }

  return {
    // State
    sessions,
    // Session management
    createSession,
    getSession,
    clearSession,
    deleteSession,
    // Messaging
    sendMessage,
    cancelStream,
    // Configuration
    setApprovalHandler,
    setWorkspacePath,
  }
}
