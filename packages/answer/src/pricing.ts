// Prices in USD per million tokens, so a cost in micros (USD millionths) is tokens × price.
// Source: https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-26).
import type { TokenUsage } from './provider.js'

export interface Rates {
  input: number
  /** 5-minute cache write. */
  cacheWrite: number
  cacheRead: number
  output: number
}

export interface ModelPrice extends Rates {
  /** A higher tier for requests whose prompt (input + cache read + cache write) is over `tokens`. */
  longPrompt?: Rates & { tokens: number }
}

export const PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-haiku-5-5': {
    input: 0.1,
    cacheWrite: 0.125,
    cacheRead: 0.01,
    output: 0.5,
    longPrompt: { tokens: 100_000, input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 },
  },
  'claude-haiku-4-5-20251001': { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
}

export const promptTokens = (u: TokenUsage) => u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens

/** The price of a model, also when the API answers with a dated id for an alias (`<alias>-YYYYMMDD`). */
export function priceOf(model: string): ModelPrice | undefined {
  return PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, '')]
}

/** The rates one request pays: each request is priced on its own prompt length. */
export function ratesFor(model: string, usage: TokenUsage): Rates {
  const price = priceOf(model)
  // An unknown model would cost 0 and slip past every budget: refuse it instead.
  if (!price) throw new Error(`No price for the model "${model}". Add it to PRICES in pricing.ts.`)
  return price.longPrompt && promptTokens(usage) > price.longPrompt.tokens ? price.longPrompt : price
}

/** The cost of one call in micros. */
export function costMicros(model: string, usage: TokenUsage): number {
  const r = ratesFor(model, usage)
  return Math.round(
    usage.inputTokens * r.input +
      usage.cacheWriteTokens * r.cacheWrite +
      usage.cacheReadTokens * r.cacheRead +
      usage.outputTokens * r.output,
  )
}
