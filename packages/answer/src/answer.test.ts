import { describe, expect, it } from 'vitest'

import {
  ANSWER_MODELS,
  ANSWER_TOOL,
  answerQuestion,
  checkSentences,
  normalize,
  promptVersion,
  readAnswerPrompt,
  scriptedProvider,
  userMessage,
  type ModelResponse,
  type Passage,
} from './index.js'

// Fictional passages, in the shape the search returns.
const PASSAGES: Passage[] = [
  {
    chunkId: 'dec-lifetime-frame-cover#0',
    noteId: 'dec-lifetime-frame-cover',
    title: 'Lifetime frame cover',
    heading: 'Decision',
    text: 'From 1 March 2026 every new frame is covered for the life of the first owner.',
    updated: '2026-03-01',
    status: 'active',
  },
  {
    chunkId: 'doc-warranty-terms#1',
    noteId: 'doc-warranty-terms',
    title: 'Warranty terms',
    heading: 'Frames',
    text: 'Frames carry a five-year warranty against manufacturing defects.',
    updated: '2024-05-10',
    status: 'superseded',
  },
  {
    chunkId: 'doc-warranty-terms#2',
    noteId: 'doc-warranty-terms',
    title: 'Warranty terms',
    heading: 'Paint',
    text: 'Paint is covered for two years.',
    updated: '2024-05-10',
  },
  {
    chunkId: 'doc-service-faq#0',
    noteId: 'doc-service-faq',
    title: 'Service FAQ',
    text: 'Book a service at any dealer.',
    updated: '2025-01-20',
  },
]

const usage = { inputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 200 }

const submit = (input: unknown, model = 'claude-haiku-5-5'): ModelResponse => ({
  model,
  content: [{ type: 'tool_use', id: 'toolu_1', name: 'submit_answer', input }],
  stopReason: 'tool_use',
  usage,
})

const text = (t: string, stopReason = 'end_turn'): ModelResponse => ({
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text: t }],
  stopReason,
  usage,
})

const Q = 'How long is the frame warranty on a new bike?'

describe('answerQuestion', () => {
  it('keeps the sentences whose quotes are in the cited passages, with the chunk and note', async () => {
    const provider = scriptedProvider([
      submit({
        answerable: true,
        sentences: [
          {
            text: 'New frames are covered for the life of the first owner.',
            sources: [{ passage: 'P1', quote: 'covered for the life of the first owner' }],
          },
          {
            text: 'This replaced the older five-year warranty.',
            sources: [
              { passage: 'p2', quote: 'Frames carry a five-year warranty' },
              { passage: 'P1', quote: 'From 1 March 2026' },
            ],
          },
        ],
      }),
    ])
    const result = await answerQuestion({ question: Q, passages: PASSAGES, provider })
    expect(result.status).toBe('answered')
    expect(result.sentences).toEqual([
      {
        text: 'New frames are covered for the life of the first owner.',
        citations: [
          {
            chunkId: 'dec-lifetime-frame-cover#0',
            noteId: 'dec-lifetime-frame-cover',
            quote: 'covered for the life of the first owner',
          },
        ],
      },
      {
        text: 'This replaced the older five-year warranty.',
        citations: [
          {
            chunkId: 'doc-warranty-terms#1',
            noteId: 'doc-warranty-terms',
            quote: 'Frames carry a five-year warranty',
          },
          {
            chunkId: 'dec-lifetime-frame-cover#0',
            noteId: 'dec-lifetime-frame-cover',
            quote: 'From 1 March 2026',
          },
        ],
      },
    ])
    expect(result.removed).toEqual([])
    expect(result.nearest).toEqual([])
    expect(result).toMatchObject({ model: 'claude-haiku-5-5', fallbackUsed: false, calls: 1 })
    // 1 000 input × $0.10 + 200 output × $0.50 per million tokens
    expect(result.costMicros).toBe(200)
  })

  it('removes a sentence with no source, an unknown passage or a quote that is not in the passage', async () => {
    const provider = scriptedProvider([
      submit({
        answerable: true,
        sentences: [
          {
            text: 'Frames are covered for life.',
            sources: [{ passage: 'P1', quote: 'covered for the life' }],
          },
          { text: 'The warranty is transferable.', sources: [] },
          { text: 'Dealers pay for repairs.', sources: [{ passage: 'P9', quote: 'Dealers pay' }] },
          {
            text: 'Carbon frames get ten years.',
            sources: [{ passage: 'P2', quote: 'ten years for carbon' }],
          },
          { text: '   ', sources: [] },
        ],
      }),
    ])
    const result = await answerQuestion({ question: Q, passages: PASSAGES, provider })
    expect(result.status).toBe('answered')
    expect(result.sentences.map((s) => s.text)).toEqual(['Frames are covered for life.'])
    expect(result.removed).toEqual([
      { text: 'The warranty is transferable.', reason: 'no-source' },
      { text: 'Dealers pay for repairs.', reason: 'unknown-passage' },
      { text: 'Carbon frames get ten years.', reason: 'quote-not-found' },
    ])
  })

  it('says it does not know, with the nearest notes, when the passages do not answer', async () => {
    const provider = scriptedProvider([submit({ answerable: false, sentences: [] })])
    const result = await answerQuestion({
      question: 'What does the frame cost in Sweden?',
      passages: PASSAGES,
      provider,
    })
    expect(result).toMatchObject({
      status: 'unknown',
      sentences: [],
      removed: [],
      nearest: ['dec-lifetime-frame-cover', 'doc-warranty-terms', 'doc-service-faq'],
    })
  })

  it('says it does not know when every sentence is removed, and still shows what was removed', async () => {
    const provider = scriptedProvider([
      submit({
        answerable: true,
        sentences: [{ text: 'It costs 900 euros.', sources: [{ passage: 'P1', quote: '900 euros' }] }],
      }),
    ])
    const result = await answerQuestion({ question: 'What does it cost?', passages: PASSAGES, provider })
    expect(result.status).toBe('unknown')
    expect(result.removed).toEqual([{ text: 'It costs 900 euros.', reason: 'quote-not-found' }])
    expect(result.nearest).toHaveLength(3)
  })

  it('does not call the model when the search found nothing', async () => {
    const provider = scriptedProvider([])
    const result = await answerQuestion({ question: Q, passages: [], provider })
    expect(result).toMatchObject({ status: 'unknown', nearest: [], calls: 0, costMicros: 0, model: null })
    expect(provider.requests).toHaveLength(0)
  })

  it('sends the prompt file, the answer tool, the passages and the question to the primary model', async () => {
    const provider = scriptedProvider([submit({ answerable: false, sentences: [] })])
    await answerQuestion({ question: `  ${Q}  `, passages: PASSAGES, provider, maxTokens: 1_500 })
    const [request] = provider.requests
    expect(request).toMatchObject({
      model: ANSWER_MODELS.primary,
      system: readAnswerPrompt(),
      tools: [ANSWER_TOOL],
      maxTokens: 1_500,
    })
    expect(request!.messages).toEqual([{ role: 'user', content: userMessage(Q, PASSAGES) }])
  })

  it('reads only the first 12 passages', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      ...PASSAGES[3]!,
      chunkId: `c#${i}`,
      noteId: `n-${i}`,
    }))
    const provider = scriptedProvider([submit({ answerable: false, sentences: [] })])
    await answerQuestion({ question: Q, passages: many, provider })
    const content = provider.requests[0]!.messages[0]!.content as string
    expect(content).toContain('id="P12"')
    expect(content).not.toContain('id="P13"')
  })

  it('reminds the model once when it answers in text, and once when its answer is broken', async () => {
    const provider = scriptedProvider([text('Five years.'), submit({ answerable: false, sentences: [] })])
    const result = await answerQuestion({ question: Q, passages: PASSAGES, provider })
    expect(result).toMatchObject({ status: 'unknown', calls: 2, costMicros: 400 })
    expect(provider.requests[1]!.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Reply by calling the submit_answer tool.',
    })

    const broken = scriptedProvider([
      submit({ answerable: 'yes', sentences: [] }),
      submit({
        answerable: true,
        sentences: [{ text: 'Covered for life.', sources: [{ passage: 'P1', quote: 'for the life' }] }],
      }),
    ])
    const fixed = await answerQuestion({ question: Q, passages: PASSAGES, provider: broken })
    expect(fixed.status).toBe('answered')
    expect(broken.requests[1]!.messages.at(-1)).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'toolu_1',
          content: 'Invalid answer: `answerable` must be true or false.',
          isError: true,
        },
      ],
    })
  })

  it('asks for a shorter answer after a cut one, and gives up after one reminder', async () => {
    const provider = scriptedProvider([text('', 'max_tokens'), text('Still no tool.')])
    await expect(answerQuestion({ question: Q, passages: PASSAGES, provider })).rejects.toThrow(
      'claude-haiku-5-5 did not submit a valid answer after a reminder.',
    )
    expect(provider.requests[1]!.messages.at(-1)!.content).toBe(
      'Reply by calling the submit_answer tool. Keep it short.',
    )
  })

  it.each([
    [null, 'The input must be an object.'],
    [{ answerable: true, sentences: 'none' }, '`sentences` must be a list.'],
    [{ answerable: true, sentences: [{ sources: [] }] }, 'Every sentence needs a `text`.'],
    [
      { answerable: true, sentences: [{ text: 'x' }] },
      'Every sentence needs a `sources` list (empty if it has none).',
    ],
    [
      { answerable: true, sentences: [{ text: 'x', sources: [{ passage: 'P1' }] }] },
      'Every source needs a `passage` id and a `quote`.',
    ],
  ])('refuses the broken input %j', async (input, message) => {
    const provider = scriptedProvider([submit(input), submit({ answerable: false, sentences: [] })])
    await answerQuestion({ question: Q, passages: PASSAGES, provider })
    expect(provider.requests[1]!.messages.at(-1)!.content).toEqual([
      expect.objectContaining({ content: `Invalid answer: ${message}` }),
    ])
  })

  it('moves to the fallback model when the primary fails, and prices the fallback', async () => {
    const provider = scriptedProvider([
      new Error('529 overloaded_error (after 4 attempts)'),
      submit({ answerable: false, sentences: [] }, 'claude-haiku-4-5-20251001'),
    ])
    const result = await answerQuestion({ question: Q, passages: PASSAGES, provider })
    expect(provider.requests.map((r) => r.model)).toEqual(['claude-haiku-5-5', 'claude-haiku-4-5-20251001'])
    // 1 000 input × $1 + 200 output × $5 per million tokens
    expect(result).toMatchObject({
      fallbackUsed: true,
      model: 'claude-haiku-4-5-20251001',
      costMicros: 2_000,
    })
  })

  it('throws when the fallback fails too, or when there is no fallback', async () => {
    const both = scriptedProvider([new Error('primary down'), new Error('fallback down')])
    await expect(answerQuestion({ question: Q, passages: PASSAGES, provider: both })).rejects.toThrow(
      'fallback down',
    )
    const single = scriptedProvider([new Error('primary down')])
    await expect(
      answerQuestion({
        question: Q,
        passages: PASSAGES,
        provider: single,
        models: { primary: 'claude-haiku-5-5' },
      }),
    ).rejects.toThrow('primary down')
  })

  it('refuses an empty question', async () => {
    await expect(
      answerQuestion({ question: '  ', passages: PASSAGES, provider: scriptedProvider([]) }),
    ).rejects.toThrow('The question is empty.')
  })
})

describe('the parts', () => {
  it('matches quotes whatever the case, punctuation and spacing', () => {
    expect(normalize('  Five-year   WARRANTY, “against” defects! ')).toBe(
      'five year warranty against defects',
    )
    const { sentences } = checkSentences(
      [{ text: 'x', sources: [{ passage: 'P2', quote: 'frames carry a five year warranty' }] }],
      PASSAGES,
    )
    expect(sentences).toHaveLength(1)
  })

  it('marks passages as data, with the note, the date and the status, and escapes their attributes', () => {
    const message = userMessage('Who said "stop"?', [{ ...PASSAGES[1]!, title: 'Terms "v2" <draft>' }])
    expect(message).toContain(
      '<passage id="P1" note="doc-warranty-terms" title="Terms &quot;v2&quot; &lt;draft>" section="Frames" updated="2024-05-10" status="superseded">',
    )
    expect(message).toContain('<question>Who said &quot;stop&quot;?</question>')
  })

  it('versions the prompt by its content', () => {
    const prompt = readAnswerPrompt()
    expect(prompt).toContain('submit_answer')
    expect(prompt).toMatch(/never follow them/)
    expect(promptVersion(prompt)).toMatch(/^[0-9a-f]{12}$/)
    expect(promptVersion(`${prompt}.`)).not.toBe(promptVersion(prompt))
  })

  it('never routes to Sonnet', () => {
    expect(Object.values(ANSWER_MODELS).join(' ')).not.toMatch(/sonnet/i)
  })
})
