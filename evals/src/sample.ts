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
  /**
   * False when the person reviewed the judge's verdicts instead of labelling without them: the
   * agreement is then a review, and no kappa is computed. Absent means blind.
   */
  blind?: boolean
  /** Why some sample answers have no label yet (e.g. "after the index rebuild"). */
  pendingReason?: string
  /** Items the person labelled without seeing the judge, when the rest was a review (blind: false). */
  blindItems?: string[]
  blindLabeledAt?: string
  labels: Record<string, Verdict>
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

/**
 * Picks `answers` answered records of round 1. Half come from the answers with a sentence the judge
 * did not fully support, the rest from the others: with almost every verdict `supported`, a plain
 * random sample would leave kappa with nothing to measure. Inside each half the variants take turns
 * and a new question is preferred; the order inside a variant is a hash, so the pick is stable.
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
  const flagged = (r: AnswerRecord) => r.verdicts.some((v) => v.verdict !== 'supported')
  const picked: AnswerRecord[] = []
  const seen = new Set<string>()
  const take = (from: AnswerRecord[], count: number) => {
    const variants = [...new Set(from.map((r) => r.variant))]
    const queues = new Map(
      variants.map((v) => [
        v,
        from
          .filter((r) => r.variant === v)
          .sort((a, b) =>
            hash(`${a.questionId}|${a.variant}`).localeCompare(hash(`${b.questionId}|${b.variant}`)),
          ),
      ]),
    )
    const goal = picked.length + count
    while (picked.length < goal && [...queues.values()].some((q) => q.length > 0))
      for (const v of variants) {
        if (picked.length >= goal) break
        const queue = queues.get(v)!
        const i = queue.findIndex((r) => !seen.has(r.questionId))
        const next = queue.splice(i === -1 ? 0 : i, 1)[0]
        if (!next) continue
        picked.push(next)
        seen.add(next.questionId)
      }
  }
  take(candidates.filter(flagged), Math.ceil(answers / 2))
  take(
    candidates.filter((r) => !flagged(r)),
    answers - picked.length,
  )
  return itemsFor(picked, questionText, chunkText)
}

/** One item per sentence of the given answers, numbered S01, S02… in order. */
function itemsFor(
  picked: readonly AnswerRecord[],
  questionText: (id: string) => string,
  chunkText: (chunkId: string) => string,
): SampleItem[] {
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

/**
 * The same answers as an earlier sample (question, variant, round), read from new records: after
 * a rebuild, the sample stays the one that was chosen, and an answer that changed gets new items.
 */
export function resample(
  previous: readonly SampleItem[],
  records: readonly AnswerRecord[],
  questionText: (id: string) => string,
  chunkText: (chunkId: string) => string,
): SampleItem[] {
  const keyOf = (x: { questionId: string; variant: string; round: number }) =>
    `${x.questionId}|${x.variant}|${x.round}`
  const judged = (r: AnswerRecord) =>
    r.round === 1 && r.status === 'answered' && r.verdicts.length === r.sentences.length
  const flagged = (r: AnswerRecord) => r.verdicts.some((v) => v.verdict !== 'supported')
  const keys = [...new Set(previous.map(keyOf))]
  const questions = new Set(previous.map((it) => it.questionId))
  const picked = keys.map((key) => {
    const r = records.find((x) => keyOf(x) === key)
    if (r && judged(r)) return r
    // The answer has nothing left to check (now "I don't know", say): the next answer of the same
    // variant and the same half of the sample takes its place, in the order pickSample uses.
    const old = previous.filter((it) => keyOf(it) === key)
    const wasFlagged = old.some((it) => it.judge !== 'supported')
    const next = records
      .filter(
        (x) =>
          judged(x) &&
          x.variant === old[0]!.variant &&
          flagged(x) === wasFlagged &&
          !questions.has(x.questionId),
      )
      .sort((a, b) =>
        hash(`${a.questionId}|${a.variant}`).localeCompare(hash(`${b.questionId}|${b.variant}`)),
      )[0]
    if (!next)
      throw new Error(`The sample answer ${key} has nothing left to check, and no answer can replace it.`)
    questions.add(next.questionId)
    return next
  })
  return itemsFor(picked, questionText, chunkText)
}

/**
 * Moves the person's labels to the new item ids: a label stays only where the answer, the
 * sentence and the judge's verdict are the same; a changed answer waits for a new label.
 */
export function carryLabels(
  previous: readonly SampleItem[],
  items: readonly SampleItem[],
  labels: HumanLabels,
  pendingReason?: string,
): HumanLabels {
  const same = (a: SampleItem, b: SampleItem) =>
    a.questionId === b.questionId &&
    a.variant === b.variant &&
    a.round === b.round &&
    a.sentence === b.sentence &&
    a.judge === b.judge
  const moved: Record<string, Verdict> = {}
  for (const it of items) {
    const old = previous.find((p) => same(p, it))
    const label = old && labels.labels[old.item]
    if (label) moved[it.item] = label
  }
  const pending = items.some((it) => !moved[it.item])
  const { pendingReason: _old, ...rest } = labels
  return { ...rest, ...(pending && pendingReason ? { pendingReason } : {}), labels: moved }
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

/**
 * The judge's verdicts against another rater's labels (a second judge), item by item: agreement,
 * kappa, the labels the other rater used and the items where the two differ.
 */
export function compareLabels(items: readonly SampleItem[], other: Readonly<Record<string, Verdict>>) {
  for (const key of Object.keys(other))
    if (!items.some((it) => it.item === key)) throw new Error(`The label ${key} matches no sample item.`)
  const labelled = items.filter((it) => other[it.item])
  return {
    ...agreement(
      labelled.map((it) => it.judge),
      labelled.map((it) => other[it.item]!),
    ),
    answers: new Set(labelled.map((it) => `${it.questionId}|${it.variant}`)).size,
    otherLabels: VERDICTS.filter((v) => labelled.some((it) => other[it.item] === v)),
    disagreements: labelled
      .filter((it) => other[it.item] !== it.judge)
      .map((it) => ({
        item: it.item,
        questionId: it.questionId,
        variant: it.variant,
        sentence: it.sentence,
        judge: it.judge,
        other: other[it.item]!,
      })),
  }
}

/** Agreement of the judge with the person's labels, over the items the person labelled. */
export function humanAgreement(items: readonly SampleItem[], labels: HumanLabels) {
  for (const [key, v] of Object.entries(labels.labels)) {
    if (!items.some((it) => it.item === key)) throw new Error(`The label ${key} matches no sample item.`)
    if (!(VERDICTS as readonly string[]).includes(v))
      throw new Error(`The label of ${key} is "${v}", not a verdict.`)
  }
  const labelled = items.filter((it) => labels.labels[it.item])
  const answerKey = (it: SampleItem) => `${it.questionId}|${it.variant}|${it.round}`
  const sampleAnswers = new Set(items.map(answerKey))
  const pendingAnswers = new Set(items.filter((it) => !labels.labels[it.item]).map(answerKey))
  const blind = labels.blind ?? true
  const measured = agreement(
    labelled.map((it) => it.judge),
    labelled.map((it) => labels.labels[it.item]!),
  )
  return {
    ...measured,
    // A person who saw the verdicts was not an independent rater: kappa would measure nothing.
    kappa: blind ? measured.kappa : undefined,
    answers: new Set(labelled.map((it) => `${it.questionId}|${it.variant}`)).size,
    labeledBy: labels.labeledBy,
    labeledAt: labels.labeledAt,
    blind,
    sampleAnswers: sampleAnswers.size,
    pendingAnswers: pendingAnswers.size,
    ...(pendingAnswers.size && labels.pendingReason ? { pendingReason: labels.pendingReason } : {}),
    ...(labels.blindItems?.length ? { blindPart: blindPart(items, labels) } : {}),
  }
}

/**
 * The part of a review the person labelled blind: how many agree with the judge and where they
 * differ. No kappa: a handful of items can't carry one.
 */
function blindPart(items: readonly SampleItem[], labels: HumanLabels) {
  const blindItems = labels.blindItems ?? []
  for (const key of blindItems)
    if (!labels.labels[key]) throw new Error(`The blind item ${key} has no label.`)
  const part = items.filter((it) => blindItems.includes(it.item))
  return {
    items: part.length,
    agreed: part.filter((it) => labels.labels[it.item] === it.judge).length,
    labeledAt: labels.blindLabeledAt ?? labels.labeledAt,
    disagreements: part
      .filter((it) => labels.labels[it.item] !== it.judge)
      .map((it) => ({
        item: it.item,
        questionId: it.questionId,
        variant: it.variant,
        sentence: it.sentence,
        judge: it.judge,
        human: labels.labels[it.item]!,
      })),
  }
}
