// The one door to a language model. The answer code knows only this interface; the real client is
// in anthropic.ts and the tests use a scripted provider that never calls an API.

export interface TokenUsage {
  /** Input tokens not read from the cache. */
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  /** Other blocks (thinking) are kept so a follow-up turn sends the answer back unchanged. */
  | { type: 'thinking' | 'redacted_thinking'; [key: string]: unknown }

export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: string
  isError?: boolean
}

export interface Message {
  role: 'user' | 'assistant'
  content: string | (ContentBlock | ToolResultBlock)[]
}

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema of the input. */
  inputSchema: Record<string, unknown>
}

export interface ModelRequest {
  model: string
  system: string
  messages: Message[]
  tools: ToolSpec[]
  maxTokens: number
}

export interface ModelResponse {
  /** The model that answered (the API may return a dated id for an alias). */
  model: string
  content: ContentBlock[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'refusal' | (string & {})
  usage: TokenUsage
}

export interface ModelProvider {
  /** One model call. Throws when the call fails after the provider's own retries. */
  complete(request: ModelRequest): Promise<ModelResponse>
}

export type ScriptedTurn = ModelResponse | Error

/** A provider that answers from a script, in order, and records every request. For tests. */
export function scriptedProvider(turns: ScriptedTurn[]): ModelProvider & { requests: ModelRequest[] } {
  const queue = [...turns]
  const requests: ModelRequest[] = []
  return {
    requests,
    async complete(request) {
      requests.push(request)
      const next = queue.shift()
      if (!next) throw new Error('The scripted provider has no more turns.')
      if (next instanceof Error) throw next
      return next
    },
  }
}
