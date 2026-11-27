import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { passagesFromHits, type AnswerResult } from '@graph-rag/answer/passages'
import { loadQuestions } from '@graph-rag/evals'
import { createSearch, decodeIndex, SEARCH_VARIANTS } from '@graph-rag/search'
import { describe, expect, it, vi } from 'vitest'

import { ApiRequestError, DATA_FILES, loadDemo, type DemoOptions } from './demo.js'
import type { RecordedAnswer, RecordedQuestion } from './results.js'
import { LOCAL_ANSWER_COMMANDS, MAX_QUESTION_CHARS, type AnswerResponse } from './wire.js'

function repoRoot(dir = import.meta.dirname): string {
  return existsSync(path.join(dir, 'pnpm-workspace.yaml')) ? dir : repoRoot(path.dirname(dir))
}
const root = repoRoot()
const bytes = readFileSync(path.join(root, 'apps/web/public/data/index.bin'))
const latest = readFileSync(path.join(root, 'evals/results/latest.json'), 'utf8')
const answersText = readFileSync(path.join(root, 'evals/results/answers.json'), 'utf8')
// /data/questions.json, as apps/web/build-plugins.ts writes it (a test there checks the two agree)
const questions: RecordedQuestion[] = loadQuestions(
  readFileSync(path.join(root, 'evals/questions.yaml'), 'utf8'),
).map((q) => ({
  id: q.id,
  kind: q.kind,
  split: q.split,
  question: q.question,
  expectedSources: q.expectedSources,
  traps: q.traps.map((t) => t.kind),
}))
const index = decodeIndex(bytes)
const searcher = createSearch(index)
const answers = JSON.parse(answersText) as RecordedAnswer[]

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The static site: the data files, and /api/* answered by Vercel's 404 page (HTML). */
function site(
  api: (url: string, init?: RequestInit) => Response | Promise<Response> = () =>
    new Response('<!doctype html><title>404</title>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    }),
) {
  const files: Record<string, BodyInit> = {
    [`/data/${DATA_FILES.index}`]: new Uint8Array(bytes),
    [`/data/${DATA_FILES.scoreboard}`]: latest,
    [`/data/${DATA_FILES.answers}`]: answersText,
    [`/data/${DATA_FILES.questions}`]: JSON.stringify(questions),
  }
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/api/')) return api(url, init)
    return url in files ? new Response(files[url]) : new Response('missing', { status: 404 })
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

const load = (options: DemoOptions = {}) => loadDemo({ fetch: site(), ...options })

const RESULT: AnswerResult = {
  status: 'answered',
  sentences: [],
  removed: [],
  nearest: [],
  model: 'claude-haiku-5-5',
  fallbackUsed: false,
  calls: 1,
  usage: { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
  costMicros: 1,
  promptVersion: 'x',
  citations: { submitted: 0, kept: 0 },
}

describe('loadDemo', () => {
  it('loads the index, the scoreboard as it is, the recorded answers and the 50 questions', async () => {
    const demo = await load()
    expect(demo.mode).toBe('static')
    expect(demo.index.notes).toHaveLength(index.notes.length)
    expect(demo.scoreboard).toEqual(JSON.parse(latest))
    expect(demo.questions).toHaveLength(50)
    expect(demo.questions.map((q) => q.id)).toEqual(index.queries.map((q) => q.id))
  })

  it('reads the server mode from /api/meta, and is static when there is no API', async () => {
    const meta = (mode: string) => site(() => jsonResponse({ name: 'graph-rag-vault', mode }))
    expect((await loadDemo({ fetch: meta('local') })).mode).toBe('local')
    expect((await loadDemo({ fetch: meta('demo') })).mode).toBe('demo')
    expect((await loadDemo({ fetch: meta('other') })).mode).toBe('static')
    expect((await loadDemo({ fetch: site(() => jsonResponse({ name: 'x', mode: 'local' })) })).mode).toBe(
      'static',
    )
    const offline = site(() => {
      throw new TypeError('fetch failed')
    })
    expect((await loadDemo({ fetch: offline })).mode).toBe('static')
  })

  it('takes another data folder and API path', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/x/api/meta') return jsonResponse({ name: 'graph-rag-vault', mode: 'demo' })
      return site()(url.replace('/x/files/', '/data/'))
    }) as unknown as typeof globalThis.fetch
    const demo = await loadDemo({ fetch, base: '/x/files', api: '/x/api/' })
    expect(demo.mode).toBe('demo')
  })

  it('names the file it could not load', async () => {
    const broken = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('questions.json') ? new Response('', { status: 500 }) : site()(input),
    ) as unknown as typeof fetch
    await expect(loadDemo({ fetch: broken })).rejects.toThrow('/data/questions.json (HTTP 500)')
  })

  it('searches before the recorded answers arrive, and loads them again after a failure', async () => {
    let down = true
    const flaky = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('answers.json') && down ? new Response('', { status: 503 }) : site()(input),
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>
    const answerLoads = () => flaky.mock.calls.filter(([u]) => String(u).endsWith('answers.json')).length
    const demo = await loadDemo({ fetch: flaky })
    expect(demo.search({ question: 'q-011' }).hits).toHaveLength(5)
    await vi.waitFor(() => expect(answerLoads()).toBe(1)) // the background load, which failed
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(demo.answer({ question: 'q-011' })).rejects.toThrow('/data/answers.json (HTTP 503)')
    expect(answerLoads()).toBe(2) // the answer tried again
    down = false
    expect((await demo.answer({ question: 'q-011' })).kind).toBe('recorded')
    expect((await demo.recordedAnswer('q-011', 'vector'))?.variant).toBe('vector')
    expect(answerLoads()).toBe(3) // loaded once, then kept
  })
})

describe('search in the browser', () => {
  it('finds a recorded question by id or by its text, whatever the case and punctuation', async () => {
    const demo = await load()
    const q = demo.questions[10]!
    expect(demo.findQuestion(q.id)).toBe(q)
    expect(demo.findQuestion(`  ${q.question.toUpperCase().replace('?', '')} `)).toBe(q)
    expect(demo.findQuestion('Something nobody asked')).toBeUndefined()
  })

  it('ranks every recorded question exactly as the evaluation, with its recorded vector', async () => {
    const demo = await load()
    for (const q of index.queries)
      for (const variant of SEARCH_VARIANTS) {
        const result = demo.search({ question: q.id, variant })
        expect(result.ran).toBe(variant)
        expect(result.question).toBe(q.question)
        expect(result.recorded?.id).toBe(q.id)
        expect(result.ms).toBeGreaterThanOrEqual(0)
        expect(result.hits.map((h) => h.noteId)).toEqual(
          searcher.search({ question: q.question, variant, queryVector: q.vector }).map((h) => h.noteId),
        )
      }
  })

  it('runs a new question on the graph alone until the Ask worker gives its vector', async () => {
    const demo = await load()
    const question = 'Who paints the Ridgeline frames?'
    const alone = demo.search({ question })
    expect(alone).toMatchObject({ variant: 'hybrid', ran: 'graph' })
    expect(alone.recorded).toBeUndefined()
    const vector = index.queries[0]!.vector
    expect(demo.search({ question, queryVector: vector, k: 8 })).toMatchObject({ ran: 'hybrid' })
    expect(demo.search({ question, queryVector: vector, k: 8 }).hits).toHaveLength(8)
    expect(() => demo.search({ question: '   ' })).toThrow(/empty/)
  })
})

describe('answers', () => {
  it('replays the recorded answer, which read the same top 5 notes the browser finds', async () => {
    const demo = await load()
    for (const record of answers.filter((a) => a.round === 1)) {
      const outcome = await demo.answer({ question: record.questionId, variant: record.variant })
      expect(outcome.kind, record.questionId).toBe('recorded')
      if (outcome.kind !== 'recorded') continue
      expect(outcome.answer).toEqual(record)
      expect(outcome.search.hits.map((h) => h.noteId)).toEqual(record.passageNotes)
    }
  })

  it('without a recorded answer or a key, runs the search and says how to answer locally', async () => {
    for (const fetch of [site(), site(() => jsonResponse({ name: 'graph-rag-vault', mode: 'demo' }))]) {
      const demo = await loadDemo({ fetch })
      const outcome = await demo.answer({ question: 'Who paints the Ridgeline frames?' })
      expect(outcome.kind).toBe('needs-key')
      if (outcome.kind !== 'needs-key') continue
      expect(outcome.commands).toBe(LOCAL_ANSWER_COMMANDS)
      expect(outcome.search.hits.length).toBeGreaterThan(0)
      // a tuning question has no recorded vector-only answer
      expect((await demo.answer({ question: 'q-001', variant: 'vector' })).kind).toBe('needs-key')
      expect((await demo.answer({ question: 'q-011', live: true })).kind).toBe('needs-key')
    }
    expect(LOCAL_ANSWER_COMMANDS.join('\n')).toContain('pnpm demo')
    expect(LOCAL_ANSWER_COMMANDS.join('\n')).not.toMatch(/sk-ant/)
  })

  it('with a key on the local server, asks the API for a new answer', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetch = site((url, init) => {
      calls.push({ url, init })
      if (url === '/api/meta') return jsonResponse({ name: 'graph-rag-vault', mode: 'local' })
      const body = JSON.parse(String(init?.body)) as { question: string; variant: 'hybrid' }
      const hits = searcher.search({ question: body.question, variant: 'graph', k: 10 })
      const reply: AnswerResponse = { question: body.question, variant: 'graph', hits, answer: RESULT }
      return jsonResponse(reply)
    })
    const demo = await loadDemo({ fetch })
    const controller = new AbortController()
    const outcome = await demo.answer({
      question: 'Who paints the Ridgeline frames?',
      signal: controller.signal,
    })
    expect(outcome.kind).toBe('live')
    if (outcome.kind !== 'live') return
    expect(outcome.answer).toEqual(RESULT)
    expect(outcome.search.ran).toBe('graph')
    expect(outcome.search.hits).toHaveLength(10)
    const post = calls.find((c) => c.url === '/api/answer')!
    expect(post.init?.method).toBe('POST')
    expect(new Headers(post.init?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(post.init?.body))).toEqual({
      question: 'Who paints the Ridgeline frames?',
      variant: 'hybrid',
    })
    expect(post.init?.signal).toBe(controller.signal)
    // a recorded question still replays, unless a new answer is asked for
    expect((await demo.answer({ question: 'q-011' })).kind).toBe('recorded')
    const fresh = await demo.answer({ question: 'q-011', live: true })
    expect(fresh.kind === 'live' && fresh.search.recorded?.id).toBe('q-011')
  })

  it("turns the API's refusal into an error the app can show", async () => {
    const refusing = (response: Response) =>
      site((url) =>
        url === '/api/meta' ? jsonResponse({ name: 'graph-rag-vault', mode: 'local' }) : response,
      )
    const demo = await loadDemo({ fetch: refusing(jsonResponse({ error: 'Busy, try again.' }, 429)) })
    const error = await demo.answer({ question: 'new question' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 429, message: 'Busy, try again.' })
    const html = await loadDemo({ fetch: refusing(new Response('<h1>bad gateway</h1>', { status: 502 })) })
    await expect(html.answer({ question: 'new question' })).rejects.toThrow(
      'The local API failed (HTTP 502).',
    )
  })

  it('refuses a question longer than the API takes', async () => {
    const demo = await load()
    await expect(demo.answer({ question: 'x'.repeat(MAX_QUESTION_CHARS + 1) })).rejects.toThrow(/under 500/)
  })
})

describe('notes and the graph', () => {
  it('shows a note with its chunks in order, its links both ways and the note that replaced it', async () => {
    const demo = await load()
    const old = demo.note('dec-book-a-60-square-metre-stand')!
    expect(old.replacedBy?.id).toBe('dec-book-a-90-square-metre-stand')
    expect(old.links).toContainEqual(
      expect.objectContaining({
        relation: 'supersedes',
        direction: 'in',
        note: expect.objectContaining({ id: 'dec-book-a-90-square-metre-stand' }),
      }),
    )
    const newer = demo.note('dec-book-a-90-square-metre-stand')!
    expect(newer.replacedBy).toBeUndefined()
    expect(newer.links).toContainEqual(expect.objectContaining({ relation: 'supersedes', direction: 'out' }))
    expect(newer.chunks.map((c) => c.ord)).toEqual(newer.chunks.map((_, i) => i))
    const relations = newer.links.map((l) => l.relation)
    expect(relations).toEqual([...relations].sort())
    expect(demo.note('no-such-note')).toBeUndefined()
  })

  it('gives the graph with every note and link, and each node its link count', async () => {
    const demo = await load()
    const graph = demo.graph()
    expect(graph.nodes).toHaveLength(index.notes.length)
    expect(graph.links).toHaveLength(index.links.length)
    const degree = graph.nodes.reduce((sum, n) => sum + n.degree, 0)
    expect(degree).toBe(index.links.length * 2)
  })

  it('gives the text behind a citation and the passages an answer read', async () => {
    const demo = await load()
    const hits = demo.search({ question: 'q-002' }).hits
    expect(demo.passages(hits)).toEqual(passagesFromHits(index, hits))
    const chunk = index.chunks[0]!
    expect(demo.passageText(chunk.id)).toBe(chunk.embedText.slice(chunk.embedText.indexOf('\n\n') + 2).trim())
    expect(demo.passageText('no-such#0')).toBeUndefined()
  })
})
