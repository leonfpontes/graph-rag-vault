// Reciprocal rank fusion: merges ranked lists (vector, graph, keyword) without comparing their
// scores, which live on different scales. No model reranks (docs/adr/0002).

/** The constant of the original paper (Cormack et al., 2009): damps the weight of the top ranks. */
export const RRF_K = 60

export interface Fused {
  id: string
  score: number
}

/**
 * Each id scores the sum of weight / (k + rank) over the lists it appears in (rank from 1; weight 1
 * unless `weights` gives one per list). An id repeated inside one list counts once, at its best
 * rank. Ties keep the order of first appearance.
 */
export function rrf(lists: readonly (readonly string[])[], k = RRF_K, weights?: readonly number[]): Fused[] {
  const scores = new Map<string, number>()
  lists.forEach((list, l) => {
    const weight = weights?.[l] ?? 1
    const seen = new Set<string>()
    list.forEach((id, i) => {
      if (seen.has(id)) return
      seen.add(id)
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + i + 1))
    })
  })
  return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score)
}
