// The answer's data types and limits, with no Node APIs: the browser (the static demo) imports them
// with the passages through @graph-rag/answer/passages, and the model client stays on the server.
import type { TokenUsage } from './provider.js'

/** More passages than this are cut: the answer reads the top of the search. */
export const MAX_PASSAGES = 15
/** Notes offered when the answer is "I don't know". */
export const NEAREST_NOTES = 3

export interface Passage {
  chunkId: string
  noteId: string
  title: string
  heading?: string | null
  /** Plain text of the chunk: what the model reads and what quotes are checked against. */
  text: string
  /** ISO date the note was last updated. */
  updated: string
  status?: string
}

export interface Citation {
  chunkId: string
  noteId: string
  quote: string
}

export interface Sentence {
  text: string
  citations: Citation[]
}

export type RemovalReason = 'no-source' | 'unknown-passage' | 'quote-not-found'

export interface RemovedSentence {
  text: string
  reason: RemovalReason
}

export interface CitationCount {
  submitted: number
  kept: number
}

export interface AnswerResult {
  status: 'answered' | 'unknown'
  sentences: Sentence[]
  /** Sentences the model wrote that no passage supports. */
  removed: RemovedSentence[]
  /** When the answer is unknown: the notes nearest to the question, best first. */
  nearest: string[]
  /** The model that answered, and whether it was the fallback. */
  model: string | null
  fallbackUsed: boolean
  calls: number
  usage: TokenUsage
  costMicros: number
  promptVersion: string
  /** Sources the model gave and how many passed the check: the citation precision, with no model. */
  citations: CitationCount
}
