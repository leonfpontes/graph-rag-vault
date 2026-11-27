import { scriptedProvider, type ModelResponse, type Passage } from '@graph-rag/answer'
import { describe, expect, it } from 'vitest'

import {
  agreement,
  faithfulness,
  judgeAnswer,
  judgeMessage,
  judgePromptVersion,
  readJudgePrompt,
  VERDICT_TOOL,
} from './judge.js'

const PASSAGES: Passage[] = [
  {
    chunkId: 'dec-a#0',
    noteId: 'dec-a',
    title: 'Lifetime frame cover',
    text: 'Every new frame is covered for the life of the first owner.',
    updated: '2026-09-01',
    status: 'active',
  },
  {
    chunkId: 'doc-b#0',
    noteId: 'doc-b',
    title: 'Warranty terms',
    text: 'Frames: five years.',
    updated: '2024-05-10',
  },
]
const ANSWER = {
  sentences: [
    {
      text: 'Frames are covered for life.',
      citations: [{ chunkId: 'dec-a#0', noteId: 'dec-a', quote: 'covered for the life' }],
    },
    {
      text: 'It used to be five years, in Europe only.',
      citations: [
        { chunkId: 'doc-b#0', noteId: 'doc-b', quote: 'five years' },
        { chunkId: 'doc-b#0', noteId: 'doc-b', quote: 'Frames' },
      ],
    },
  ],
}
const usage = { inputTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100 }
const verdicts = (input: unknown): ModelResponse => ({
  model: 'claude-haiku-5-5',
  content: [{ type: 'tool_use', id: 'toolu_9', name: 'submit_verdicts', input }],
  stopReason: 'tool_use',
  usage,
})
const GOOD = {
  verdicts: [
    { sentence: 1, verdict: 'supported', reason: 'Same fact.' },
    { sentence: 2, verdict: 'partial', reason: 'Europe is not in the passage.' },
  ],
}

describe('judgeAnswer', () => {
  it('judges every sentence against the passages it cites, and prices the call', async () => {
    const provider = scriptedProvider([verdicts(GOOD)])
    const result = await judgeAnswer({ question: 'How long?', answer: ANSWER, passages: PASSAGES, provider })
    expect(result.verdicts).toEqual([
      { verdict: 'supported', reason: 'Same fact.' },
      { verdict: 'partial', reason: 'Europe is not in the passage.' },
    ])
    expect(result).toMatchObject({ model: 'claude-haiku-5-5', calls: 1, costMicros: 250 })
    const [request] = provider.requests
    expect(request).toMatchObject({ system: readJudgePrompt(), tools: [VERDICT_TOOL] })
    expect(request!.messages[0]!.content).toBe(judgeMessage('How long?', ANSWER, PASSAGES))
  })

  it('shows each cited passage once, with its date and status', () => {
    const message = judgeMessage('How long?', ANSWER, PASSAGES)
    expect(message.match(/<passage note="doc-b"/g)).toHaveLength(1)
    expect(message).toContain(
      '<passage note="dec-a" title="Lifetime frame cover" updated="2026-09-01" status="active">',
    )
    expect(message).toContain('<sentence n="2">\n<text>It used to be five years, in Europe only.</text>')
    expect(() =>
      judgeMessage(
        'Q',
        { sentences: [{ text: 'x', citations: [{ chunkId: 'zz#0', noteId: 'zz', quote: 'x' }] }] },
        PASSAGES,
      ),
    ).toThrow('Sentence 1 cites zz#0, which is not among the passages.')
  })

  it('makes no call for an answer with no sentences', async () => {
    const provider = scriptedProvider([])
    expect(
      await judgeAnswer({ question: 'Q', answer: { sentences: [] }, passages: PASSAGES, provider }),
    ).toMatchObject({
      verdicts: [],
      calls: 0,
    })
  })

  it.each([
    [{ verdicts: 'none' }, '`verdicts` must be a list.'],
    [{ verdicts: [GOOD.verdicts[0]] }, 'Give exactly 2 verdicts, one per sentence (got 1).'],
    [{ verdicts: [GOOD.verdicts[1], GOOD.verdicts[0]] }, 'Verdict 1 must be for sentence 1.'],
    [
      { verdicts: [{ sentence: 1, verdict: 'yes', reason: '' }, GOOD.verdicts[1]] },
      'Verdict 1 must be one of supported, partial, unsupported.',
    ],
  ])('sends %j back once as invalid', async (input, message) => {
    const provider = scriptedProvider([verdicts(input), verdicts(GOOD)])
    const result = await judgeAnswer({ question: 'Q', answer: ANSWER, passages: PASSAGES, provider })
    expect(result.calls).toBe(2)
    expect(provider.requests[1]!.messages.at(-1)!.content).toEqual([
      { type: 'tool_result', toolUseId: 'toolu_9', content: `Invalid verdicts: ${message}`, isError: true },
    ])
  })

  it('reminds once after a text answer, then gives up; uses the fallback when the primary fails', async () => {
    const text: ModelResponse = {
      model: 'claude-haiku-5-5',
      content: [{ type: 'text', text: 'Fine.' }],
      stopReason: 'end_turn',
      usage,
    }
    const stubborn = scriptedProvider([text, text])
    await expect(
      judgeAnswer({ question: 'Q', answer: ANSWER, passages: PASSAGES, provider: stubborn }),
    ).rejects.toThrow('did not submit valid verdicts after a reminder')
    expect(stubborn.requests[1]!.messages.at(-1)!.content).toBe('Reply by calling the submit_verdicts tool.')

    const failing = scriptedProvider([
      new Error('overloaded'),
      { ...verdicts(GOOD), model: 'claude-haiku-4-5-20251001' },
    ])
    const result = await judgeAnswer({ question: 'Q', answer: ANSWER, passages: PASSAGES, provider: failing })
    expect(failing.requests.map((r) => r.model)).toEqual(['claude-haiku-5-5', 'claude-haiku-4-5-20251001'])
    expect(result.model).toBe('claude-haiku-4-5-20251001')
    const none = scriptedProvider([new Error('down')])
    await expect(
      judgeAnswer({
        question: 'Q',
        answer: ANSWER,
        passages: PASSAGES,
        provider: none,
        models: { primary: 'claude-haiku-5-5' },
      }),
    ).rejects.toThrow('down')
  })
})

describe('scores', () => {
  it('scores faithfulness as supported 1, partial 0.5, unsupported 0', () => {
    expect(faithfulness(['supported', 'partial', 'unsupported', 'supported'])).toBe(0.625)
    expect(faithfulness([])).toBeUndefined()
  })

  it("measures agreement and Cohen's kappa", () => {
    // 10 items, 9 equal. Rater a: 6 S, 2 P, 2 U; rater b: 6 S, 3 P, 1 U.
    const a = [
      'supported',
      'supported',
      'supported',
      'supported',
      'supported',
      'supported',
      'partial',
      'partial',
      'unsupported',
      'unsupported',
    ] as const
    const b = [
      'supported',
      'supported',
      'supported',
      'supported',
      'supported',
      'supported',
      'partial',
      'partial',
      'partial',
      'unsupported',
    ] as const
    const r = agreement(a, b)
    expect(r.items).toBe(10)
    expect(r.observed).toBeCloseTo(0.9)
    // expected = 0.6·0.6 + 0.2·0.3 + 0.2·0.1 = 0.44; kappa = (0.9 − 0.44) / 0.56
    expect(r.kappa).toBeCloseTo(0.46 / 0.56)
    expect(agreement(['supported'], ['supported'])).toEqual({ items: 1, observed: 1, kappa: undefined })
    expect(agreement([], [])).toEqual({ items: 0, observed: 0, kappa: undefined })
    expect(() => agreement(['supported'], [])).toThrow('The raters labelled 1 and 0 items.')
  })

  it('versions the judge prompt by its content', () => {
    const prompt = readJudgePrompt()
    expect(prompt).toContain('submit_verdicts')
    expect(judgePromptVersion(prompt)).toMatch(/^[0-9a-f]{12}$/)
  })
})
