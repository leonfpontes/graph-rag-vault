// The real provider against a fake fetch: the request it sends, the response it returns and the
// retries. Nothing here reaches the network.
import { describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  costMicros,
  createAnthropicProvider,
  DEFAULT_ALLOWED_MODELS,
  PRICES,
  ratesFor,
  retryDelay,
  type ModelRequest,
  type TokenUsage,
} from './index.js'

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const fail = (status: number, headers: Record<string, string> = {}) =>
  new Response(
    JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
    {
      status,
      headers,
    },
  )

const reply = (model: string) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model,
  content: [
    { type: 'tool_use', id: 'toolu_1', name: 'submit_answer', input: { answerable: false, sentences: [] } },
  ],
  stop_reason: 'tool_use',
  usage: {
    input_tokens: 120,
    output_tokens: 30,
    cache_read_input_tokens: 900,
    cache_creation_input_tokens: null,
  },
})

const REQ: ModelRequest = {
  model: 'claude-haiku-5-5',
  system: 'Answer from the passages.',
  messages: [
    { role: 'user', content: 'Q' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_0', name: 'submit_answer', input: {} }] },
    {
      role: 'user',
      content: [{ type: 'tool_result', toolUseId: 'toolu_0', content: 'Invalid answer', isError: true }],
    },
  ],
  tools: [{ name: 'submit_answer', description: 'Submit.', inputSchema: { type: 'object' } }],
  maxTokens: 1000,
}

function provider(responses: (Response | Error)[], extra: { maxRetries?: number } = {}) {
  const fetch = vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    if (next instanceof Error) throw next
    return next
  })
  const sleep = vi.fn(async () => {})
  return { fetch, sleep, p: createAnthropicProvider({ apiKey: 'test-key', fetch, sleep, ...extra }) }
}

describe('createAnthropicProvider', () => {
  it('sends a Messages API request: tools, tool results, effort, caching and the headers', async () => {
    const { fetch, p } = provider([ok(reply('claude-haiku-5-5'))])
    const response = await p.complete(REQ)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers).toMatchObject({ 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' })
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 1000,
      system: 'Answer from the passages.',
      messages: [
        { role: 'user', content: 'Q' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_0', name: 'submit_answer', input: {} }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_0', content: 'Invalid answer', is_error: true },
          ],
        },
      ],
      tools: [{ name: 'submit_answer', description: 'Submit.', input_schema: { type: 'object' } }],
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
    })
    expect(response).toEqual({
      model: 'claude-haiku-5-5',
      content: reply('claude-haiku-5-5').content,
      stopReason: 'tool_use',
      usage: { inputTokens: 120, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 30 },
    })
  })

  it('sends no effort to a model that has no setting, and no tools when there are none', async () => {
    const { fetch, p } = provider([ok(reply('claude-haiku-4-5-20251001'))])
    await p.complete({ ...REQ, model: 'claude-haiku-4-5-20251001', tools: [] })
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).not.toHaveProperty('output_config')
    expect(body).not.toHaveProperty('tools')
  })

  it('retries overloads, rate limits and network errors, honouring retry-after', async () => {
    const { fetch, sleep, p } = provider([
      fail(529),
      fail(429, { 'retry-after': '7' }),
      new TypeError('fetch failed'),
      ok(reply('claude-haiku-5-5')),
    ])
    await p.complete(REQ)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(sleep.mock.calls[1]).toEqual([7000])
  })

  it('throws after the last retry, so the caller can move to the fallback', async () => {
    const { fetch, p } = provider([fail(529), fail(529), fail(529)], { maxRetries: 2 })
    await expect(p.complete(REQ)).rejects.toThrow('529 overloaded_error: Overloaded (after 3 attempts)')
    expect(fetch).toHaveBeenCalledTimes(3)
    const network = provider([new TypeError('fetch failed')], { maxRetries: 0 })
    await expect(network.p.complete(REQ)).rejects.toThrow('network error: fetch failed (after 1 attempts)')
  })

  it('does not retry a request the API refuses, or one the server says not to retry', async () => {
    const bad = provider([fail(400), ok(reply('claude-haiku-5-5'))])
    const error = await bad.p.complete(REQ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, retryable: false })
    expect(bad.fetch).toHaveBeenCalledTimes(1)
    const told = provider([fail(503, { 'x-should-retry': 'false' })])
    await expect(told.p.complete(REQ)).rejects.toMatchObject({ status: 503 })
    const plain = provider([new Response('gateway broke', { status: 400 })])
    await expect(plain.p.complete(REQ)).rejects.toThrow('400 gateway broke')
  })

  it('refuses a model outside the cost allowlist, Sonnet included, and a missing key, before any call', async () => {
    const { fetch, p } = provider([ok(reply('x'))])
    await expect(p.complete({ ...REQ, model: 'claude-sonnet-5-5' })).rejects.toThrow(
      'not in the allowed models',
    )
    const custom = createAnthropicProvider({ apiKey: 'k', fetch, allowedModels: ['claude-haiku-5-5'] })
    await expect(custom.complete({ ...REQ, model: 'claude-haiku-4-5-20251001' })).rejects.toThrow(
      'not in the allowed models (claude-haiku-5-5)',
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(() => createAnthropicProvider({ apiKey: '' })).toThrow('ANTHROPIC_API_KEY is missing')
    expect(DEFAULT_ALLOWED_MODELS).toEqual(Object.keys(PRICES))
    expect(DEFAULT_ALLOWED_MODELS.join(' ')).not.toMatch(/sonnet/)
  })

  it('waits exponentially with jitter, capped at 30 s', () => {
    expect(retryDelay(0, null, () => 0)).toBe(500)
    expect(retryDelay(2, null, () => 1)).toBe(4000)
    expect(retryDelay(10, null, () => 1)).toBe(30_000)
    expect(retryDelay(0, '120')).toBe(30_000)
    expect(retryDelay(0, 'soon', () => 0)).toBe(500)
  })
})

describe('pricing', () => {
  const usage = (u: Partial<TokenUsage>): TokenUsage => ({
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    ...u,
  })

  it('prices Claude Haiku 5.5 per token type, in micros', () => {
    // 10k input × $0.10 + 20k cache write × $0.125 + 50k cache read × $0.01 + 2k output × $0.50
    expect(
      costMicros(
        'claude-haiku-5-5',
        usage({
          inputTokens: 10_000,
          cacheWriteTokens: 20_000,
          cacheReadTokens: 50_000,
          outputTokens: 2_000,
        }),
      ),
    ).toBe(1000 + 2500 + 500 + 1000)
  })

  it('moves a Haiku 5.5 request over 100k prompt tokens to the long-prompt tier, just past the line', () => {
    expect(ratesFor('claude-haiku-5-5', usage({ inputTokens: 100_000 })).input).toBe(0.1)
    expect(ratesFor('claude-haiku-5-5', usage({ inputTokens: 1, cacheReadTokens: 100_000 })).input).toBe(0.5)
  })

  it('prices the fallback by its dated id, and refuses a model with no price', () => {
    expect(costMicros('claude-haiku-4-5-20251001', usage({ inputTokens: 1_000, outputTokens: 1_000 }))).toBe(
      6_000,
    )
    expect(costMicros('claude-haiku-5-5-20261001', usage({ outputTokens: 1_000 }))).toBe(500)
    expect(() => costMicros('claude-unknown', usage({}))).toThrow('No price for the model "claude-unknown"')
  })
})
