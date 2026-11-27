// The search contract shared by the index (Node), the API, the static demo (browser) and the
// evaluation. Every result says why it came in: the app shows it and the evaluation reads it.

/** The three variants the evaluation compares (ablation). */
export const SEARCH_VARIANTS = ['vector', 'graph', 'hybrid'] as const
export type SearchVariant = (typeof SEARCH_VARIANTS)[number]

/** Why a note or chunk is in the results. A result can carry several reasons. */
export type Reason =
  /** Nearest neighbour of the question's embedding. */
  | { kind: 'vector'; similarity: number }
  /** The question names the note by its title or one of its aliases. */
  | { kind: 'title'; matched: string }
  /** Keyword match (full-text search, BM25). */
  | { kind: 'keyword'; terms: string[] }
  /** Reached through the graph from another result: `hops` links away, last one of type `relation`. */
  | { kind: 'link'; from: string; relation: string; hops: 1 | 2 }
  /** Shares a project with another result. */
  | { kind: 'same-project'; project: string }

export interface SearchHit {
  noteId: string
  /** The chunk that matched, when the reason is about text; absent for graph-only arrivals. */
  chunkId?: string
  /** Final score after fusion, higher is better. Only comparable inside one result list. */
  score: number
  reasons: Reason[]
}

export interface SearchRequest {
  question: string
  variant: SearchVariant
  /** How many results to return (default 5: the evaluation reports recall@5). */
  k?: number
}
