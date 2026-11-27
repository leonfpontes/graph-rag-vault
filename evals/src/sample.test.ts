import { describe, expect, it } from 'vitest'

import { humanAgreement, pickSample, sampleSheet, type AnswerRecord } from './index.js'

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
