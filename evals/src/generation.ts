// The generated half of the evaluation: for each question, search variant and round, answer from
// the passages that variant found, then judge the answer. Rounds repeat the same work because the
// model is not deterministic; the scoreboard reports mean ± sample deviation across rounds.
import {
  answerQuestion,
  type AnswerResult,
  type ModelProvider,
  type Passage,
  type RemovedSentence,
  type Sentence,
} from '@graph-rag/answer'

import { pool, type Budget } from './budget.js'
import { faithfulness, judgeAnswer, type SentenceVerdict, type Verdict } from './judge.js'
import { mean, stdev } from './metrics.js'
import type { RetrievalVariant } from './retrieval.js'
import type { Question } from './types.js'

/**
 * Worst case of one job (answer + judge, each with a reminder), priced at the fallback model so a
 * fallback can't pass the cap: 2 × (12k input × $1 + 4k output × $5) per million, twice.
 */
export const JOB_RESERVE_MICROS = 2 * 2 * (12_000 * 1 + 4_000 * 5)

export interface AnswerRecord {
  questionId: string
  kind: Question['kind']
  split: Question['split']
  variant: RetrievalVariant
  round: number
  /** Notes the answer read, in order. */
  passageNotes: string[]
  status: AnswerResult['status'] | 'error'
  sentences: Sentence[]
  removed: RemovedSentence[]
  nearest: string[]
  citations: AnswerResult['citations']
  verdicts: SentenceVerdict[]
  answerModel: string | null
  judgeModel: string | null
  fallbackUsed: boolean
  answerMicros: number
  judgeMicros: number
  latencyMs: number
  error?: string
}

export interface GenerationOptions {
  questions: readonly Question[]
  variants: readonly RetrievalVariant[]
  rounds: number
  passagesFor: (question: Question, variant: RetrievalVariant) => Passage[]
  provider: ModelProvider
  budget: Budget
  concurrency?: number
  answerModels?: { primary: string; fallback?: string }
  judgeModels?: { primary: string; fallback?: string }
  /**
   * A recorded answer to keep instead of a new call: same question, variant and round, and the
   * search gave the same notes in the same order (same prompt and models, checked by the caller).
   */
  reuse?: (job: {
    questionId: string
    variant: RetrievalVariant
    round: number
    passageNotes: string[]
  }) => AnswerRecord | undefined
  now?: () => number
  log?: (line: string) => void
}

export interface GenerationOutcome {
  records: AnswerRecord[]
  /** Jobs not run because the budget was spent. */
  skipped: number
  /** Answers kept from an earlier run (`reuse`), at no cost. */
  reused: number
  stoppedEarly: boolean
}

export async function runGeneration(options: GenerationOptions): Promise<GenerationOutcome> {
  const { questions, variants, rounds, provider, budget } = options
  for (const [name, n] of Object.entries({ rounds, concurrency: options.concurrency ?? 4 }))
    if (!Number.isSafeInteger(n) || n < 1)
      throw new Error(`${name} must be a whole number of 1 or more, got ${n}.`)
  const now = options.now ?? (() => performance.now())
  const log = options.log ?? (() => {})
  // Round by round, so a stop on the cap leaves whole rounds behind it.
  const jobs = Array.from({ length: rounds }, (_, r) =>
    variants.flatMap((variant) => questions.map((question) => ({ question, variant, round: r + 1 }))),
  ).flat()
  const records: AnswerRecord[] = []
  let skipped = 0
  let reused = 0

  await pool(jobs, options.concurrency ?? 4, async ({ question, variant, round }) => {
    const passages = options.passagesFor(question, variant)
    const passageNotes = [...new Set(passages.map((p) => p.noteId))]
    const kept = options.reuse?.({ questionId: question.id, variant, round, passageNotes })
    if (kept) {
      reused++
      records.push(structuredClone(kept))
      return
    }
    if (!(await budget.reserveOrWait(JOB_RESERVE_MICROS))) {
      skipped++
      return
    }
    const record: AnswerRecord = {
      questionId: question.id,
      kind: question.kind,
      split: question.split,
      variant,
      round,
      passageNotes,
      status: 'error',
      sentences: [],
      removed: [],
      nearest: [],
      citations: { submitted: 0, kept: 0 },
      verdicts: [],
      answerModel: null,
      judgeModel: null,
      fallbackUsed: false,
      answerMicros: 0,
      judgeMicros: 0,
      latencyMs: 0,
    }
    const started = now()
    try {
      const answer = await answerQuestion({
        question: question.question,
        passages,
        provider,
        models: options.answerModels,
      })
      record.latencyMs = Math.round(now() - started)
      Object.assign(record, {
        status: answer.status,
        sentences: answer.sentences,
        removed: answer.removed,
        nearest: answer.nearest,
        citations: answer.citations,
        answerModel: answer.model,
        fallbackUsed: answer.fallbackUsed,
        answerMicros: answer.costMicros,
      })
      const judged = await judgeAnswer({
        question: question.question,
        answer,
        passages,
        provider,
        models: options.judgeModels,
      })
      record.verdicts = judged.verdicts
      record.judgeModel = judged.model
      record.judgeMicros = judged.costMicros
    } catch (error) {
      record.error = (error as Error).message
      log(`${question.id} ${variant} round ${round}: ${record.error}`)
    } finally {
      budget.settle(JOB_RESERVE_MICROS, record.answerMicros + record.judgeMicros)
      records.push(record)
    }
  })

  const order = (r: AnswerRecord) => `${r.round}|${variants.indexOf(r.variant)}|${r.questionId}`
  records.sort((a, b) => order(a).localeCompare(order(b)))
  return { records, skipped, reused, stoppedEarly: skipped > 0 }
}

export interface Spread {
  mean: number | undefined
  sd: number
  rounds: (number | undefined)[]
}

export interface GenerationScore {
  /** Judge score of the kept sentences: supported 1, partial 0.5, unsupported 0. */
  faithfulness: Spread
  /** Share of the sources the model gave that passed the quote check (no model involved). */
  citationPrecision: Spread
  /** Share of the sentences written that were removed for lack of a source. */
  removedShare: Spread
  /** Unanswerable questions answered "I don't know". */
  correctUnknown: Spread
  /** Answerable questions answered (not "I don't know"). */
  answered: Spread
  /** Answerable questions: share of the expected notes the answer cites. */
  sourceRecall: Spread
  answers: number
  errors: number
  costPerAnswerUsd: number | undefined
  medianLatencyMs: number | undefined
}

const ratio = (num: number, den: number) => (den === 0 ? undefined : num / den)

const spread = (rounds: (number | undefined)[]): Spread => {
  const defined = rounds.filter((x): x is number => x !== undefined)
  return { mean: mean(defined), sd: stdev(defined), rounds }
}

const median = (xs: number[]) => {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** Scores per variant, from the records of every round; errors are counted, not scored. */
export function summarizeGeneration(
  records: readonly AnswerRecord[],
  questions: readonly Question[],
  variants: readonly RetrievalVariant[],
): Record<string, GenerationScore> {
  const expected = new Map(questions.map((q) => [q.id, q.expectedSources]))
  const out: Record<string, GenerationScore> = {}
  for (const variant of variants) {
    const mine = records.filter((r) => r.variant === variant)
    const ok = mine.filter((r) => r.status !== 'error')
    const rounds = [...new Set(mine.map((r) => r.round))].sort((a, b) => a - b)
    const per = (score: (rs: AnswerRecord[]) => number | undefined) =>
      spread(rounds.map((round) => score(ok.filter((r) => r.round === round))))
    out[variant] = {
      faithfulness: per((rs) => faithfulness(rs.flatMap((r) => r.verdicts.map((v) => v.verdict as Verdict)))),
      citationPrecision: per((rs) =>
        ratio(
          rs.reduce((s, r) => s + r.citations.kept, 0),
          rs.reduce((s, r) => s + r.citations.submitted, 0),
        ),
      ),
      removedShare: per((rs) =>
        ratio(
          rs.reduce((s, r) => s + r.removed.length, 0),
          rs.reduce((s, r) => s + r.removed.length + r.sentences.length, 0),
        ),
      ),
      correctUnknown: per((rs) => {
        const un = rs.filter((r) => r.kind === 'unanswerable')
        return ratio(un.filter((r) => r.status === 'unknown').length, un.length)
      }),
      answered: per((rs) => {
        const an = rs.filter((r) => r.kind !== 'unanswerable')
        return ratio(an.filter((r) => r.status === 'answered').length, an.length)
      }),
      sourceRecall: per((rs) =>
        mean(
          rs
            .filter((r) => r.kind !== 'unanswerable')
            .map((r) => {
              const want = [...new Set(expected.get(r.questionId) ?? [])]
              const cited = new Set(r.sentences.flatMap((s) => s.citations.map((c) => c.noteId)))
              return want.length ? want.filter((id) => cited.has(id)).length / want.length : undefined
            }),
        ),
      ),
      answers: ok.length,
      errors: mine.length - ok.length,
      costPerAnswerUsd: ok.length
        ? ok.reduce((s, r) => s + r.answerMicros + r.judgeMicros, 0) / ok.length / 1e6
        : undefined,
      medianLatencyMs: median(ok.map((r) => r.latencyMs)),
    }
  }
  return out
}
