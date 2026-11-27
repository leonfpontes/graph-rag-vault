import { scriptedProvider, type ModelProvider, type ModelResponse } from '@graph-rag/answer'
import type { SearchIndex } from '@graph-rag/search'
import { describe, expect, it } from 'vitest'

import {
  Budget,
  evaluate,
  JOB_RESERVE_MICROS,
  MAX_BUDGET_USD,
  outcome,
  parseEvalArgs,
  pool,
  runGeneration,
  summarizeGeneration,
  toMarkdown,
  verdictOf,
  type AnswerRecord,
  type Question,
  type Results,
} from './index.js'

// A tiny fictional index: 3 notes, 4 dimensions.
const v = (...x: number[]) => Float32Array.from(x)
const INDEX: SearchIndex = {
  format: 1,
  model: { id: 'test/model', revision: 'r', dims: 4 },
  sourceHash: 'abc123def4567890',
  notes: [
    {
      id: 'doc-a',
      type: 'document',
      title: 'Frame warranty',
      aliases: [],
      created: '2026-01-01',
      updated: '2026-09-01',
      status: 'current',
      path: 'a.md',
    },
    {
      id: 'per-b',
      type: 'person',
      title: 'Nora Pell',
      aliases: ['Nora'],
      created: '2020-01-01',
      updated: '2025-01-01',
      status: 'active',
      path: 'b.md',
    },
    {
      id: 'per-c',
      type: 'person',
      title: 'Kofi Mensah',
      aliases: [],
      created: '2020-01-01',
      updated: '2025-01-01',
      status: 'active',
      path: 'c.md',
    },
  ],
  links: [
    { from: 'doc-a', to: 'per-b', relation: 'owner' },
    { from: 'per-b', to: 'per-c', relation: 'reports_to' },
  ],
  chunks: [
    {
      id: 'doc-a#0',
      noteId: 'doc-a',
      ord: 0,
      heading: null,
      text: 'Frames are covered for life.',
      embedText: 'Frame warranty\n\nFrames are covered for life.',
    },
    {
      id: 'per-b#0',
      noteId: 'per-b',
      ord: 0,
      heading: null,
      text: 'Runs the test lab.',
      embedText: 'Nora Pell\n\nRuns the test lab.',
    },
    {
      id: 'per-c#0',
      noteId: 'per-c',
      ord: 0,
      heading: null,
      text: 'Heads quality.',
      embedText: 'Kofi Mensah\n\nHeads quality.',
    },
  ],
  vectors: Float32Array.from([...v(1, 0, 0, 0), ...v(0, 1, 0, 0), ...v(0, 0, 1, 0)]),
  queries: [
    { id: 'q-001', question: 'Who owns the frame warranty?', vector: v(1, 0.2, 0, 0) },
    { id: 'q-011', question: 'How long is the frame warranty?', vector: v(1, 0, 0, 0) },
    { id: 'q-012', question: 'What does the frame cost?', vector: v(0.9, 0, 0, 0.1) },
  ],
}
const QUESTIONS: Question[] = [
  {
    id: 'q-001',
    kind: 'multi-hop',
    split: 'probe',
    question: 'Who owns the frame warranty?',
    expectedSources: ['doc-a', 'per-b'],
  },
  {
    id: 'q-011',
    kind: 'fact',
    split: 'test',
    question: 'How long is the frame warranty?',
    expectedSources: ['doc-a'],
  },
  {
    id: 'q-012',
    kind: 'unanswerable',
    split: 'test',
    question: 'What does the frame cost?',
    expectedSources: [],
  },
]

const usage = { inputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100 }
const tool = (name: string, input: unknown): ModelResponse => ({
  model: 'claude-haiku-5-5',
  content: [{ type: 'tool_use', id: 't1', name, input }],
  stopReason: 'tool_use',
  usage,
})

/** Answers by the question: the warranty one from P1, the price one with "I don't know". */
function fakeModel(): ModelProvider & { calls: number } {
  const model = {
    calls: 0,
    async complete(request: { tools: { name: string }[]; messages: { content: unknown }[] }) {
      model.calls++
      const text = String(request.messages[0]!.content)
      if (request.tools[0]!.name === 'submit_verdicts')
        return tool('submit_verdicts', { verdicts: [{ sentence: 1, verdict: 'supported', reason: 'Same.' }] })
      if (text.includes('cost')) return tool('submit_answer', { answerable: false, sentences: [] })
      return tool('submit_answer', {
        answerable: true,
        sentences: [
          { text: 'Frames are covered for life.', sources: [{ passage: 'P1', quote: 'covered for life' }] },
        ],
      })
    },
  }
  return model as ModelProvider & { calls: number }
}

const ARGS = {
  splits: ['test' as const],
  rehearsal: false,
  rounds: 2,
  budgetUsd: 1,
  concurrency: 2,
  variants: ['vector' as const, 'graph' as const, 'hybrid' as const],
  questions: undefined,
  demoExtras: true,
}

describe('evaluate', () => {
  it('scores retrieval once, answers and judges every round, and answers the other questions once for the demo', async () => {
    const provider = fakeModel()
    const { results, records } = await evaluate({
      args: ARGS,
      index: INDEX,
      questions: QUESTIONS,
      provider,
      embeddingModelKey: 'bge-small-en-v1.5',
      now: () => new Date('2026-11-27T12:00:00Z'),
    })
    // 2 test questions × 3 variants × 2 rounds, plus q-001 once (hybrid) for the demo
    expect(records).toHaveLength(13)
    expect(records.filter((r) => r.split === 'probe').map((r) => [r.variant, r.round])).toEqual([
      ['hybrid', 1],
    ])
    expect(results).toMatchObject({
      rehearsal: false,
      splits: ['test'],
      questions: { total: 2, byKind: { fact: 1, unanswerable: 1 } },
      rounds: 2,
      runAt: '2026-11-27T12:00:00.000Z',
      index: { sourceHash: 'abc123def4567890', model: 'test/model' },
      human: null,
    })
    expect(results.retrieval.vector.all).toEqual({ questions: 1, recall5: 1, mrr: 1 })
    expect(results.verdict).toMatchObject({
      hybrid: 1,
      vector: 1,
      points: 0,
      outcome: 'tie',
      bestOther: { variant: 'vector', recall5: 1 },
      outcomeVsBestOther: 'tie',
    })
    const hybrid = results.generation.hybrid
    expect(hybrid.faithfulness).toEqual({ mean: 1, sd: 0, rounds: [1, 1] })
    expect(hybrid.correctUnknown.mean).toBe(1)
    expect(hybrid.answered.mean).toBe(1)
    expect(hybrid.sourceRecall.mean).toBe(1)
    expect(hybrid.citationPrecision.mean).toBe(1)
    expect(hybrid.answers).toBe(4)
    // answers: 13 × (1 000 × $0.10 + 100 × $0.50); judge: 7 answered × the same
    expect(results.cost).toMatchObject({ capUsd: 1, skipped: 0, stoppedEarly: false })
    expect(results.cost.answerUsd).toBeCloseTo((13 * 150) / 1e6)
    expect(results.cost.judgeUsd).toBeCloseTo((7 * 150) / 1e6)
    expect(results.cost.spentUsd).toBeCloseTo(results.cost.answerUsd + results.cost.judgeUsd)
    expect(toMarkdown(results)).toContain('# Scoreboard: 2 questions never used for tuning')
  })

  it('never answers a test question in a rehearsal', async () => {
    const provider = fakeModel()
    const { records, results } = await evaluate({
      args: { ...ARGS, splits: ['probe'], rehearsal: true, rounds: 1, variants: ['hybrid'] },
      index: INDEX,
      questions: QUESTIONS,
      provider,
      embeddingModelKey: 'bge-small-en-v1.5',
    })
    expect(records.map((r) => r.questionId)).toEqual(['q-001'])
    expect(toMarkdown(results)).toContain('Rehearsal on the tuning questions (probe): not the scoreboard')
  })

  it('adds the vector baselines of the other models and picks the best', async () => {
    const strong = {
      model: { key: 'all-minilm-l6-v2', id: 'x/minilm', revision: 'r', dims: 4 },
      embedPassages: async (texts: readonly string[]) =>
        texts.map((_, i) => v(...[0, 1, 2].map((j) => (j === i ? 1 : 0)), 0)),
      embedQuery: async () => v(1, 0, 0, 0),
    }
    const { results } = await evaluate({
      args: { ...ARGS, rounds: 1, variants: ['hybrid'] },
      index: INDEX,
      questions: QUESTIONS,
      provider: fakeModel(),
      embeddingModelKey: 'bge-small-en-v1.5',
      baselineEmbedders: async function* () {
        yield strong as never
      },
    })
    expect(results.baselines.map((b) => b.model)).toEqual(['bge-small-en-v1.5', 'all-minilm-l6-v2'])
    expect(results.verdict.bestVector).toEqual({ model: 'bge-small-en-v1.5', recall5: 1 })
  })

  it('refuses an index that is behind the questions, and an empty choice', async () => {
    const changed = QUESTIONS.map((q) => (q.id === 'q-011' ? { ...q, question: 'Changed?' } : q))
    await expect(
      evaluate({
        args: ARGS,
        index: INDEX,
        questions: changed,
        provider: fakeModel(),
        embeddingModelKey: 'x',
      }),
    ).rejects.toThrow('The index has no vector for q-011 as written now: run pnpm index.')
    await expect(
      evaluate({
        args: { ...ARGS, questions: ['q-999'] },
        index: INDEX,
        questions: QUESTIONS,
        provider: fakeModel(),
        embeddingModelKey: 'x',
      }),
    ).rejects.toThrow('No question matches the splits and ids asked for.')
  })
})

describe('runGeneration', () => {
  const passagesFor = () => [
    {
      chunkId: 'doc-a#0',
      noteId: 'doc-a',
      title: 'Frame warranty',
      text: 'Frames are covered for life.',
      updated: '2026-09-01',
    },
  ]
  const one = [QUESTIONS[1]!]

  it('stops at the cap and says how many answers it did not run', async () => {
    const out = await runGeneration({
      questions: one,
      variants: ['vector', 'hybrid'],
      rounds: 2,
      passagesFor,
      provider: fakeModel(),
      // room for exactly two jobs' reservations at a time, spent after the first two
      budget: new Budget(JOB_RESERVE_MICROS * 2),
      concurrency: 1,
    })
    expect(out.records.length + out.skipped).toBe(4)
    expect(out.records.length).toBeGreaterThan(0)
    expect(out.stoppedEarly).toBe(out.skipped > 0)
  })

  it('records a failed answer as an error, counted and not scored', async () => {
    const lines: string[] = []
    const out = await runGeneration({
      questions: one,
      variants: ['hybrid'],
      rounds: 1,
      passagesFor,
      provider: scriptedProvider([new Error('down'), new Error('fallback down')]),
      budget: new Budget(1_000_000),
      log: (l) => lines.push(l),
    })
    expect(out.records[0]).toMatchObject({ status: 'error', error: 'fallback down', answerMicros: 0 })
    expect(lines).toEqual(['q-011 hybrid round 1: fallback down'])
    const scores = summarizeGeneration(out.records, one, ['hybrid'])
    expect(scores.hybrid).toMatchObject({
      answers: 0,
      errors: 1,
      costPerAnswerUsd: undefined,
      medianLatencyMs: undefined,
    })
    expect(scores.hybrid!.faithfulness.mean).toBeUndefined()
  })

  it('refuses a round or concurrency that is not a whole number', async () => {
    const base = {
      questions: one,
      variants: ['hybrid'] as const,
      passagesFor,
      provider: fakeModel(),
      budget: new Budget(1),
    }
    await expect(runGeneration({ ...base, rounds: 0 })).rejects.toThrow(
      'rounds must be a whole number of 1 or more, got 0.',
    )
    await expect(runGeneration({ ...base, rounds: 1, concurrency: 1.5 })).rejects.toThrow(
      'concurrency must be',
    )
  })
})

describe('summarizeGeneration', () => {
  const rec = (over: Partial<AnswerRecord>): AnswerRecord => ({
    questionId: 'q-011',
    kind: 'fact',
    split: 'test',
    variant: 'hybrid',
    round: 1,
    passageNotes: [],
    status: 'answered',
    sentences: [],
    removed: [],
    nearest: [],
    citations: { submitted: 0, kept: 0 },
    verdicts: [],
    answerModel: 'claude-haiku-5-5',
    judgeModel: 'claude-haiku-5-5',
    fallbackUsed: false,
    answerMicros: 1000,
    judgeMicros: 500,
    latencyMs: 1000,
    ...over,
  })
  const s = (noteId: string) => ({ text: 'x', citations: [{ chunkId: `${noteId}#0`, noteId, quote: 'x' }] })

  it('scores each round and reports mean ± sample deviation', () => {
    const qs: Question[] = [
      { id: 'q-011', kind: 'fact', split: 'test', question: 'Q1', expectedSources: ['a', 'b'] },
      { id: 'q-012', kind: 'unanswerable', split: 'test', question: 'Q2', expectedSources: [] },
    ]
    const records = [
      rec({
        round: 1,
        sentences: [s('a')],
        verdicts: [{ verdict: 'supported', reason: '' }],
        citations: { submitted: 2, kept: 1 },
        removed: [{ text: 'y', reason: 'no-source' }],
        latencyMs: 1000,
      }),
      rec({ round: 1, questionId: 'q-012', kind: 'unanswerable', status: 'unknown', latencyMs: 3000 }),
      rec({
        round: 2,
        sentences: [s('a'), s('b')],
        verdicts: [
          { verdict: 'partial', reason: '' },
          { verdict: 'supported', reason: '' },
        ],
        citations: { submitted: 2, kept: 2 },
        latencyMs: 2000,
      }),
      rec({ round: 2, questionId: 'q-012', kind: 'unanswerable', status: 'answered', latencyMs: 4000 }),
    ]
    const g = summarizeGeneration(records, qs, ['hybrid']).hybrid!
    expect(g.faithfulness.rounds).toEqual([1, 0.75])
    expect(g.faithfulness.mean).toBeCloseTo(0.875)
    expect(g.faithfulness.sd).toBeCloseTo(Math.sqrt(0.03125))
    expect(g.citationPrecision.rounds).toEqual([0.5, 1])
    expect(g.removedShare.rounds).toEqual([0.5, 0])
    expect(g.correctUnknown.rounds).toEqual([1, 0])
    expect(g.answered.rounds).toEqual([1, 1])
    expect(g.sourceRecall.rounds).toEqual([0.5, 1])
    expect(g).toMatchObject({ answers: 4, errors: 0, costPerAnswerUsd: 0.0015, medianLatencyMs: 2500 })
  })
})

describe('budget', () => {
  it('reserves the worst case, settles the real cost and refuses NaN', async () => {
    const b = new Budget(100)
    expect(b.reserve(60)).toBe(true)
    expect(b.reserve(60)).toBe(false)
    b.settle(60, 10)
    expect(b.spent).toBe(10)
    expect(b.reserve(90)).toBe(true)
    expect(() => new Budget(Number.NaN)).toThrow('A budget must be a finite amount above 0, got NaN.')
    expect(() => new Budget(0)).toThrow('above 0')
    expect(() => b.reserve(Number.NaN)).toThrow('A reservation must be 0 or more, got NaN.')
  })

  it('waits for a job in flight instead of skipping, and gives up only when nothing runs', async () => {
    const b = new Budget(100)
    b.reserve(80)
    const waiting = b.reserveOrWait(50)
    b.settle(80, 5)
    expect(await waiting).toBe(true)
    const empty = new Budget(10)
    expect(await empty.reserveOrWait(20)).toBe(false)
  })

  it('runs a pool with a limit, in order of start', async () => {
    const started: number[] = []
    await pool([1, 2, 3, 4], 2, async (n) => {
      started.push(n)
    })
    expect(started).toEqual([1, 2, 3, 4])
    await pool([], 3, async () => {})
  })
})

describe('parseEvalArgs', () => {
  it('defaults to the scoreboard: test split, 3 rounds, $5, all variants, baselines and demo extras', () => {
    expect(parseEvalArgs([])).toMatchObject({
      splits: ['test'],
      rehearsal: false,
      rounds: 3,
      budgetUsd: 5,
      concurrency: 4,
      variants: ['vector', 'graph', 'hybrid'],
      baselines: true,
      demoExtras: true,
      out: 'evals/results',
      report: false,
    })
  })

  it('treats any run without the test split as a rehearsal, and reads the lists', () => {
    expect(
      parseEvalArgs([
        '--',
        '--split',
        'probe,dev',
        '--variants',
        'hybrid',
        '--questions',
        'q-001, q-002',
        '--no-baselines',
        '--rounds',
        '1',
      ]),
    ).toMatchObject({
      splits: ['probe', 'dev'],
      rehearsal: true,
      variants: ['hybrid'],
      questions: ['q-001', 'q-002'],
      baselines: false,
      rounds: 1,
    })
  })

  it.each([
    [['--budget', '5$'], '--budget must be a number of dollars above 0'],
    [['--budget', ''], '--budget must be a number of dollars above 0'],
    [['--budget=-1'], '--budget must be a number of dollars above 0'],
    [['--rounds', '1.5'], '--rounds must be a whole number of 1 or more'],
    [['--concurrency', '0'], '--concurrency must be a whole number of 1 or more'],
    [['--split', 'train'], '--split must be among probe, dev, test'],
    [['--split', ','], '--split needs at least one split.'],
    [['--variants', 'bm25'], '--variants must be among vector, graph, hybrid'],
    [['--variants', ','], '--variants needs at least one variant.'],
    [['--questions', ','], '--questions needs at least one question id.'],
    [['--budget', String(MAX_BUDGET_USD + 1)], 'Add --confirm-budget'],
  ])('refuses %j', (argv, message) => {
    expect(() => parseEvalArgs(argv)).toThrow(message)
  })

  it('takes a large budget only when confirmed', () => {
    expect(parseEvalArgs(['--budget', '25', '--confirm-budget']).budgetUsd).toBe(25)
  })
})

describe('scoreboard', () => {
  const score = (recall5: number) => ({ all: { questions: 33, recall5, mrr: 0.8 } })

  it('compares hybrid with the best other variant, and says what it adds to vectors', () => {
    const v = verdictOf({ vector: score(0.78), graph: score(0.93), hybrid: score(0.91) }, undefined)
    expect(v).toMatchObject({
      bestOther: { variant: 'graph', recall5: 0.93 },
      pointsVsBestOther: -2,
      outcomeVsBestOther: 'tie',
      points: 13,
      outcome: 'win',
    })
    const win = verdictOf({ vector: score(0.6), graph: score(0.5), hybrid: score(0.9) }, undefined)
    expect(win).toMatchObject({
      bestOther: { variant: 'vector' },
      pointsVsBestOther: 30,
      outcomeVsBestOther: 'win',
    })
    const loss = verdictOf({ vector: score(0.6), graph: score(0.9), hybrid: score(0.7) }, undefined)
    expect(loss.outcomeVsBestOther).toBe('loss')
  })

  it('writes the headline from the approved rule, with no word of a win in a tie or a loss', () => {
    const base = {
      rehearsal: false,
      splits: ['test'],
      questions: { total: 40, byKind: {} },
      rounds: 3,
      notes: [],
      human: null,
      baselines: [],
      generation: {},
      models: { answer: 'a', answerFallback: null, judge: 'j', embeddings: 'bge-small-en-v1.5' },
      promptVersions: { answer: 'p', judge: 'q' },
      index: { sourceHash: 'h'.repeat(16), model: 'm' },
      runAt: '2026-11-27T00:00:00Z',
      version: 1,
      cost: { capUsd: 5, spentUsd: 0.17, answerUsd: 0.11, judgeUsd: 0.06, skipped: 0, stoppedEarly: false },
    } as unknown as Results
    const md = (retrieval: Results['retrieval']) =>
      toMarkdown({ ...base, retrieval, verdict: verdictOf(retrieval, undefined) })
    const tie = md({ vector: score(0.78), graph: score(0.93), hybrid: score(0.91) })
    expect(tie).toContain(
      'Hybrid search and graph only tie: 91% and 93% of the expected notes in the top 5 (-2 points, under the 5-point tie line).',
    )
    expect(tie).toContain(
      'Against vectors only (78%), hybrid search is +13 points: what the graph adds to vectors.',
    )
    expect(tie).not.toMatch(/\bwins?\b|\bbeats?\b/i)
    expect(md({ vector: score(0.6), graph: score(0.5), hybrid: score(0.9) })).toContain(
      'Hybrid search finds 90% of the expected notes in its top 5, against 60% for vectors only (+30 points).',
    )
    const loss = md({ vector: score(0.6), graph: score(0.9), hybrid: score(0.7) })
    expect(loss).toContain(
      'Graph only finds 90% of the expected notes in the top 5, hybrid search 70% (-20 points).',
    )
    expect(loss).not.toMatch(/\bwins?\b/i)
  })

  it('calls a difference under 5 points a tie', () => {
    expect(outcome(4.9)).toBe('tie')
    expect(outcome(5)).toBe('win')
    expect(outcome(-5)).toBe('loss')
    expect(outcome(undefined)).toBeUndefined()
  })
})
