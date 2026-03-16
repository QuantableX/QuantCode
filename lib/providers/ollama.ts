import { BaseProvider } from './base'
import type { ProviderMessage, ProviderOptions, StreamChunk, MCPTool } from '../../shared/types'

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OllamaTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OllamaStreamResponse {
  model: string
  created_at: string
  message?: {
    role: string
    content: string
    tool_calls?: Array<{
      function: {
        name: string
        arguments: Record<string, unknown>
      }
    }>
  }
  done: boolean
  done_reason?: string
}

const FALLBACK_MODELS = ['llama3.2', 'codellama', 'mistral', 'deepseek-coder']

export class OllamaProvider extends BaseProvider {
  private _cachedModels: string[] | null = null

  constructor(apiKey?: string, baseUrl?: string) {
    // Ollama doesn't require an API key
    super(apiKey || '', baseUrl || 'http://localhost:11434')
  }

  get models(): string[] {
    return this._cachedModels || FALLBACK_MODELS
  }

  protected formatTool(tool: MCPTool): OllamaTool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }
  }

  async fetchModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`)
      if (!response.ok) {
        return FALLBACK_MODELS
      }

      const data = await response.json() as { models?: Array<{ name: string }> }
      if (data.models && data.models.length > 0) {
        this._cachedModels = data.models.map(m => m.name)
        return this._cachedModels
      }

      return FALLBACK_MODELS
    } catch {
      return FALLBACK_MODELS
    }
  }

  async chat(messages: ProviderMessage[], options: ProviderOptions): Promise<void> {
    const ollamaMessages = this.convertMessages(messages)

    const body: Record<string, unknown> = {
      model: options.model,
      messages: ollamaMessages,
      stream: true,
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = this.convertToolsToFormat(options.tools)
    }

    // Ollama uses options for temperature etc.
    const ollamaOptions: Record<string, unknown> = {}
    if (options.temperature !== undefined) {
      ollamaOptions.temperature = options.temperature
    }
    if (options.maxTokens) {
      ollamaOptions.num_predict = options.maxTokens
    }
    if (Object.keys(ollamaOptions).length > 0) {
      body.options = ollamaOptions
    }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      options.onStream?.({
        type: 'error',
        error: `Ollama connection error: ${message}. Is Ollama running on ${this.baseUrl}?`,
      })
      return
    }

    if (!response.ok) {
      const errorText = await response.text()
      options.onStream?.({
        type: 'error',
        error: `Ollama API error (${response.status}): ${errorText}`,
      })
      return
    }

    // Ollama uses newline-delimited JSON, not SSE
    await this.streamNDJSON(response, options)
  }

  private convertMessages(messages: ProviderMessage[]): OllamaMessage[] {
    return messages.map(msg => {
      let content: string
      if (typeof msg.content === 'string') {
        content = msg.content
      } else {
        content = msg.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n')
      }

      return {
        role: msg.role,
        content,
      }
    })
  }

  private async streamNDJSON(response: Response, options: ProviderOptions): Promise<void> {
    const reader = response.body?.getReader()
    if (!reader) {
      options.onStream?.({ type: 'error', error: 'No response body from Ollama' })
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let toolCallCounter = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          let parsed: OllamaStreamResponse
          try {
            parsed = JSON.parse(trimmed)
          } catch {
            continue
          }

          // Handle text content
          if (parsed.message?.content) {
            options.onStream?.({ type: 'text', text: parsed.message.content })
          }

          // Handle tool calls
          if (parsed.message?.tool_calls) {
            for (const tc of parsed.message.tool_calls) {
              const toolCallId = `ollama_tc_${toolCallCounter++}`

              options.onStream?.({
                type: 'tool_use_start',
                toolCall: {
                  id: toolCallId,
                  name: tc.function.name,
                  arguments: {},
                  status: 'pending',
                },
              })

              options.onStream?.({
                type: 'tool_use_end',
                toolCall: {
                  id: toolCallId,
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                  status: 'pending',
                },
              })
            }
          }

          // Handle done
          if (parsed.done) {
            options.onStream?.({ type: 'done' })
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const parsed: OllamaStreamResponse = JSON.parse(buffer.trim())
          if (parsed.message?.content) {
            options.onStream?.({ type: 'text', text: parsed.message.content })
          }
          if (parsed.done) {
            options.onStream?.({ type: 'done' })
          }
        } catch {
          // Partial JSON at end, ignore
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stream read failed'
      options.onStream?.({ type: 'error', error: message })
    } finally {
      reader.releaseLock()
    }
  }
}
