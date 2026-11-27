// The human check of the judge: about 10 answers from the first round, spread over the variants,
// one item per sentence. A person labels each item without seeing the judge's verdict; the
// agreement and Cohen's kappa between the two go on the scoreboard.
import { createHash } from 'node:crypto'

import type { AnswerRecord } from './generation.js'
import { agreement, VERDICTS, type Verdict } from './judge.js'

export interface SampleItem {
  /** `S01`, `S02`…: the key a label refers to. */
  item: string
  questionId: string
  question: string
  variant: string
  round: number
  sentence: string
  cited: { noteId: string; chunkId: string; quote: string; text: string }[]
  /** The judge's verdict, hidden from the person who labels. */
  judge: Verdict
}

export interface HumanLabels {
  labeledBy: string
  labeledAt: string
  labels: Record<string, Verdict>
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

/**
 * Picks `answers` answered records of round 1, taking the variants in turn and a different question
 * each time when possible; the order inside a variant is a hash, so the pick is stable and blind to
 * the results.
 */
export function pickSample(
  records: readonly AnswerRecord[],
  questionText: (id: string) => string,
  chunkText: (chunkId: string) => string,
  answers = 10,
): SampleItem[] {
  const candidates = records.filter(
    (r) => r.round === 1 && r.status === 'answered' && r.verdicts.length === r.sentences.length,
  )
  const variants = [...new Set(candidates.map((r) => r.variant))]
  const queues = new Map(
    variants.map((v) => [
      v,
      candidates
        .filter((r) => r.variant === v)
        .sort((a, b) =>
          hash(`${a.questionId}|${a.variant}`).localeCompare(hash(`${b.questionId}|${b.variant}`)),
        ),
    ]),
  )
  const picked: AnswerRecord[] = []
  const seen = new Set<string>()
  while (picked.length < answers && [...queues.values()].some((q) => q.length > 0))
    for (const v of variants) {
      if (picked.length >= answers) break
      const queue = queues.get(v)!
      const i = queue.findIndex((r) => !seen.has(r.questionId))
      const next = queue.splice(i === -1 ? 0 : i, 1)[0]
      if (!next) continue
      picked.push(next)
      seen.add(next.questionId)
    }
  let n = 0
  return picked.flatMap((r) =>
    r.sentences.map((s, i) => ({
      item: `S${String(++n).padStart(2, '0')}`,
      questionId: r.questionId,
      question: questionText(r.questionId),
      variant: r.variant,
      round: r.round,
      sentence: s.text,
      cited: s.citations.map((c) => ({ ...c, text: chunkText(c.chunkId) })),
      judge: r.verdicts[i]!.verdict,
    })),
  )
}

/** The sheet a person fills in: question, sentence and cited passages; no judge verdict. */
export function sampleSheet(items: readonly SampleItem[], intro: string): string {
  const parts = [intro.trim(), '']
  for (const it of items) {
    parts.push(
      `## ${it.item} · ${it.questionId}`,
      '',
      `**Question:** ${it.question}`,
      '',
      `**Sentence:** ${it.sentence}`,
      '',
    )
    for (const c of it.cited)
      parts.push(`> **${c.noteId}** — ${c.text.replace(/\n+/g, ' ')}`, '>', `> _quoted:_ "${c.quote}"`, '')
    parts.push('- [ ] supported   - [ ] partial   - [ ] unsupported', '')
  }
  return parts.join('\n')
}

/** Agreement of the judge with the person's labels, over the items the person labelled. */
export function humanAgreement(items: readonly SampleItem[], labels: HumanLabels) {
  for (const [key, v] of Object.entries(labels.labels)) {
    if (!items.some((it) => it.item === key)) throw new Error(`The label ${key} matches no sample item.`)
    if (!(VERDICTS as readonly string[]).includes(v))
      throw new Error(`The label of ${key} is "${v}", not a verdict.`)
  }
  const labelled = items.filter((it) => labels.labels[it.item])
  return {
    ...agreement(
      labelled.map((it) => it.judge),
      labelled.map((it) => labels.labels[it.item]!),
    ),
    answers: new Set(labelled.map((it) => `${it.questionId}|${it.variant}`)).size,
    labeledBy: labels.labeledBy,
    labeledAt: labels.labeledAt,
  }
}
