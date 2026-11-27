// The vector-only baseline with each candidate embedding model, so the scoreboard compares the graph
// with the strongest vector search we tried, not only with the model the index ships with. The chunks
// and questions are embedded again by each model (locally, no cost); everything else is the index.
import type { Embedder } from '@graph-rag/embeddings'
import { createSearch, type SearchIndex } from '@graph-rag/search'

import { retrievalReport, type RetrievalScore } from './retrieval.js'
import type { Question, Split } from './types.js'

export interface BaselineScore {
  model: string
  /** `all` and each kind with answerable questions. */
  scores: Record<string, RetrievalScore>
}

export async function vectorBaseline(
  index: SearchIndex,
  questions: readonly Question[],
  embedder: Pick<Embedder, 'model' | 'embedQuery' | 'embedPassages'>,
  splits: readonly Split[],
): Promise<BaselineScore> {
  const dims = embedder.model.dims
  const passages = await embedder.embedPassages(index.chunks.map((c) => c.embedText))
  const vectors = new Float32Array(passages.length * dims)
  passages.forEach((v, i) => vectors.set(v, i * dims))
  const chosen = questions.filter((q) => splits.includes(q.split))
  const queryVectors = new Map<string, Float32Array>()
  for (const q of chosen) queryVectors.set(q.id, await embedder.embedQuery(q.question))
  const search = createSearch({
    ...index,
    model: { id: embedder.model.id, revision: embedder.model.revision, dims },
    vectors,
  })
  const report = retrievalReport(
    chosen,
    (q) =>
      search
        .search({ question: q.question, variant: 'vector', queryVector: queryVectors.get(q.id)!, k: 20 })
        .map((h) => h.noteId),
    { splits },
  )
  return { model: embedder.model.key, scores: report.scores.vector }
}

/** The baseline with the best overall recall@5 (ties go to the first listed). */
export function bestBaseline(baselines: readonly BaselineScore[]): BaselineScore | undefined {
  return baselines.reduce<BaselineScore | undefined>(
    (best, b) => ((b.scores.all?.recall5 ?? -1) > (best?.scores.all?.recall5 ?? -1) ? b : best),
    undefined,
  )
}
