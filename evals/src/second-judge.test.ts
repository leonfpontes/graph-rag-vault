import { scriptedProvider, type ModelResponse } from '@graph-rag/answer'
import { describe, expect, it } from 'vitest'

import type { AnswerRecord } from './generation.js'
import { compareLabels, type SampleItem } from './sample.js'
import { runSecondJudge, SECOND_JUDGE_MODEL, worstCaseMicros } from './second-judge.js'

const INDEX = {
  notes: [
    { id: 'dec-a', title: 'Lifetime frame cover', updated: '2026-09-01', status: 'active', aliases: [] },
  ],
  chunks: [
    {
      id: 'dec-a#0',
      noteId: 'dec-a',
      ord: 0,
      heading: '',
      embedText: 'Lifetime frame cover\nFrames are covered for life.',
    },
  ],
  links: [],
} as never
const sentence = (text: string) => ({
  text,
  citations: [{ chunkId: 'dec-a#0', noteId: 'dec-a', quote: 'covered for life' }],
})
const RECORD = {
  questionId: 'q-021',
  variant: 'hybrid',
  round: 1,
  passageNotes: ['dec-a'],
  sentences: [sentence('Frames are covered for life.'), sentence('In every country.')],
} as AnswerRecord
const item = (n: number, text: string, judge: SampleItem['judge']): SampleItem => ({
  item: `S0${n}`,
  questionId: 'q-021',
  question: 'How long are frames covered?',
  variant: 'hybrid',
  round: 1,
  sentence: text,
  cited: [],
  judge,
})
const ITEMS = [item(1, 'Frames are covered for life.', 'supported'), item(2, 'In every country.', 'partial')]
const reply = (verdicts: string[]): ModelResponse => ({
  model: SECOND_JUDGE_MODEL,
  content: [
    {
      type: 'tool_use',
      id: 'toolu_1',
      name: 'submit_verdicts',
      input: { verdicts: verdicts.map((verdict, i) => ({ sentence: i + 1, verdict, reason: 'r' })) },
    },
  ],
  stopReason: 'tool_use',
  usage: { inputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100 },
})

describe('the second judge', () => {
  it('labels the sample on the larger model, with the cited passages, and prices it', async () => {
    const provider = scriptedProvider([reply(['supported', 'unsupported'])])
    const file = await runSecondJudge({
      items: ITEMS,
      records: [RECORD],
      index: INDEX,
      provider,
      capMicros: 1_000_000,
      now: () => new Date('2026-11-27T12:00:00Z'),
    })
    expect(provider.requests).toHaveLength(1)
    expect(provider.requests[0]!.model).toBe('claude-opus-5-5')
    expect(JSON.stringify(provider.requests[0]!.messages)).toContain('Frames are covered for life.')
    expect(file).toMatchObject({
      model: 'claude-opus-5-5',
      judgedAt: '2026-11-27',
      costMicros: 1_000 * 4 + 100 * 20,
    })
    expect(Object.fromEntries(Object.entries(file.verdicts).map(([k, v]) => [k, v.verdict]))).toEqual({
      S01: 'supported',
      S02: 'unsupported',
    })
    const check = compareLabels(ITEMS, { S01: 'supported', S02: 'unsupported' })
    expect(check).toMatchObject({
      items: 2,
      answers: 1,
      observed: 0.5,
      otherLabels: ['supported', 'unsupported'],
    })
    expect(check.disagreements).toEqual([
      expect.objectContaining({ item: 'S02', judge: 'partial', other: 'unsupported' }),
    ])
  })

  it('refuses before any call when the worst case is over what is left in the cap', async () => {
    const provider = scriptedProvider([])
    await expect(
      runSecondJudge({
        items: ITEMS,
        records: [RECORD],
        index: INDEX,
        provider,
        capMicros: worstCaseMicros(SECOND_JUDGE_MODEL) - 1,
      }),
    ).rejects.toThrow(/over the \$0\.26 left in the cap/)
    expect(provider.requests).toHaveLength(0)
  })

  it('refuses a sample that no longer matches its recorded answer', async () => {
    await expect(
      runSecondJudge({
        items: [item(1, 'Changed.', 'supported')],
        records: [RECORD],
        index: INDEX,
        provider: scriptedProvider([]),
        capMicros: 1_000_000,
      }),
    ).rejects.toThrow('does not match its recorded answer')
  })
})
