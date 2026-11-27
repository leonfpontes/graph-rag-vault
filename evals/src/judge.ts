// The faithfulness judge: a model reads each sentence of an answer with the passages it cites and
// says whether they support it. The quote check in @graph-rag/answer proves the cited words exist;
// the judge says whether those passages back what the sentence claims. A sample of its verdicts is
// checked by a person, and the agreement (Cohen's kappa) is published with the score.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import {
  costMicros,
  type AnswerResult,
  type ContentBlock,
  type Message,
  type ModelProvider,
  type ModelResponse,
  type Passage,
  type TokenUsage,
  type ToolSpec,
} from '@graph-rag/answer'

export const JUDGE_PROMPT_FILE = new URL('../prompts/judge.md', import.meta.url)
export const readJudgePrompt = () => readFileSync(JUDGE_PROMPT_FILE, 'utf8').trim()
export const judgePromptVersion = (prompt: string) =>
  createHash('sha256').update(prompt).digest('hex').slice(0, 12)

/** The judge runs on the answer model by default; a larger one only by decision (kappa < 0.8). */
export const JUDGE_MODELS = { primary: 'claude-haiku-5-5', fallback: 'claude-haiku-4-5-20251001' } as const

export const VERDICTS = ['supported', 'partial', 'unsupported'] as const
export type Verdict = (typeof VERDICTS)[number]

/** Points of a verdict in the faithfulness score. */
export const VERDICT_SCORE: Readonly<Record<Verdict, number>> = { supported: 1, partial: 0.5, unsupported: 0 }

export interface SentenceVerdict {
  verdict: Verdict
  reason: string
}

export interface JudgeResult {
  verdicts: SentenceVerdict[]
  model: string | null
  calls: number
  usage: TokenUsage
  costMicros: number
}

export const VERDICT_TOOL: ToolSpec = {
  name: 'submit_verdicts',
  description: 'Submit one verdict per sentence, in order.',
  inputSchema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sentence: { type: 'integer', description: 'Sentence number, from 1.' },
            verdict: { type: 'string', enum: [...VERDICTS] },
            reason: { type: 'string', description: 'At most 20 words.' },
          },
          required: ['sentence', 'verdict', 'reason'],
        },
      },
    },
    required: ['verdicts'],
  },
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The judge's input: the question, then each sentence with the full text of the passages it cites. */
export function judgeMessage(
  question: string,
  answer: Pick<AnswerResult, 'sentences'>,
  passages: readonly Passage[],
): string {
  const byChunk = new Map(passages.map((p) => [p.chunkId, p]))
  const blocks = answer.sentences.map((s, i) => {
    const cited = [...new Set(s.citations.map((c) => c.chunkId))].map((id) => {
      const p = byChunk.get(id)
      if (!p) throw new Error(`Sentence ${i + 1} cites ${id}, which is not among the passages.`)
      return `<passage note="${escape(p.noteId)}" title="${escape(p.title)}" updated="${escape(p.updated)}"${p.status ? ` status="${escape(p.status)}"` : ''}>\n${p.text.trim()}\n</passage>`
    })
    return `<sentence n="${i + 1}">\n<text>${escape(s.text)}</text>\n${cited.join('\n')}\n</sentence>`
  })
  return `<question>${escape(question)}</question>\n\n${blocks.join('\n\n')}`
}

function readVerdicts(input: unknown, count: number): SentenceVerdict[] | string {
  const list = (input as { verdicts?: unknown } | null)?.verdicts
  if (!Array.isArray(list)) return '`verdicts` must be a list.'
  if (list.length !== count) return `Give exactly ${count} verdicts, one per sentence (got ${list.length}).`
  const out: SentenceVerdict[] = []
  for (let i = 0; i < count; i++) {
    const v = list[i] as { sentence?: unknown; verdict?: unknown; reason?: unknown }
    if (v?.sentence !== i + 1) return `Verdict ${i + 1} must be for sentence ${i + 1}.`
    if (!(VERDICTS as readonly unknown[]).includes(v.verdict))
      return `Verdict ${i + 1} must be one of ${VERDICTS.join(', ')}.`
    out.push({ verdict: v.verdict as Verdict, reason: typeof v.reason === 'string' ? v.reason.trim() : '' })
  }
  return out
}

export interface JudgeOptions {
  question: string
  answer: Pick<AnswerResult, 'sentences'>
  passages: readonly Passage[]
  provider: ModelProvider
  models?: { primary: string; fallback?: string }
  prompt?: string
  maxTokens?: number
}

const NO_USAGE: TokenUsage = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }

export async function judgeAnswer(options: JudgeOptions): Promise<JudgeResult> {
  const result: JudgeResult = { verdicts: [], model: null, calls: 0, usage: NO_USAGE, costMicros: 0 }
  const count = options.answer.sentences.length
  if (count === 0) return result
  const prompt = options.prompt ?? readJudgePrompt()
  const models = options.models ?? JUDGE_MODELS
  let model = models.primary

  const call = async (messages: Message[]): Promise<ModelResponse> => {
    const request = {
      model,
      system: prompt,
      messages: [...messages],
      tools: [VERDICT_TOOL],
      maxTokens: options.maxTokens ?? 4_000,
    }
    let response: ModelResponse
    try {
      response = await options.provider.complete(request)
    } catch (error) {
      if (!models.fallback || model === models.fallback) throw error
      model = models.fallback
      response = await options.provider.complete({ ...request, model })
    }
    result.calls++
    result.model = response.model
    const u = response.usage
    result.usage = {
      inputTokens: result.usage.inputTokens + u.inputTokens,
      cacheReadTokens: result.usage.cacheReadTokens + u.cacheReadTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens + u.cacheWriteTokens,
      outputTokens: result.usage.outputTokens + u.outputTokens,
    }
    result.costMicros += costMicros(response.model, u)
    return response
  }

  const messages: Message[] = [
    { role: 'user', content: judgeMessage(options.question, options.answer, options.passages) },
  ]
  for (let turn = 0; turn < 2; turn++) {
    const response = await call(messages)
    const use = response.content.find(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> =>
        b.type === 'tool_use' && b.name === VERDICT_TOOL.name,
    )
    const read = use ? readVerdicts(use.input, count) : undefined
    if (read && typeof read !== 'string') {
      result.verdicts = read
      return result
    }
    if (turn === 1) break
    messages.push({ role: 'assistant', content: response.content })
    messages.push({
      role: 'user',
      content: use
        ? [{ type: 'tool_result', toolUseId: use.id, content: `Invalid verdicts: ${read}`, isError: true }]
        : `Reply by calling the ${VERDICT_TOOL.name} tool.`,
    })
  }
  throw new Error(`${result.model ?? model} did not submit valid verdicts after a reminder.`)
}

/** Faithfulness of a set of verdicts: supported 1, partial 0.5, unsupported 0; undefined when empty. */
export function faithfulness(verdicts: readonly Verdict[]): number | undefined {
  if (verdicts.length === 0) return undefined
  return verdicts.reduce((sum, v) => sum + VERDICT_SCORE[v], 0) / verdicts.length
}

/** Agreement between two raters on the same items: the share of equal labels and Cohen's kappa. */
export function agreement(
  a: readonly Verdict[],
  b: readonly Verdict[],
): { items: number; observed: number; kappa: number | undefined } {
  if (a.length !== b.length) throw new Error(`The raters labelled ${a.length} and ${b.length} items.`)
  const n = a.length
  if (n === 0) return { items: 0, observed: 0, kappa: undefined }
  const observed = a.filter((x, i) => x === b[i]).length / n
  const expected = VERDICTS.reduce(
    (sum, v) => sum + (a.filter((x) => x === v).length / n) * (b.filter((x) => x === v).length / n),
    0,
  )
  // Both raters used one label for everything: kappa is undefined, agreement says it all.
  const kappa = expected === 1 ? undefined : (observed - expected) / (1 - expected)
  return { items: n, observed, kappa }
}
