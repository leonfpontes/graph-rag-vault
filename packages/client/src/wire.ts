// The local API on the wire (packages/api serves it, the app calls it). Only `pnpm demo` and
// `pnpm serve` have it; the public site is static, so the app works without it. docs/ARCHITECTURE.md.
import type { AnswerResult } from '@graph-rag/answer/passages'
import type { SearchHit, SearchVariant } from '@graph-rag/search'

/**
 * `local`: the server has the person's Anthropic key and answers new questions (POST /api/answer).
 * `demo`: no key, recorded answers only. The static site has no API at all (the app calls it `static`).
 */
export type ServerMode = 'local' | 'demo'

/** GET /api/meta */
export interface ApiMeta {
  name: 'graph-rag-vault'
  mode: ServerMode
}

/** Longest question the answer route takes, in characters. */
export const MAX_QUESTION_CHARS = 500

/** POST /api/answer, as JSON. */
export interface AnswerRequest {
  question: string
  /** Default `hybrid`. */
  variant?: SearchVariant
}

/** 200 from POST /api/answer: the server's own search, then the answer read from its top 5 notes. */
export interface AnswerResponse {
  question: string
  variant: SearchVariant
  /** Best first; the answer read the passages of the first 5 (`passagesFromHits`). */
  hits: SearchHit[]
  answer: AnswerResult
}

/** Every error of the API: a sentence for the person, never an echo of the request. */
export interface ApiError {
  error: string
}

/**
 * How to get written answers to new questions: run the app locally with your own key. The app shows
 * these when a question has no recorded answer and there is no key.
 */
export const LOCAL_ANSWER_COMMANDS: readonly string[] = [
  'git clone https://github.com/leonfpontes/graph-rag-vault.git && cd graph-rag-vault',
  'pnpm install',
  'cp .env.example .env.local   # then put your Anthropic key in ANTHROPIC_API_KEY',
  'pnpm demo',
]
