import { describe, expect, it } from 'vitest'

import { carryLabels, humanAgreement, pickSample, resample, sampleSheet, type AnswerRecord } from './index.js'

const rec = (
  questionId: string,
  variant: AnswerRecord['variant'],
  over: Partial<AnswerRecord> = {},
): AnswerRecord => ({
  questionId,
  kind: 'fact',
  split: 'test',
  variant,
  round: 1,
  passageNotes: [],
  status: 'answered',
  sentences: [
    {
      text: `Answer to ${questionId}.`,
      citations: [{ chunkId: 'doc-a#0', noteId: 'doc-a', quote: 'covered' }],
    },
  ],
  removed: [],
  nearest: [],
  citations: { submitted: 1, kept: 1 },
  verdicts: [{ verdict: 'supported', reason: 'ok' }],
  answerModel: 'm',
  judgeModel: 'm',
  fallbackUsed: false,
  answerMicros: 1,
  judgeMicros: 1,
  latencyMs: 1,
  ...over,
})

const RECORDS = [
  ...['q-011', 'q-012', 'q-013', 'q-014', 'q-015'].flatMap((q) =>
    (['vector', 'graph', 'hybrid'] as const).map((v) => rec(q, v)),
  ),
  rec('q-016', 'hybrid', { round: 2 }),
  rec('q-017', 'hybrid', { status: 'unknown', sentences: [], verdicts: [] }),
]
const text = (id: string) => `Question ${id}?`
const chunk = () => 'Frames are covered for life.'

describe('pickSample', () => {
  it('takes answered round-1 answers, variants in turn, a new question each time while it can', () => {
    const items = pickSample(RECORDS, text, chunk, 6)
    expect(items).toHaveLength(6)
    expect(items.map((i) => i.item)).toEqual(['S01', 'S02', 'S03', 'S04', 'S05', 'S06'])
    expect(items.map((i) => i.variant)).toEqual(['vector', 'graph', 'hybrid', 'vector', 'graph', 'hybrid'])
    expect(new Set(items.map((i) => i.questionId)).size).toBe(5)
    expect(items.every((i) => i.round === 1)).toBe(true)
    expect(items[0]).toMatchObject({
      question: `Question ${items[0]!.questionId}?`,
      judge: 'supported',
      cited: [
        { noteId: 'doc-a', chunkId: 'doc-a#0', quote: 'covered', text: 'Frames are covered for life.' },
      ],
    })
    // stable: the same records give the same sample
    expect(pickSample(RECORDS, text, chunk, 6)).toEqual(items)
  })

  it('takes half the answers among those with a sentence the judge did not fully support', () => {
    const partial = { verdicts: [{ verdict: 'partial' as const, reason: 'extra detail' }] }
    const records = [...RECORDS, rec('q-020', 'graph', partial), rec('q-021', 'vector', partial)]
    const items = pickSample(records, text, chunk, 4)
    expect(items.slice(0, 2).map((i) => [i.questionId, i.judge])).toEqual(
      expect.arrayContaining([
        ['q-020', 'partial'],
        ['q-021', 'partial'],
      ]),
    )
    expect(items.slice(2).every((i) => i.judge === 'supported')).toBe(true)
  })

  it('takes what there is when there are fewer answers than asked', () => {
    expect(pickSample(RECORDS.slice(0, 2), text, chunk, 10)).toHaveLength(2)
  })
})

describe('the sheet and the agreement', () => {
  const items = pickSample(RECORDS, text, chunk, 3)

  it('shows question, sentence and cited passages, and hides the judge', () => {
    const sheet = sampleSheet(items, '# Check')
    expect(sheet).toContain('## S01 · ')
    expect(sheet).toContain('**Sentence:** Answer to')
    expect(sheet).toContain('> **doc-a** — Frames are covered for life.')
    expect(sheet).toContain('- [ ] supported   - [ ] partial   - [ ] unsupported')
    expect(sheet).not.toMatch(/judge|reason|ok/i)
  })

  it('compares the labels with the judge over the labelled items', () => {
    const r = humanAgreement(items, {
      labeledBy: 'owner',
      labeledAt: '2026-11-28',
      labels: { S01: 'supported', S02: 'partial' },
    })
    expect(r).toMatchObject({
      items: 2,
      answers: 2,
      observed: 0.5,
      labeledBy: 'owner',
      labeledAt: '2026-11-28',
    })
    expect(() =>
      humanAgreement(items, { labeledBy: 'x', labeledAt: 'y', labels: { S99: 'supported' } }),
    ).toThrow('The label S99 matches no sample item.')
    expect(() =>
      humanAgreement(items, { labeledBy: 'x', labeledAt: 'y', labels: { S01: 'yes' as never } }),
    ).toThrow('The label of S01 is "yes", not a verdict.')
  })
})

describe('after a rebuild', () => {
  const before = pickSample(RECORDS, text, chunk, 3)
  const labels = {
    labeledBy: 'owner',
    labeledAt: '2026-11-27',
    blind: false,
    labels: Object.fromEntries(before.map((it) => [it.item, it.judge])),
  }

  it('keeps the chosen answers, reads them again, and moves a label only where nothing changed', () => {
    const [first, second] = before
    // the first answer was asked again and now reads differently
    const changed = RECORDS.map((r) =>
      r.questionId === first!.questionId && r.variant === first!.variant
        ? { ...r, sentences: [{ ...r.sentences[0]!, text: 'A new answer.' }] }
        : r,
    )
    const items = resample(before, changed, text, chunk)
    expect(items.map((it) => [it.questionId, it.variant])).toEqual(
      before.map((it) => [it.questionId, it.variant]),
    )
    const moved = carryLabels(before, items, labels, 'after the index rebuild')
    expect(Object.keys(moved.labels)).toEqual(items.slice(1).map((it) => it.item))
    expect(moved).toMatchObject({ blind: false, pendingReason: 'after the index rebuild' })
    expect(moved.labels[items[1]!.item]).toBe(labels.labels[second!.item])
    const check = humanAgreement(items, moved)
    expect(check).toMatchObject({
      items: 2,
      observed: 1,
      sampleAnswers: 3,
      pendingAnswers: 1,
      kappa: undefined,
    })
    expect(check.pendingReason).toBe('after the index rebuild')
  })

  it('replaces an answer with nothing left to check by the next one of the same variant and half', () => {
    const [first] = before
    const unknown = RECORDS.map((r) =>
      r.questionId === first!.questionId && r.variant === first!.variant
        ? { ...r, status: 'unknown' as const, sentences: [], verdicts: [] }
        : r,
    )
    const items = resample(before, unknown, text, chunk)
    expect(items[0]!.variant).toBe(first!.variant)
    expect(before.map((it) => it.questionId)).not.toContain(items[0]!.questionId)
    expect(items.slice(1).map((it) => it.questionId)).toEqual(before.slice(1).map((it) => it.questionId))
    // no reason is kept once every answer has its labels
    expect(carryLabels(before, before, labels, 'after the index rebuild').pendingReason).toBeUndefined()
  })
})
