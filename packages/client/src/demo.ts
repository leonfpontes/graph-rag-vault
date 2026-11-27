// The demo in the browser, with no key and no server: the index file feeds the same search the
// evaluation measures, the 50 recorded questions use their recorded embeddings and get their
// recorded answers at once, and the scoreboard comes from latest.json as it is. When the page is
// served by `pnpm demo` with the person's key, new questions get a written answer from the local
// API; without it, the search still runs and the app shows how to get answers locally.
import {
  passagesFromHits,
  passageTextById,
  type AnswerResult,
  type Passage,
} from '@graph-rag/answer/passages'
import {
  createSearch,
  decodeIndex,
  type SearchHit,
  type SearchIndex,
  type SearchVariant,
} from '@graph-rag/search'

import { recordedAnswerFor, type RecordedAnswer, type RecordedQuestion, type Scoreboard } from './results.js'
import { createVault, type GraphView, type NoteView } from './vault.js'
import {
  LOCAL_ANSWER_COMMANDS,
  MAX_QUESTION_CHARS,
  type AnswerRequest,
  type AnswerResponse,
  type ApiMeta,
  type ServerMode,
} from './wire.js'

/** `static`: the public site, no API. `demo`: local server, no key. `local`: local server with a key. */
export type DemoMode = 'static' | ServerMode

/** The files the demo reads, under `base` (default `/data/`). */
export const DATA_FILES = {
  index: 'index.bin',
  scoreboard: 'latest.json',
  answers: 'answers.json',
  questions: 'questions.json',
} as const

export interface DemoOptions {
  /** Folder of the data files (default `/data/`). */
  base?: string
  /** Where the local API is (default `/api`). */
  api?: string
  fetch?: typeof fetch
  /** How long to wait for the API before deciding the site is static (default 2 s). */
  metaTimeoutMs?: number
}

export interface SearchOptions {
  /** Any text, or a recorded question's id (`q-011`). */
  question: string
  /** Default `hybrid`. */
  variant?: SearchVariant
  /** The question's embedding from the Ask worker. Recorded questions don't need it. */
  queryVector?: Float32Array
  /** Results to return (default 5). */
  k?: number
}

export interface SearchOutcome {
  /** The question as searched (a recorded question's text when an id was given). */
  question: string
  /** The variant asked for. */
  variant: SearchVariant
  /** The variant that ran: `graph` when `vector` or `hybrid` had no embedding for the question. */
  ran: SearchVariant
  hits: SearchHit[]
  /** The recorded question this is, when the text or id matches one. */
  recorded?: RecordedQuestion
  /** Milliseconds the search took (in this browser; for a live answer, the whole request). */
  ms: number
}

export type AnswerOutcome =
  /** A recorded question: the answer from the evaluation run, at once, with no model. */
  | { kind: 'recorded'; search: SearchOutcome; answer: RecordedAnswer }
  /** A new answer from the local API, with the person's key. */
  | { kind: 'live'; search: SearchOutcome; answer: AnswerResult }
  /** No recorded answer and no key: the search results, and the commands to answer locally. */
  | { kind: 'needs-key'; search: SearchOutcome; commands: readonly string[] }

/** The local API refused or failed: `message` is safe to show. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export interface Demo {
  mode: DemoMode
  index: SearchIndex
  scoreboard: Scoreboard
  /** The 50 questions, in file order. */
  questions: RecordedQuestion[]
  /** A recorded question by id (`q-011`) or by its text (case and punctuation ignored). */
  findQuestion(idOrText: string): RecordedQuestion | undefined
  note(id: string): NoteView | undefined
  graph(): GraphView
  /** The text an answer read for a citation: a chunk id, or `<noteId>#links`. */
  passageText(id: string): string | undefined
  /** The passages an answer reads from these hits (the chunks and links of the top 5 notes). */
  passages(hits: readonly SearchHit[]): Passage[]
  search(options: SearchOptions): SearchOutcome
  /**
   * Round 1 of that variant for a recorded question, if the evaluation recorded it. The answers file
   * loads after the rest (it is not needed for the first search), so this waits for it once.
   */
  recordedAnswer(questionId: string, variant?: SearchVariant): Promise<RecordedAnswer | undefined>
  /**
   * The answer to show: recorded when there is one (unless `live`), else from the local API when it
   * has a key, else the search alone with the commands to answer locally.
   */
  answer(options: SearchOptions & { live?: boolean; signal?: AbortSignal }): Promise<AnswerOutcome>
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

async function readFile(doFetch: typeof fetch, url: string): Promise<Response> {
  const res = await doFetch(url)
  if (!res.ok) throw new Error(`The demo could not load ${url} (HTTP ${res.status}).`)
  return res
}

/** The server mode from GET /api/meta, or `static` when there is no API (the public site). */
async function detectMode(doFetch: typeof fetch, api: string, timeoutMs: number): Promise<DemoMode> {
  try {
    const res = await doFetch(`${api}/meta`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return 'static'
    const meta = (await res.json()) as Partial<ApiMeta>
    return meta.name === 'graph-rag-vault' && (meta.mode === 'local' || meta.mode === 'demo')
      ? meta.mode
      : 'static'
  } catch {
    return 'static'
  }
}

export async function loadDemo(options: DemoOptions = {}): Promise<Demo> {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const base = (options.base ?? '/data/').replace(/\/?$/, '/')
  const api = (options.api ?? '/api').replace(/\/$/, '')
  const [mode, bytes, scoreboard, questions] = await Promise.all([
    detectMode(doFetch, api, options.metaTimeoutMs ?? 2000),
    readFile(doFetch, base + DATA_FILES.index).then(async (r) => new Uint8Array(await r.arrayBuffer())),
    readFile(doFetch, base + DATA_FILES.scoreboard).then((r) => r.json() as Promise<Scoreboard>),
    readFile(doFetch, base + DATA_FILES.questions).then((r) => r.json() as Promise<RecordedQuestion[]>),
  ])
  // The recorded answers (the largest file after the index) load next, off the first search's path.
  let answersLoad: Promise<RecordedAnswer[]> | undefined
  const loadAnswers = () =>
    (answersLoad ??= readFile(doFetch, base + DATA_FILES.answers)
      .then((r) => r.json() as Promise<RecordedAnswer[]>)
      .catch((e: unknown) => {
        answersLoad = undefined // the next answer tries again
        throw e
      }))
  loadAnswers().catch(() => {})
  const index = decodeIndex(bytes)
  const searcher = createSearch(index)
  const vault = createVault(index)
  const vectors = new Map(index.queries.map((q) => [q.id, q.vector]))
  const byId = new Map(questions.map((q) => [q.id, q]))
  const byText = new Map(questions.map((q) => [words(q.question), q]))

  const findQuestion = (idOrText: string) => byId.get(idOrText.trim()) ?? byText.get(words(idOrText))

  const search = ({ question, variant = 'hybrid', queryVector, k = 5 }: SearchOptions): SearchOutcome => {
    const recorded = findQuestion(question)
    const text = recorded?.question ?? question.trim()
    if (!text) throw new Error('The question is empty.')
    const vector = queryVector ?? (recorded ? vectors.get(recorded.id) : undefined)
    const ran: SearchVariant = variant !== 'graph' && !vector ? 'graph' : variant
    const start = now()
    const hits = searcher.search({ question: text, variant: ran, queryVector: vector, k })
    return { question: text, variant, ran, hits, ...(recorded ? { recorded } : {}), ms: now() - start }
  }

  const recordedAnswer = async (questionId: string, variant: SearchVariant = 'hybrid') =>
    recordedAnswerFor(await loadAnswers(), questionId, variant)

  async function liveAnswer(
    request: Required<AnswerRequest>,
    recorded: RecordedQuestion | undefined,
    signal?: AbortSignal,
  ): Promise<AnswerOutcome> {
    const start = now()
    const res = await doFetch(`${api}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown }
      throw new ApiRequestError(
        typeof body.error === 'string' ? body.error : `The local API failed (HTTP ${res.status}).`,
        res.status,
      )
    }
    const body = (await res.json()) as AnswerResponse
    return {
      kind: 'live',
      answer: body.answer,
      search: {
        question: body.question,
        variant: body.variant,
        ran: body.variant,
        hits: body.hits,
        ...(recorded ? { recorded } : {}),
        ms: now() - start,
      },
    }
  }

  return {
    mode,
    index,
    scoreboard,
    questions,
    findQuestion,
    note: vault.note,
    graph: vault.graph,
    passageText: (id) => passageTextById(index, id),
    passages: (hits) => passagesFromHits(index, hits),
    search,
    recordedAnswer,
    async answer({ live = false, signal, ...options }) {
      const result = search(options)
      if (result.question.length > MAX_QUESTION_CHARS)
        throw new Error(`Keep the question under ${MAX_QUESTION_CHARS} characters.`)
      const recorded = result.recorded && (await recordedAnswer(result.recorded.id, result.variant))
      if (recorded && !live) return { kind: 'recorded', search: result, answer: recorded }
      if (mode === 'local')
        return liveAnswer({ question: result.question, variant: result.variant }, result.recorded, signal)
      return { kind: 'needs-key', search: result, commands: LOCAL_ANSWER_COMMANDS }
    },
  }
}
