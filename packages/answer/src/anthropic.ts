// The real ModelProvider: POST /v1/messages with fetch (one endpoint, so no SDK). It retries what can
// pass on a second try (408, 409, 429, 5xx, 529 = overloaded, network errors), honouring the
// server's retry-after, and throws when the retries run out, so the caller can move to the fallback
// model. A wrong request (400, 401, 403, 404, 413) throws at once.
import { PRICES } from './pricing.js'
import type {
  ContentBlock,
  Message,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ToolResultBlock,
} from './provider.js'

export const API_URL = 'https://api.anthropic.com/v1/messages'
export const API_VERSION = '2023-06-01'

/** Per-model request settings. Models not listed get the API defaults. */
export const MODEL_SETTINGS: Readonly<Record<string, { effort?: 'low' | 'medium' | 'high' }>> = {
  'claude-haiku-5-5': { effort: 'medium' },
}

/**
 * The cost allowlist: the models a call may use. By default the light models priced in PRICES; a
 * model outside it is refused before any call, so a typo or a larger model can't reach the bill.
 */
export const DEFAULT_ALLOWED_MODELS: readonly string[] = Object.keys(PRICES)

export function assertAllowedModel(model: string, allowed: readonly string[] = DEFAULT_ALLOWED_MODELS): void {
  if (!allowed.includes(model))
    throw new Error(
      `The model "${model}" is not in the allowed models (${allowed.join(', ')}). Add it to allowedModels and to PRICES to use it.`,
    )
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
    readonly retryAfter: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface AnthropicOptions {
  apiKey: string
  fetch?: typeof fetch
  /** Retries after the first attempt (default 3). */
  maxRetries?: number
  /** Waits between attempts; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  url?: string
  allowedModels?: readonly string[]
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529])
const MAX_DELAY_MS = 30_000

/** Wait before retry `attempt` (0-based): the server's retry-after, else exponential with jitter. */
export function retryDelay(attempt: number, retryAfter: string | null, random = Math.random): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_DELAY_MS)
  const base = Math.min(1000 * 2 ** attempt, MAX_DELAY_MS)
  return base / 2 + random() * (base / 2)
}

interface ApiResponse {
  model: string
  content: ContentBlock[]
  stop_reason: string
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number | null
    cache_creation_input_tokens?: number | null
  }
}

const toApiBlock = (b: ContentBlock | ToolResultBlock) =>
  b.type === 'tool_result'
    ? {
        type: 'tool_result',
        tool_use_id: b.toolUseId,
        content: b.content,
        ...(b.isError ? { is_error: true } : {}),
      }
    : b

const toApiMessage = (m: Message) => ({
  role: m.role,
  content: typeof m.content === 'string' ? m.content : m.content.map(toApiBlock),
})

/** The Messages API body for one request. */
export function toApiRequest(request: ModelRequest) {
  const effort = MODEL_SETTINGS[request.model]?.effort
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: request.messages.map(toApiMessage),
    ...(request.tools.length
      ? {
          tools: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema,
          })),
        }
      : {}),
    ...(effort ? { output_config: { effort } } : {}),
    // Automatic prompt caching: the instructions repeat on every question.
    cache_control: { type: 'ephemeral' },
  }
}

export function fromApiResponse(body: ApiResponse): ModelResponse {
  return {
    model: body.model,
    content: body.content,
    stopReason: body.stop_reason,
    usage: {
      inputTokens: body.usage.input_tokens,
      cacheReadTokens: body.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: body.usage.cache_creation_input_tokens ?? 0,
      outputTokens: body.usage.output_tokens,
    },
  }
}

function readError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string; message?: string } }
    if (parsed.error) return `${parsed.error.type ?? 'error'}: ${parsed.error.message ?? ''}`.trim()
  } catch {
    // not JSON: fall through
  }
  return body.slice(0, 200)
}

export function createAnthropicProvider(options: AnthropicOptions): ModelProvider {
  if (!options.apiKey) throw new Error('ANTHROPIC_API_KEY is missing: generated answers need a key.')
  const doFetch = options.fetch ?? fetch
  const maxRetries = options.maxRetries ?? 3
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const timeoutMs = options.timeoutMs ?? 120_000
  const url = options.url ?? API_URL

  return {
    async complete(request) {
      assertAllowedModel(request.model, options.allowedModels)
      const body = JSON.stringify(toApiRequest(request))
      let last: ApiError | undefined
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) await sleep(retryDelay(attempt - 1, last?.retryAfter ?? null))
        let response: Response
        try {
          response = await doFetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': options.apiKey,
              'anthropic-version': API_VERSION,
            },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          })
        } catch (error) {
          last = new ApiError(`network error: ${(error as Error).message}`, undefined, true)
          continue
        }
        if (response.ok) return fromApiResponse((await response.json()) as ApiResponse)
        const detail = readError(await response.text())
        const retryable = RETRYABLE.has(response.status) && response.headers.get('x-should-retry') !== 'false'
        last = new ApiError(
          `${response.status} ${detail}`,
          response.status,
          retryable,
          response.headers.get('retry-after'),
        )
        if (!retryable) throw last
      }
      throw new ApiError(
        `${last?.message ?? 'no attempt was made'} (after ${maxRetries + 1} attempts)`,
        last?.status,
        false,
      )
    },
  }
}
