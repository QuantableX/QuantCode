import { BaseProvider } from './base'
import type { ProviderMessage, ProviderOptions, StreamChunk, MCPTool } from '../../shared/types'

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export class OpenAIProvider extends BaseProvider {
  private _activeToolCalls: Map<number, { id: string; name: string; args: string }> = new Map()

  constructor(apiKey: string, baseUrl?: string) {
    super(apiKey, baseUrl || 'https://api.openai.com')
  }

  get models(): string[] {
    return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini']
  }

  protected formatTool(tool: MCPTool): OpenAITool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }
  }

  async chat(messages: ProviderMessage[], options: ProviderOptions): Promise<void> {
    const openaiMessages = this.convertMessages(messages)

    const body: Record<string, unknown> = {
      model: options.model,
      messages: openaiMessages,
      stream: true,
    }

    if (options.maxTokens) {
      body.max_tokens = options.maxTokens
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = this.convertToolsToFormat(options.tools)
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage: string
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.error?.message || errorText
      } catch {
        errorMessage = errorText
      }
      options.onStream?.({
        type: 'error',
        error: `OpenAI API error (${response.status}): ${errorMessage}`,
      })
      return
    }

    this._activeToolCalls.clear()

    await this.streamResponse(response, options, (line, onStream) => {
      this.parseSSELine(line, onStream)
    })
  }

  private convertMessages(messages: ProviderMessage[]): OpenAIMessage[] {
    return messages.map(msg => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role,
          content: msg.content,
        } as OpenAIMessage
      }

      // Handle content blocks
      const textParts = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
      const toolUseParts = msg.content.filter(b => b.type === 'tool_use')
      const toolResultParts = msg.content.filter(b => b.type === 'tool_result')

      // If this is a tool result message
      if (toolResultParts.length > 0) {
        return {
          role: 'tool' as const,
          content: toolResultParts[0].content ?? '',
          tool_call_id: toolResultParts[0].tool_use_id,
        }
      }

      // If this message contains tool_use blocks (assistant message with tool calls)
      if (toolUseParts.length > 0) {
        return {
          role: 'assistant' as const,
          content: textParts || null,
          tool_calls: toolUseParts.map(tc => ({
            id: tc.id!,
            type: 'function' as const,
            function: {
              name: tc.name!,
              arguments: JSON.stringify(tc.input || {}),
            },
          })),
        }
      }

      return {
        role: msg.role,
        content: textParts,
      } as OpenAIMessage
    })
  }

  private parseSSELine(line: string, onStream: (chunk: StreamChunk) => void): void {
    if (!line.startsWith('data: ')) return

    const data = line.slice(6).trim()
    if (data === '[DONE]') {
      // Flush any pending tool calls
      this.flushToolCalls(onStream)
      onStream({ type: 'done' })
      return
    }

    let event: Record<string, unknown>
    try {
      event = JSON.parse(data)
    } catch {
      return
    }

    const choices = event.choices as Array<Record<string, unknown>> | undefined
    if (!choices || choices.length === 0) return

    const choice = choices[0]
    const delta = choice.delta as Record<string, unknown> | undefined
    const finishReason = choice.finish_reason as string | null

    if (delta) {
      // Text content
      const content = delta.content as string | undefined
      if (content) {
        onStream({ type: 'text', text: content })
      }

      // Tool calls
      const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined
      if (toolCalls) {
        for (const tc of toolCalls) {
          const index = tc.index as number
          const fn = tc.function as Record<string, unknown> | undefined

          if (!this._activeToolCalls.has(index)) {
            // Start of a new tool call
            const id = (tc.id as string) || ''
            const name = (fn?.name as string) || ''
            this._activeToolCalls.set(index, { id, name, args: '' })

            onStream({
              type: 'tool_use_start',
              toolCall: {
                id,
                name,
                arguments: {},
                status: 'pending',
              },
            })
          }

          // Accumulate arguments
          const argsChunk = fn?.arguments as string | undefined
          if (argsChunk) {
            const active = this._activeToolCalls.get(index)!
            active.args += argsChunk

            onStream({
              type: 'tool_use_delta',
              toolCall: {
                id: active.id,
                name: active.name,
              },
              text: argsChunk,
            })
          }
        }
      }
    }

    if (finishReason === 'tool_calls') {
      this.flushToolCalls(onStream)
    } else if (finishReason === 'stop') {
      this.flushToolCalls(onStream)
      onStream({ type: 'done' })
    }
  }

  private flushToolCalls(onStream: (chunk: StreamChunk) => void): void {
    for (const [, tc] of this._activeToolCalls) {
      let parsedArgs: Record<string, unknown> = {}
      try {
        if (tc.args) {
          parsedArgs = JSON.parse(tc.args)
        }
      } catch {
        parsedArgs = { _raw: tc.args }
      }

      onStream({
        type: 'tool_use_end',
        toolCall: {
          id: tc.id,
          name: tc.name,
          arguments: parsedArgs,
          status: 'pending',
        },
      })
    }
    this._activeToolCalls.clear()
  }
}
