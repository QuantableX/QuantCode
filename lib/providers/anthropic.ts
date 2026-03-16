import { BaseProvider } from './base'
import type { ProviderMessage, ProviderOptions, StreamChunk, MCPTool } from '../../shared/types'

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
  is_error?: boolean
}

interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export class AnthropicProvider extends BaseProvider {
  private _currentToolCallId: string | null = null
  private _currentToolCallName: string | null = null
  private _currentToolInputJson: string = ''

  constructor(apiKey: string, baseUrl?: string) {
    super(apiKey, baseUrl || 'https://api.anthropic.com')
  }

  get models(): string[] {
    return ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414', 'claude-opus-4-20250414']
  }

  protected formatTool(tool: MCPTool): AnthropicTool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }
  }

  async chat(messages: ProviderMessage[], options: ProviderOptions): Promise<void> {
    const anthropicMessages = this.convertMessages(messages)
    const systemMessage = this.extractSystemMessage(messages)

    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens || 4096,
      messages: anthropicMessages,
      stream: true,
    }

    if (systemMessage) {
      body.system = systemMessage
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = this.convertToolsToFormat(options.tools)
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
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
        error: `Anthropic API error (${response.status}): ${errorMessage}`,
      })
      return
    }

    this._currentToolCallId = null
    this._currentToolCallName = null
    this._currentToolInputJson = ''

    await this.streamResponse(response, options, (line, onStream) => {
      this.parseSSELine(line, onStream)
    })
  }

  private convertMessages(messages: ProviderMessage[]): AnthropicMessage[] {
    return messages
      .filter(m => m.role !== 'system')
      .map(msg => {
        if (typeof msg.content === 'string') {
          return {
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
          }
        }

        const blocks: AnthropicContentBlock[] = msg.content.map(block => {
          if (block.type === 'text') {
            return { type: 'text' as const, text: block.text }
          }
          if (block.type === 'tool_use') {
            return {
              type: 'tool_use' as const,
              id: block.id,
              name: block.name,
              input: block.input,
            }
          }
          if (block.type === 'tool_result') {
            return {
              type: 'tool_result' as const,
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: block.is_error,
            }
          }
          return { type: 'text' as const, text: block.text }
        })

        return {
          role: msg.role as 'user' | 'assistant',
          content: blocks,
        }
      })
  }

  private extractSystemMessage(messages: ProviderMessage[]): string | undefined {
    const systemMsg = messages.find(m => m.role === 'system')
    if (!systemMsg) return undefined

    if (typeof systemMsg.content === 'string') {
      return systemMsg.content
    }

    return systemMsg.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
  }

  private parseSSELine(line: string, onStream: (chunk: StreamChunk) => void): void {
    if (!line.startsWith('data: ')) return

    const data = line.slice(6)
    if (data === '[DONE]') {
      onStream({ type: 'done' })
      return
    }

    let event: Record<string, unknown>
    try {
      event = JSON.parse(data)
    } catch {
      return
    }

    const eventType = event.type as string

    switch (eventType) {
      case 'message_start':
        // Initial message metadata -- nothing to emit
        break

      case 'content_block_start': {
        const contentBlock = event.content_block as Record<string, unknown> | undefined
        if (contentBlock?.type === 'tool_use') {
          this._currentToolCallId = contentBlock.id as string
          this._currentToolCallName = contentBlock.name as string
          this._currentToolInputJson = ''
          onStream({
            type: 'tool_use_start',
            toolCall: {
              id: this._currentToolCallId,
              name: this._currentToolCallName,
              arguments: {},
              status: 'pending',
            },
          })
        }
        break
      }

      case 'content_block_delta': {
        const delta = event.delta as Record<string, unknown> | undefined
        if (!delta) break

        if (delta.type === 'text_delta') {
          onStream({ type: 'text', text: delta.text as string })
        } else if (delta.type === 'input_json_delta') {
          this._currentToolInputJson += delta.partial_json as string
          onStream({
            type: 'tool_use_delta',
            toolCall: {
              id: this._currentToolCallId ?? undefined,
              name: this._currentToolCallName ?? undefined,
            },
            text: delta.partial_json as string,
          })
        }
        break
      }

      case 'content_block_stop': {
        if (this._currentToolCallId) {
          let parsedArgs: Record<string, unknown> = {}
          try {
            if (this._currentToolInputJson) {
              parsedArgs = JSON.parse(this._currentToolInputJson)
            }
          } catch {
            parsedArgs = { _raw: this._currentToolInputJson }
          }

          onStream({
            type: 'tool_use_end',
            toolCall: {
              id: this._currentToolCallId,
              name: this._currentToolCallName ?? undefined,
              arguments: parsedArgs,
              status: 'pending',
            },
          })

          this._currentToolCallId = null
          this._currentToolCallName = null
          this._currentToolInputJson = ''
        }
        break
      }

      case 'message_delta': {
        const delta = event.delta as Record<string, unknown> | undefined
        if (delta?.stop_reason === 'end_turn' || delta?.stop_reason === 'stop_sequence') {
          onStream({ type: 'done' })
        }
        // stop_reason === 'tool_use' is handled via content_block_stop
        break
      }

      case 'message_stop':
        onStream({ type: 'done' })
        break

      case 'ping':
        // Keep-alive, ignore
        break

      case 'error': {
        const errorData = event.error as Record<string, unknown> | undefined
        onStream({
          type: 'error',
          error: (errorData?.message as string) || 'Unknown Anthropic stream error',
        })
        break
      }
    }
  }
}
