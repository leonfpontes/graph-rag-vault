// The API as a fetch handler (Request → Response): the same code runs in the local Node server and
// in tests, with no framework. Reads are GET (HEAD too); the one write is POST /api/answer, which
// spends the person's own key, so it takes JSON only, from this server's own page or a tool that
// sends no Origin, one at a time. Every request must name a loopback host, so a web page that
// rebinds its domain to 127.0.0.1 gets nothing. Errors are `{ error }` and never echo the request.
import { passagesFromHits, type AnswerResult, type Passage } from '@graph-rag/answer'
import {
  createVault,
  MAX_QUESTION_CHARS,
  type AnswerResponse,
  type ApiMeta,
  type ServerMode,
} from '@graph-rag/client'
import { createSearch, SEARCH_VARIANTS, type SearchIndex, type SearchVariant } from '@graph-rag/search'

export type ApiMode = ServerMode

export interface ApiOptions {
  /** The search index (apps/web/public/data/index.bin). Without it, only /api/meta answers. */
  index?: SearchIndex
  /**
   * Writes an answer from the passages: there only when the person's key is set. With it the server
   * is in `local` mode; without it, `demo` (POST /api/answer gets 503).
   */
  answer?: (question: string, passages: Passage[]) => Promise<AnswerResult>
  /** Embeds a question with no recorded vector (the model loads on first use). */
  embedQuery?: (question: string) => Promise<Float32Array>
  /** Where a line per answer goes (never the question or the key). Default: console.log. */
  log?: (line: string) => void
}

/** Largest body POST /api/answer reads, in bytes (the Node server enforces it while reading). */
export const MAX_BODY_BYTES = 8 * 1024
/** Results the search route returns at most. */
export const MAX_K = 50
/** Results the answer route returns; the answer reads the passages of the first 5 notes. */
export const ANSWER_HITS = 10

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })

const error = (status: number, message: string, headers: Record<string, string> = {}) =>
  json(status, { error: message }, headers)

/** A loopback host with an optional port: 127.0.0.1, localhost or [::1]. */
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i

/** The GET and HEAD routes; POST /api/answer is the only other one. */
const READ_ROUTES = /^\/api\/(meta|search|graph|notes\/[^/]+)$/

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

export function createApi({ index, answer, embedQuery, log = console.log }: ApiOptions = {}) {
  const mode: ApiMode = answer ? 'local' : 'demo'
  const searcher = index && createSearch(index)
  const vault = index && createVault(index)
  const recorded = new Map(index?.queries.map((q) => [words(q.question), q]) ?? [])
  let busy = false

  /** The question's vector: the recorded one, else the embedder's, else none (graph only). */
  async function vectorFor(question: string): Promise<Float32Array | undefined> {
    return recorded.get(words(question))?.vector ?? (embedQuery ? await embedQuery(question) : undefined)
  }

  async function search(question: string, variant: SearchVariant, k: number) {
    const queryVector = variant === 'graph' ? undefined : await vectorFor(question)
    const ran: SearchVariant = variant !== 'graph' && !queryVector ? 'graph' : variant
    return { ran, hits: searcher!.search({ question, variant: ran, queryVector, k }) }
  }

  /** The question and variant of a request, or the error to send. */
  function readQuestion(question: unknown, variant: unknown): Response | [string, SearchVariant] {
    if (typeof question !== 'string' || !question.trim()) return error(400, 'Send a non-empty question.')
    if (question.length > MAX_QUESTION_CHARS)
      return error(400, `Keep the question under ${MAX_QUESTION_CHARS} characters.`)
    if (typeof variant !== 'string' || !(SEARCH_VARIANTS as readonly string[]).includes(variant))
      return error(400, `The variant must be one of: ${SEARCH_VARIANTS.join(', ')}.`)
    return [question.trim(), variant as SearchVariant]
  }

  async function postAnswer(request: Request): Promise<Response> {
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
      return error(415, 'Send the question as JSON (content-type: application/json).')
    if (!answer)
      return error(
        503,
        'This server has no Anthropic key, so it only replays recorded answers. Put ANTHROPIC_API_KEY in .env.local and restart pnpm demo.',
      )
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return error(400, 'The body is not valid JSON.')
    }
    const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
    const read = readQuestion(fields.question, fields.variant ?? 'hybrid')
    if (read instanceof Response) return read
    const [question, variant] = read
    if (busy) return error(429, 'An answer is already being written. Try again when it is done.')
    busy = true
    const start = Date.now()
    try {
      const { ran, hits } = await search(question, variant, ANSWER_HITS)
      const result = await answer(question, passagesFromHits(index!, hits))
      log(
        `answer · ${ran} · ${result.status} · ${result.calls} call(s) · $${(result.costMicros / 1e6).toFixed(4)} · ${Date.now() - start} ms`,
      )
      const reply: AnswerResponse = { question, variant: ran, hits, answer: result }
      return json(200, reply)
    } catch (e) {
      console.error('The answer failed:', (e as Error).message)
      return error(502, 'The answer failed. The server log says why.')
    } finally {
      busy = false
    }
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url
    const host = request.headers.get('host') ?? url.host
    if (!LOOPBACK.test(host)) return error(403, 'This server answers on 127.0.0.1 only.')

    if (pathname === '/api/answer') {
      if (request.method !== 'POST') return error(405, 'Ask with POST and a JSON body.', { allow: 'POST' })
      const origin = request.headers.get('origin')
      if (
        (origin !== null && origin !== `http://${host}`) ||
        request.headers.get('sec-fetch-site') === 'cross-site'
      )
        return error(403, 'Answers are only written for pages of this server.')
      if (!index) return error(503, 'The server has no search index.')
      return postAnswer(request)
    }

    if (!READ_ROUTES.test(pathname))
      // Never echo the path back: it is input.
      return error(404, 'No such endpoint. See docs/ARCHITECTURE.md for the API.')
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return error(405, `${request.method} is not allowed here: this route is read-only.`, {
        allow: 'GET, HEAD',
      })
    if (pathname === '/api/meta') {
      const meta: ApiMeta = { name: 'graph-rag-vault', mode }
      return json(200, meta)
    }
    if (!index || !searcher || !vault) return error(503, 'The server has no search index.')

    if (pathname === '/api/graph') return json(200, vault.graph())
    if (pathname.startsWith('/api/notes/')) {
      let id: string
      try {
        id = decodeURIComponent(pathname.slice('/api/notes/'.length))
      } catch {
        return error(400, 'The note id is not a valid URL part.')
      }
      const note = vault.note(id)
      return note ? json(200, note) : error(404, 'No note with that id.')
    }

    // /api/search?q=…&variant=hybrid&k=5
    const read = readQuestion(url.searchParams.get('q') ?? '', url.searchParams.get('variant') ?? 'hybrid')
    if (read instanceof Response) return read
    const [question, variant] = read
    const k = Number(url.searchParams.get('k') ?? 5)
    if (!Number.isInteger(k) || k < 1 || k > MAX_K)
      return error(400, `k must be a whole number from 1 to ${MAX_K}.`)
    try {
      const { ran, hits } = await search(question, variant, k)
      return json(200, { question, variant, ran, hits })
    } catch (e) {
      console.error('The search failed:', (e as Error).message)
      return error(502, 'The question could not be embedded. The server log says why.')
    }
  }
}
