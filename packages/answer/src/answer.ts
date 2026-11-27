// An answer made only of what the search found. The model gets the passages and must reply with the
// `submit_answer` tool: short sentences, each naming its passages and quoting them. Then the code
// checks every sentence: a passage the search didn't return, or a quote that isn't in the passage,
// drops that citation; a sentence left with no citation is removed and returned as removed, so the
// app can show it. With no sentence left, or when the model says the passages don't answer, the
// answer is "I don't know" with the nearest notes.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { costMicros } from './pricing.js'
import type { ContentBlock, Message, ModelProvider, ModelResponse, TokenUsage, ToolSpec } from './provider.js'
import {
  MAX_PASSAGES,
  NEAREST_NOTES,
  type AnswerResult,
  type Citation,
  type CitationCount,
  type Passage,
  type RemovedSentence,
  type Sentence,
} from './types.js'

export const PROMPT_FILE = new URL('../prompts/answer.md', import.meta.url)

/** The answer prompt, read from its file. */
export const readAnswerPrompt = () => readFileSync(PROMPT_FILE, 'utf8').trim()

/** A short hash of the prompt: the version an evaluation run records. */
export const promptVersion = (prompt: string) =>
  createHash('sha256').update(prompt).digest('hex').slice(0, 12)

/** Primary model and the fallback used when the primary fails after its retries. Never Sonnet. */
export const ANSWER_MODELS = { primary: 'claude-haiku-5-5', fallback: 'claude-haiku-4-5-20251001' } as const

export const ANSWER_TOOL: ToolSpec = {
  name: 'submit_answer',
  description:
    'Submit the answer: whether the passages answer the question, and the sentences with their sources.',
  inputSchema: {
    type: 'object',
    properties: {
      answerable: {
        type: 'boolean',
        description: 'False when the passages do not contain the answer.',
      },
      sentences: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'One short sentence with one fact.' },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  passage: { type: 'string', description: 'Passage id, like P2.' },
                  quote: { type: 'string', description: 'Exact words of that passage, at most 25.' },
                },
                required: ['passage', 'quote'],
              },
            },
          },
          required: ['text', 'sources'],
        },
      },
    },
    required: ['answerable', 'sentences'],
  },
}

interface Submitted {
  answerable: boolean
  sentences: { text: string; sources: { passage: string; quote: string }[] }[]
}

function readSubmission(input: unknown): Submitted | string {
  if (typeof input !== 'object' || input === null) return 'The input must be an object.'
  const { answerable, sentences } = input as Record<string, unknown>
  if (typeof answerable !== 'boolean') return '`answerable` must be true or false.'
  if (!Array.isArray(sentences)) return '`sentences` must be a list.'
  for (const s of sentences) {
    if (typeof s !== 'object' || s === null || typeof (s as { text?: unknown }).text !== 'string')
      return 'Every sentence needs a `text`.'
    const sources = (s as { sources?: unknown }).sources
    if (!Array.isArray(sources)) return 'Every sentence needs a `sources` list (empty if it has none).'
    for (const src of sources)
      if (typeof src?.passage !== 'string' || typeof src?.quote !== 'string')
        return 'Every source needs a `passage` id and a `quote`.'
  }
  return { answerable, sentences: sentences as Submitted['sentences'] }
}

/** Letters and digits only, lowercase, single spaces: a quote matches whatever the punctuation. */
export const normalize = (text: string) =>
  text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export function userMessage(question: string, passages: readonly Passage[]): string {
  const blocks = passages.map((p, i) => {
    const attrs = [
      `id="P${i + 1}"`,
      `note="${escape(p.noteId)}"`,
      `title="${escape(p.title)}"`,
      ...(p.heading ? [`section="${escape(p.heading)}"`] : []),
      `updated="${escape(p.updated)}"`,
      ...(p.status ? [`status="${escape(p.status)}"`] : []),
    ]
    return `<passage ${attrs.join(' ')}>\n${p.text.trim()}\n</passage>`
  })
  return `<passages>\n${blocks.join('\n')}\n</passages>\n\n<question>${escape(question)}</question>`
}

/** Checks each submitted sentence against the passages. */
export function checkSentences(
  submitted: Submitted['sentences'],
  passages: readonly Passage[],
): { sentences: Sentence[]; removed: RemovedSentence[]; citations: CitationCount } {
  const count: CitationCount = { submitted: 0, kept: 0 }
  const byId = new Map(passages.map((p, i) => [`P${i + 1}`, p]))
  const sentences: Sentence[] = []
  const removed: RemovedSentence[] = []
  for (const s of submitted) {
    const text = s.text.trim()
    if (!text) continue
    if (s.sources.length === 0) {
      removed.push({ text, reason: 'no-source' })
      continue
    }
    const citations: Citation[] = []
    let known = 0
    for (const src of s.sources) {
      count.submitted++
      const passage = byId.get(src.passage.trim().toUpperCase())
      if (!passage) continue
      known++
      const quote = normalize(src.quote)
      if (quote && normalize(passage.text).includes(quote))
        citations.push({ chunkId: passage.chunkId, noteId: passage.noteId, quote: src.quote.trim() })
    }
    count.kept += citations.length
    if (citations.length > 0) sentences.push({ text, citations })
    else removed.push({ text, reason: known === 0 ? 'unknown-passage' : 'quote-not-found' })
  }
  return { sentences, removed, citations: count }
}

export interface AnswerOptions {
  question: string
  /** The search results, best first. */
  passages: readonly Passage[]
  provider: ModelProvider
  models?: { primary: string; fallback?: string }
  maxTokens?: number
  /** The prompt text; default: prompts/answer.md. */
  prompt?: string
}

const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  outputTokens: a.outputTokens + b.outputTokens,
})

const NO_USAGE: TokenUsage = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }

export async function answerQuestion(options: AnswerOptions): Promise<AnswerResult> {
  const question = options.question.trim()
  if (!question) throw new Error('The question is empty.')
  const prompt = options.prompt ?? readAnswerPrompt()
  const models = options.models ?? ANSWER_MODELS
  const passages = options.passages.slice(0, MAX_PASSAGES)
  const nearest = [...new Set(passages.map((p) => p.noteId))].slice(0, NEAREST_NOTES)
  const result: AnswerResult = {
    status: 'unknown',
    sentences: [],
    removed: [],
    nearest,
    model: null,
    fallbackUsed: false,
    calls: 0,
    usage: NO_USAGE,
    costMicros: 0,
    citations: { submitted: 0, kept: 0 },
    promptVersion: promptVersion(prompt),
  }
  // Nothing found: nothing to answer from, and no call to pay for.
  if (passages.length === 0) return result

  let model = models.primary
  const call = async (messages: Message[]): Promise<ModelResponse> => {
    const request = {
      model,
      system: prompt,
      // a copy: the conversation grows after this call
      messages: [...messages],
      tools: [ANSWER_TOOL],
      maxTokens: options.maxTokens ?? 4_000,
    }
    let response: ModelResponse
    try {
      response = await options.provider.complete(request)
    } catch (error) {
      if (!models.fallback || model === models.fallback) throw error
      model = models.fallback
      result.fallbackUsed = true
      response = await options.provider.complete({ ...request, model })
    }
    result.calls++
    result.model = response.model
    result.usage = addUsage(result.usage, response.usage)
    result.costMicros += costMicros(response.model, response.usage)
    return response
  }

  const messages: Message[] = [{ role: 'user', content: userMessage(question, passages) }]
  let submitted: Submitted | undefined
  // One reminder when the model doesn't call the tool, or calls it with a broken input.
  for (let turn = 0; turn < 2 && !submitted; turn++) {
    const response = await call(messages)
    const use = response.content.find(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> =>
        b.type === 'tool_use' && b.name === ANSWER_TOOL.name,
    )
    const read = use ? readSubmission(use.input) : undefined
    if (read && typeof read !== 'string') {
      submitted = read
      break
    }
    if (turn === 1) break
    messages.push({ role: 'assistant', content: response.content })
    messages.push({
      role: 'user',
      content: use
        ? [{ type: 'tool_result', toolUseId: use.id, content: `Invalid answer: ${read}`, isError: true }]
        : `Reply by calling the ${ANSWER_TOOL.name} tool.${response.stopReason === 'max_tokens' ? ' Keep it short.' : ''}`,
    })
  }
  if (!submitted) throw new Error(`${result.model ?? model} did not submit a valid answer after a reminder.`)

  if (!submitted.answerable) return result
  const checked = checkSentences(submitted.sentences, passages)
  result.sentences = checked.sentences
  result.removed = checked.removed
  result.citations = checked.citations
  if (checked.sentences.length > 0) {
    result.status = 'answered'
    result.nearest = []
  }
  return result
}
