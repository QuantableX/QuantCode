import type { ProviderMessage, ProviderOptions, StreamChunk, MCPTool } from '../../shared/types'

export abstract class BaseProvider {
  protected apiKey: string
  protected baseUrl: string

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
  }

  abstract chat(messages: ProviderMessage[], options: ProviderOptions): Promise<void>
  abstract get models(): string[]

  protected async streamResponse(
    response: Response,
    options: ProviderOptions,
    parser: (line: string, onStream: (chunk: StreamChunk) => void) => void,
  ): Promise<void> {
    const reader = response.body?.getReader()
    if (!reader) {
      options.onStream?.({ type: 'error', error: 'No response body' })
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // Keep the last partial line in the buffer
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          if (options.onStream) {
            parser(trimmed, options.onStream)
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim() && options.onStream) {
        parser(buffer.trim(), options.onStream)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stream read failed'
      options.onStream?.({ type: 'error', error: message })
    } finally {
      reader.releaseLock()
    }
  }

  protected convertToolsToFormat(tools: MCPTool[] | undefined): unknown[] {
    return tools?.map(tool => this.formatTool(tool)) ?? []
  }

  protected abstract formatTool(tool: MCPTool): unknown
}
