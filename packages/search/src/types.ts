// The search contract shared by the index (Node), the API, the static demo (browser) and the
// evaluation. Every result says why it came in: the app shows it and the evaluation reads it.

/** The three variants the evaluation compares (ablation). */
export const SEARCH_VARIANTS = ['vector', 'graph', 'hybrid'] as const
export type SearchVariant = (typeof SEARCH_VARIANTS)[number]

/** Why a note is in the results, or what moved its score. A result can carry several reasons. */
export type Reason =
  /** One of its chunks is a nearest neighbour of the question's embedding. */
  | { kind: 'vector'; similarity: number; chunkId: string }
  /** The question names the note by its title or one of its aliases. */
  | { kind: 'title'; matched: string }
  /** Keyword match (BM25) in one of its chunks, on these question terms. */
  | { kind: 'keyword'; terms: string[]; chunkId: string }
  /**
   * Reached through the graph from a note already found: `hops` links away, the last one of type
   * `relation`. `out`: `from` links to this note (`from.owner = this`); `in`: this note links to `from`.
   */
  | { kind: 'link'; from: string; relation: string; direction: 'out' | 'in'; hops: 1 | 2 }
  /** It replaces `older`, which the search found: it takes over its score. */
  | { kind: 'supersedes'; older: string }
  /** Score scaled by how recently the note was updated (factor ≥ 1). */
  | { kind: 'recency'; updated: string; factor: number }
  /** Score scaled down: the note was replaced (`by`) or its status says it is stale. */
  | { kind: 'stale'; status: string; by?: string; factor: number }

export interface SearchHit {
  noteId: string
  /** The chunk that matched best, when a text reason brought the note in. */
  chunkId?: string
  /** Final score, higher is better. Only comparable inside one result list. */
  score: number
  reasons: Reason[]
}

export interface SearchRequest {
  question: string
  variant: SearchVariant
  /** The question's unit embedding, from the same model as the index. Needed by vector and hybrid. */
  queryVector?: Float32Array
  /** How many results to return (default 5: the evaluation reports recall@5). */
  k?: number
}

// ── The index the search reads ─────────────────────────────────────────────────────────────────
// Built in Node from SQLite (packages/index, exportIndex) and shipped to the browser as one binary
// file (encodeIndex / decodeIndex). Plain data, so both sides run exactly the same code on it.

export interface IndexedNote {
  id: string
  type: string
  title: string
  aliases: string[]
  created: string
  updated: string
  status: string
  path: string
}

export interface IndexedLink {
  from: string
  to: string
  relation: string
}

export interface IndexedChunk {
  id: string
  noteId: string
  ord: number
  heading: string | null
  /** The Markdown as written, for the app. */
  text: string
  /** What was embedded and what BM25 reads. */
  embedText: string
}

/** A recorded question with its embedding: the demo answers these with no model at all. */
export interface IndexedQuery {
  id: string
  question: string
  vector: Float32Array
}

export interface SearchIndex {
  format: 1
  model: { id: string; revision: string; dims: number }
  /** Hash of the vault, the questions and the chunker settings the index was built from. */
  sourceHash: string
  notes: IndexedNote[]
  /** Links between notes of the index (links to missing notes are left out). */
  links: IndexedLink[]
  chunks: IndexedChunk[]
  /** One unit vector per chunk, in chunk order, back to back (`chunks.length × model.dims`). */
  vectors: Float32Array
  queries: IndexedQuery[]
}
