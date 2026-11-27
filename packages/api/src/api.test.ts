import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  answerQuestion,
  passagesFromHits,
  scriptedProvider,
  type AnswerResult,
  type Passage,
} from '@graph-rag/answer'
import type { AnswerResponse, NoteView } from '@graph-rag/client'
import { createSearch, decodeIndex, type SearchHit } from '@graph-rag/search'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  ANSWER_HITS,
  createApi,
  DEFAULT_PORT,
  MAX_BODY_BYTES,
  parseServeArgs,
  readBody,
  serveHttp,
  staticFile,
} from './index.js'

/** The repository root: up from here to pnpm-workspace.yaml. */
function repoRoot(dir = import.meta.dirname): string {
  return existsSync(path.join(dir, 'pnpm-workspace.yaml')) ? dir : repoRoot(path.dirname(dir))
}
const index = decodeIndex(readFileSync(path.join(repoRoot(), 'apps/web/public/data/index.bin')))
const recorded = index.queries[10]! // q-011, a test question
const searcher = createSearch(index)

const HOST = 'http://127.0.0.1:8787'
const get = (route: string, headers: Record<string, string> = {}) =>
  new Request(HOST + route, { headers: { host: '127.0.0.1:8787', ...headers } })
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${HOST}/api/answer`, {
    method: 'POST',
    headers: { host: '127.0.0.1:8787', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const RESULT: AnswerResult = {
  status: 'answered',
  sentences: [{ text: 'A fact.', citations: [{ chunkId: 'x#0', noteId: 'x', quote: 'fact' }] }],
  removed: [],
  nearest: [],
  model: 'claude-haiku-5-5',
  fallbackUsed: false,
  calls: 1,
  usage: { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
  costMicros: 420,
  promptVersion: 'test',
  citations: { submitted: 1, kept: 1 },
}

describe('API', () => {
  const demo = createApi({ index })

  it('says its mode: demo without a key, local with one', async () => {
    const res = await demo(get('/api/meta'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ name: 'graph-rag-vault', mode: 'demo' })
    const local = createApi({ index, answer: async () => RESULT })
    expect(await (await local(get('/api/meta'))).json()).toEqual({ name: 'graph-rag-vault', mode: 'local' })
    expect(await (await createApi()(get('/api/meta'))).json()).toMatchObject({ mode: 'demo' })
  })

  it('answers only requests that name a loopback host (no DNS rebinding)', async () => {
    for (const host of ['127.0.0.1:8787', 'localhost:5173', '[::1]:8787', '127.0.0.1'])
      expect((await demo(get('/api/meta', { host }))).status, host).toBe(200)
    for (const host of ['evil.example', 'evil.example:8787', '127.0.0.1.evil.example', '10.0.0.2:8787'])
      expect((await demo(get('/api/meta', { host }))).status, host).toBe(403)
  })

  it('answers an unknown endpoint with 404, without echoing the path', async () => {
    const res = await demo(get('/api/%3Cscript%3E'))
    expect(res.status).toBe(404)
    expect(await res.text()).not.toMatch(/script/i)
  })

  it('keeps the read routes read-only and the answer route POST-only, with Allow', async () => {
    const write = await demo(new Request(`${HOST}/api/meta`, { method: 'POST', body: '{}' }))
    expect(write.status).toBe(405)
    expect(write.headers.get('allow')).toBe('GET, HEAD')
    const read = await demo(get('/api/answer'))
    expect(read.status).toBe(405)
    expect(read.headers.get('allow')).toBe('POST')
  })

  it('without an index, says so instead of failing', async () => {
    const bare = createApi()
    expect((await bare(get('/api/graph'))).status).toBe(503)
    expect((await bare(post({ question: 'x' }))).status).toBe(503)
  })

  it('serves the graph and the notes from the index', async () => {
    const graph = (await (await demo(get('/api/graph'))).json()) as { nodes: unknown[]; links: unknown[] }
    expect(graph.nodes).toHaveLength(index.notes.length)
    expect(graph.links).toHaveLength(index.links.length)
    const id = index.chunks[0]!.noteId
    const note = (await (await demo(get(`/api/notes/${id}`))).json()) as NoteView
    expect(note.note.id).toBe(id)
    expect(note.chunks.map((c) => c.noteId)).toEqual(note.chunks.map(() => id))
    expect((await demo(get('/api/notes/no-such-note'))).status).toBe(404)
    expect((await demo(get('/api/notes/%E0%A4%A'))).status).toBe(400)
  })

  it('searches a recorded question with its recorded vector, as the evaluation does', async () => {
    const q = encodeURIComponent(recorded.question)
    const body = (await (await demo(get(`/api/search?q=${q}&k=5`))).json()) as {
      ran: string
      hits: SearchHit[]
    }
    expect(body.ran).toBe('hybrid')
    const expected = searcher.search({
      question: recorded.question,
      variant: 'hybrid',
      queryVector: recorded.vector,
      k: 5,
    })
    expect(body.hits.map((h) => h.noteId)).toEqual(expected.map((h) => h.noteId))
  })

  it('embeds a new question when it can, and falls back to the graph when it cannot', async () => {
    const free = '/api/search?q=Who%20paints%20the%20frames%3F'
    expect(((await (await demo(get(free))).json()) as { ran: string }).ran).toBe('graph')
    const embedQuery = vi.fn(async () => recorded.vector)
    const withModel = createApi({ index, embedQuery })
    expect(((await (await withModel(get(free))).json()) as { ran: string }).ran).toBe('hybrid')
    expect(embedQuery).toHaveBeenCalledWith('Who paints the frames?')
    // graph needs no vector: the model is not loaded for it
    await withModel(get(`${free}&variant=graph`))
    expect(embedQuery).toHaveBeenCalledTimes(1)
  })

  it('reports a failing embedder as 502 without its error text', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = createApi({
      index,
      embedQuery: async () => {
        throw new Error('model detail')
      },
    })
    const res = await broken(get('/api/search?q=new%20words'))
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('model detail')
    expect(errors).toHaveBeenCalledTimes(1)
    errors.mockRestore()
  })

  it('refuses a bad search: no question, too long, unknown variant, k out of range', async () => {
    for (const route of [
      '/api/search',
      '/api/search?q=%20',
      `/api/search?q=${'a'.repeat(501)}`,
      '/api/search?q=x&variant=bm25',
      '/api/search?q=x&k=0',
      '/api/search?q=x&k=51',
      '/api/search?q=x&k=2.5',
    ]) {
      const res = await demo(get(route))
      expect(res.status, route).toBe(400)
      expect(await res.text(), route).not.toContain('bm25')
    }
  })
})

describe('POST /api/answer', () => {
  it('without a key, says how to add one (503), and writes nothing', async () => {
    const res = await createApi({ index })(post({ question: recorded.question }))
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toContain('.env.local')
  })

  it('answers from the passages of its own search, the way the evaluation builds them', async () => {
    const answer = vi.fn(async (_q: string, _p: Passage[]) => RESULT)
    const lines: string[] = []
    const api = createApi({ index, answer, log: (line) => lines.push(line) })
    const res = await api(post({ question: `  ${recorded.question}  ` }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as AnswerResponse
    const hits = searcher.search({
      question: recorded.question,
      variant: 'hybrid',
      queryVector: recorded.vector,
      k: ANSWER_HITS,
    })
    expect(body.question).toBe(recorded.question)
    expect(body.variant).toBe('hybrid')
    expect(body.hits.map((h) => h.noteId)).toEqual(hits.map((h) => h.noteId))
    expect(body.answer).toEqual(RESULT)
    expect(answer).toHaveBeenCalledWith(recorded.question, passagesFromHits(index, hits))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('$0.0004')
    expect(lines[0]).not.toContain(recorded.question)
  })

  it('runs the real answer code end to end with a scripted model', async () => {
    const hits = searcher.search({
      question: recorded.question,
      variant: 'hybrid',
      queryVector: recorded.vector,
      k: ANSWER_HITS,
    })
    const first = passagesFromHits(index, hits)[0]!
    const quote = first.text.split(/\s+/).slice(0, 6).join(' ')
    const provider = scriptedProvider([
      {
        model: 'claude-haiku-5-5',
        stopReason: 'tool_use',
        usage: { inputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 80 },
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'submit_answer',
            input: {
              answerable: true,
              sentences: [
                { text: 'Quoted.', sources: [{ passage: 'P1', quote }] },
                { text: 'Made up.', sources: [] },
              ],
            },
          },
        ],
      },
    ])
    const api = createApi({
      index,
      answer: (question, passages) => answerQuestion({ question, passages, provider }),
      log: () => {},
    })
    const body = (await (await api(post({ question: recorded.question }))).json()) as AnswerResponse
    expect(body.answer.status).toBe('answered')
    expect(body.answer.sentences[0]!.citations[0]!.chunkId).toBe(first.chunkId)
    expect(body.answer.removed).toEqual([{ text: 'Made up.', reason: 'no-source' }])
    expect(provider.requests).toHaveLength(1)
  })

  it('takes JSON only, from its own pages or from a tool with no Origin', async () => {
    const api = createApi({ index, answer: async () => RESULT, log: () => {} })
    const ok = { question: recorded.question }
    expect((await api(post(ok))).status).toBe(200)
    expect((await api(post(ok, { origin: 'http://127.0.0.1:8787' }))).status).toBe(200)
    expect((await api(post(ok, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await api(post(ok, { origin: 'http://127.0.0.1:9999' }))).status).toBe(403)
    expect((await api(post(ok, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    // a plain form post (no preflight) is refused before anything runs
    expect((await api(post(ok, { 'content-type': 'text/plain' }))).status).toBe(415)
  })

  it('refuses a bad body without echoing it', async () => {
    const answer = vi.fn(async () => RESULT)
    const api = createApi({ index, answer })
    for (const body of [
      '{not json',
      '[]',
      'null',
      { question: '' },
      { question: 42 },
      { question: 'x'.repeat(501) },
      { question: 'ok', variant: '<script>' },
    ]) {
      const res = await api(post(body))
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.text()).not.toContain('<script>')
    }
    expect(answer).not.toHaveBeenCalled()
  })

  it('writes one answer at a time: a second request while one runs gets 429', async () => {
    let release!: () => void
    const answer = vi.fn(() => new Promise<AnswerResult>((resolve) => (release = () => resolve(RESULT))))
    const api = createApi({ index, answer, log: () => {} })
    const first = api(post({ question: recorded.question }))
    await vi.waitFor(() => expect(answer).toHaveBeenCalled())
    expect((await api(post({ question: recorded.question }))).status).toBe(429)
    release()
    expect((await first).status).toBe(200)
    answer.mockImplementation(async () => RESULT)
    expect((await api(post({ question: recorded.question }))).status).toBe(200)
  })

  it('reports a failing model as 502 without its error text, and frees the route', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const answer = vi.fn(async (): Promise<AnswerResult> => {
      throw new Error('401 authentication_error: invalid x-api-key')
    })
    const api = createApi({ index, answer })
    const res = await api(post({ question: recorded.question }))
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('x-api-key')
    expect(errors).toHaveBeenCalledTimes(1)
    answer.mockResolvedValueOnce(RESULT)
    expect((await api(post({ question: recorded.question }))).status).toBe(200)
    errors.mockRestore()
  })
})

// ── The Node server ─────────────────────────────────────────────────────────────────────────────
const dist = mkdtempSync(path.join(tmpdir(), 'graph-rag-web-'))
mkdirSync(path.join(dist, 'assets'))
writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>graph-rag-vault</title>')
writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)')
writeFileSync(path.join(dist, 'assets', 'runtime.mjs'), 'export {}')
writeFileSync(path.join(dist, 'assets', 'runtime.wasm'), new Uint8Array([0, 97, 115, 109]))
const received: number[] = []
const server = serveHttp(
  async (request) => {
    if (request.method === 'POST') received.push((await request.arrayBuffer()).byteLength)
    return createApi({ index })(request)
  },
  { port: 0, staticDir: dist },
)
await new Promise((resolve) => server.once('listening', resolve))
const port = (server.address() as AddressInfo).port
const base = `http://127.0.0.1:${port}`
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  rmSync(dist, { recursive: true, force: true })
})

/** A POST sent in chunks, with no Content-Length. */
function chunkedPost(bytes: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${base}/api/answer`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } },
      (res) => {
        res.resume()
        resolve(res.statusCode!)
      },
    )
    req.on('error', reject)
    const chunk = 'x'.repeat(1024)
    for (let sent = 0; sent < bytes; sent += chunk.length) req.write(chunk)
    req.end()
  })
}

describe('local server', () => {
  it('serves the API and the built app on one port', async () => {
    expect(await (await fetch(`${base}/api/meta`)).json()).toEqual({ name: 'graph-rag-vault', mode: 'demo' })
    const asset = await fetch(`${base}/assets/app.js`)
    expect(asset.headers.get('content-type')).toContain('javascript')
    // The Ask worker's runtime: a module import needs a JavaScript type, and WebAssembly its own.
    expect((await fetch(`${base}/assets/runtime.mjs`)).headers.get('content-type')).toContain('javascript')
    expect((await fetch(`${base}/assets/runtime.wasm`)).headers.get('content-type')).toBe('application/wasm')
    const head = await fetch(`${base}/`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  it('opens the app on its routes, and gives anything else the app with a real 404', async () => {
    for (const route of ['/', '/explore', '/ask?q=q-011', '/evaluation', '/notes/per-maya-okafor', '/ask/']) {
      const res = await fetch(base + route)
      expect(res.status, route).toBe(200)
      expect(await res.text()).toContain('graph-rag-vault')
    }
    for (const route of ['/nope', '/notes/Bad_Id', '/notes/a/b', '/asks', '/data/missing.json']) {
      const res = await fetch(base + route)
      expect(res.status, route).toBe(404)
      expect(await res.text()).toContain('graph-rag-vault')
    }
  })

  it('never serves a file outside the app folder', async () => {
    expect((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).status).toBe(404)
    expect(staticFile(dist, '/../../etc/passwd')).toBeUndefined() // a raw path that climbs out
    expect(staticFile(dist, '/assets/../index.html')).toBe(path.join(dist, 'index.html'))
    expect(staticFile(dist, '/assets')).toBeUndefined() // a folder
    expect(staticFile(dist, '/%E0%A4%A')).toBeUndefined() // broken escape
    expect(staticFile(path.join(dist, 'missing'), '/x')).toBeUndefined()
  })

  it('passes a small body to the API and cuts a large one at the limit, with or without a length', async () => {
    const small = await fetch(`${base}/api/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'x' }),
    })
    expect(small.status).toBe(503) // no key: the body reached the API
    expect(received.at(-1)).toBe(JSON.stringify({ question: 'x' }).length)
    const before = received.length
    const big = await fetch(`${base}/api/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(MAX_BODY_BYTES + 1),
    })
    expect(big.status).toBe(413)
    expect(await chunkedPost(MAX_BODY_BYTES * 4)).toBe(413)
    expect(received).toHaveLength(before) // the handler never saw either
  })

  it('passes the Host and Origin the client sent, so the API can refuse them', async () => {
    const raw = (method: string, route: string, headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest(`${base}${route}`, { method, headers }, (res) => {
          res.resume()
          resolve(res.statusCode!)
        })
        req.on('error', reject)
        req.end(method === 'POST' ? JSON.stringify({ question: 'x' }) : undefined)
      })
    expect(await raw('GET', '/api/meta', { host: 'evil.example:80' })).toBe(403)
    expect(await raw('GET', '/api/meta', { host: `localhost:${port}` })).toBe(200)
    const json = { 'content-type': 'application/json' }
    expect(await raw('POST', '/api/answer', { ...json, origin: 'https://evil.example' })).toBe(403)
    expect(await raw('POST', '/api/answer', { ...json, origin: base })).toBe(503) // own page, no key
  })

  it('refuses writes to the app and to the read routes', async () => {
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/api/meta`, { method: 'DELETE' })).status).toBe(405)
  })

  it('without a built app, says how to build it', async () => {
    const bare = serveHttp(createApi(), { port: 0 })
    await new Promise((resolve) => bare.once('listening', resolve))
    const res = await fetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}/`)
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('pnpm build')
    await new Promise((resolve) => bare.close(resolve))
  })

  it('fails on a busy port instead of moving to another one', async () => {
    const second = serveHttp(createApi(), { port })
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => second.once('error', resolve))
    expect(error.code).toBe('EADDRINUSE')
  })

  it('reports a failing handler as 500 without the error text', async () => {
    const broken = serveHttp(
      async () => {
        throw new Error('secret detail')
      },
      { port: 0 },
    )
    await new Promise((resolve) => broken.once('listening', resolve))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await fetch(`http://127.0.0.1:${(broken.address() as AddressInfo).port}/api/meta`)
      expect(res.status).toBe(500)
      expect(await res.text()).not.toContain('secret detail')
      expect(errors).toHaveBeenCalledTimes(1)
    } finally {
      errors.mockRestore()
      await new Promise((resolve) => broken.close(resolve))
    }
  })
})

describe('readBody', () => {
  it('reads up to the limit and refuses past it', async () => {
    const { Readable } = await import('node:stream')
    const from = (parts: string[], headers: Record<string, string> = {}) =>
      Object.assign(Readable.from(parts.map((p) => Buffer.from(p))), { headers }) as never
    expect((await readBody(from(['ab', 'cd']), 4))?.toString()).toBe('abcd')
    expect(await readBody(from(['ab', 'cde']), 4)).toBeUndefined()
    expect(await readBody(from([], { 'content-length': '5' }), 4)).toBeUndefined()
  })
})

describe('server options', () => {
  it('takes --port, then PORT, then the default, and drops a stray --', () => {
    expect(parseServeArgs(['serve'])).toEqual({ command: 'serve', port: DEFAULT_PORT, noKey: false })
    expect(parseServeArgs(['serve'], { PORT: '9001' }).port).toBe(9001)
    expect(parseServeArgs(['serve', '--', '--port', '8891'], { PORT: '9001' }).port).toBe(8891)
    expect(parseServeArgs([]).command).toBeUndefined()
  })

  it('takes --no-key, which keeps the key unread', () => {
    expect(parseServeArgs(['serve', '--no-key']).noKey).toBe(true)
  })

  it('refuses a port that is not a number from 1 to 65535', () => {
    for (const bad of ['0', '65536', '80a', '-1', '8.5', ''])
      expect(() => parseServeArgs(['serve', `--port=${bad}`]), bad).toThrow(/1 to 65535/)
  })
})
