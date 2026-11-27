// A second automatic judge on the stratified sample of the judge check: a larger model labels the
// same sentences with the same prompt and passages, without seeing the first judge's verdicts. Its
// agreement with the first judge is published as agreement between 2 automatic judges: it says how
// stable the verdicts are across models, not whether a person would agree.
import { passagesFromHits, priceOf, type ModelProvider } from '@graph-rag/answer'
import type { SearchIndex } from '@graph-rag/search'

import type { AnswerRecord } from './generation.js'
import { judgeAnswer, judgePromptVersion, readJudgePrompt, type SentenceVerdict } from './judge.js'
import { compareLabels, type SampleItem } from './sample.js'

/** Leonardo's rule: a larger model only in the judge, Opus 5.5, never Sonnet. */
export const SECOND_JUDGE_MODEL = 'claude-opus-5-5'

/** What the second judge said, kept so `pnpm eval --report` rebuilds the check with no call. */
export interface SecondJudgeFile {
  model: string
  judgedAt: string
  promptVersion: string
  costMicros: number
  verdicts: Record<string, SentenceVerdict>
}

export interface SecondJudgeOptions {
  items: readonly SampleItem[]
  records: readonly AnswerRecord[]
  index: Pick<SearchIndex, 'notes' | 'chunks' | 'links'>
  provider: ModelProvider
  /** What may still be spent; the worst case of every answer is checked against it before any call. */
  capMicros: number
  model?: string
  prompt?: string
  now?: () => Date
}

/** Worst case of one answer: two calls (a reminder) of 12k input and 4k output at the model's price. */
export function worstCaseMicros(model: string): number {
  const p = priceOf(model)
  if (!p) throw new Error(`No price for the model "${model}". Add it to PRICES in pricing.ts.`)
  return Math.ceil(2 * (12_000 * p.input + 4_000 * p.output))
}

export async function runSecondJudge(options: SecondJudgeOptions): Promise<SecondJudgeFile> {
  const model = options.model ?? SECOND_JUDGE_MODEL
  const prompt = options.prompt ?? readJudgePrompt()
  const groups = new Map<string, SampleItem[]>()
  for (const it of options.items) {
    const key = `${it.questionId}|${it.variant}|${it.round}`
    groups.set(key, [...(groups.get(key) ?? []), it])
  }
  const worst = groups.size * worstCaseMicros(model)
  if (worst > options.capMicros)
    throw new Error(
      `The second judge could cost up to $${(worst / 1e6).toFixed(2)}, over the $${(options.capMicros / 1e6).toFixed(2)} left in the cap.`,
    )
  const file: SecondJudgeFile = {
    model,
    judgedAt: (options.now?.() ?? new Date()).toISOString().slice(0, 10),
    promptVersion: judgePromptVersion(prompt),
    costMicros: 0,
    verdicts: {},
  }
  for (const [key, items] of groups) {
    const record = options.records.find((r) => `${r.questionId}|${r.variant}|${r.round}` === key)
    if (!record) throw new Error(`No recorded answer for ${key}.`)
    if (record.sentences.map((s) => s.text).join('\n') !== items.map((it) => it.sentence).join('\n'))
      throw new Error(`The sample of ${key} does not match its recorded answer.`)
    // Every passage of the notes the answer read: the cited ones come back with the same text.
    const passages = passagesFromHits(
      options.index,
      record.passageNotes.map((noteId) => ({ noteId, score: 0, reasons: [] })),
      { notes: Infinity, max: Infinity },
    )
    const judged = await judgeAnswer({
      question: items[0]!.question,
      answer: { sentences: record.sentences },
      passages,
      provider: options.provider,
      // No fallback: a lighter model would not be a second opinion.
      models: { primary: model },
      prompt,
    })
    file.costMicros += judged.costMicros
    file.model = judged.model ?? model
    items.forEach((it, i) => (file.verdicts[it.item] = judged.verdicts[i]!))
  }
  return file
}

/** The scoreboard's view of the second judge: agreement with the first judge and where they differ. */
export function secondJudgeCheck(items: readonly SampleItem[], file: SecondJudgeFile) {
  const {
    otherLabels: _labels,
    disagreements,
    ...measured
  } = compareLabels(items, Object.fromEntries(Object.entries(file.verdicts).map(([k, v]) => [k, v.verdict])))
  return {
    model: file.model,
    judgedAt: file.judgedAt,
    promptVersion: file.promptVersion,
    costUsd: file.costMicros / 1e6,
    ...measured,
    disagreements: disagreements.map(({ other, ...d }) => ({
      ...d,
      second: other,
      reason: file.verdicts[d.item]!.reason,
    })),
  }
}
