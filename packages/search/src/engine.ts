// The hybrid search. Three entry lists find notes directly: vector neighbours of the question,
// notes the question names by title or alias, and BM25 keyword matches. Their ranks are fused with
// RRF into a base score (normalized to 1). Then the graph spreads it: a note linked to a found note
// inherits alpha × relation weight × that note's score, up to 2 hops, keeping the best; a note
// that replaces a found note (`supersedes`) takes its whole score. Last, recency lifts newer
// notes and stale ones (replaced, or with a stale status) lose half. docs/adr/0005.
//
// Fusing the graph as one more RRF list was tried first and gained nothing over vectors alone: a
// note found only through a link always lost to notes in two lists. Propagating scores fixed that.
import { bm25 } from './bm25.js'
import { RRF_K, rrf } from './fusion.js'
import type { Reason, SearchHit, SearchIndex, SearchRequest } from './types.js'
import { topK } from './vectors.js'

export interface SearchWeights {
  /** How many notes each entry list (vector, keyword) contributes. */
  listDepth: number
  /** Share of a note's score a linked note inherits per hop. */
  alpha: number
  /** Weight of each relation in the propagation (missing: 0). */
  relations: Record<string, number>
  /** Weight of the title and alias list in the fusion: naming a note is a precise signal. */
  titleWeight: number
  /** Extra weight (× (1 + cueBoost)) for a relation the question names ("report to", "dealer"). */
  cueBoost: number
  /** Lift for the newest note: score × (1 + recency × r), r from 0 (oldest) to 1 (newest). */
  recency: number
  /** Factor for a replaced or stale note. */
  stale: number
  /** Status words that mark a note stale even when no note replaces it. */
  staleStatuses: string[]
}

/**
 * Tuned on the 10 probe and dev questions only, never on test (pnpm retrieval). titleWeight and
 * cueBoost sit in the middle of a plateau (hybrid recall@5 0.93–0.96 for titleWeight 2–3, cueBoost
 * 1–2, alpha 0.5–0.7); the rest are the probe rehearsal's starting values. docs/adr/0005.
 */
export const DEFAULT_WEIGHTS: Readonly<SearchWeights> = Object.freeze({
  listDepth: 20,
  alpha: 0.6,
  relations: Object.freeze({
    supersedes: 1,
    decided_in: 0.9,
    owner: 0.8,
    customer: 0.8,
    attendees: 0.6,
    reports_to: 0.6,
    mentions: 0.5,
  }) as Record<string, number>,
  titleWeight: 2,
  cueBoost: 1,
  recency: 0.15,
  stale: 0.5,
  staleStatuses: Object.freeze(['superseded', 'outdated']) as unknown as string[],
})

/** Words in a question that name a relation. */
export const RELATION_CUES: Readonly<Record<string, RegExp>> = {
  reports_to: /\breport(s|ed|ing)? to\b|\bmanager\b|\bboss\b/i,
  attendees: /\battend(s|ed|ees?)?\b|\bjoin(s|ed)?\b|\bpresent\b|\bwho was (in|at)\b/i,
  customer: /\bdealers?\b|\bcustomers?\b|\bclients?\b|\bretailers?\b|\bshops?\b/i,
  owner: /\bown(s|er|ers|ed)?\b|\blead(s|er)?\b|\bresponsible\b|\bin charge\b/i,
  decided_in: /\bdecided\b|\bchosen\b|\bchose\b|\bdecision\b|\bagreed\b/i,
}

const words = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `

interface Edge {
  to: string
  relation: string
  /** `out`: this note links to `to`. */
  direction: 'out' | 'in'
}

export interface Searcher {
  search(request: SearchRequest): SearchHit[]
  /** The weights in use (defaults merged with the options). */
  weights: Readonly<SearchWeights>
}

export function createSearch(index: SearchIndex, options: Partial<SearchWeights> = {}): Searcher {
  const weights: SearchWeights = { ...DEFAULT_WEIGHTS, ...options }
  const notes = new Map(index.notes.map((n) => [n.id, n]))
  const dims = index.model.dims
  if (index.vectors.length !== index.chunks.length * dims)
    throw new Error(`The index has ${index.vectors.length / dims} vectors for ${index.chunks.length} chunks.`)

  const edges = new Map<string, Edge[]>()
  const addEdge = (from: string, edge: Edge) => {
    if (!edges.has(from)) edges.set(from, [])
    edges.get(from)!.push(edge)
  }
  const replacedBy = new Map<string, string>()
  for (const l of index.links) {
    if (!notes.has(l.from) || !notes.has(l.to)) continue
    // `out` from the point of view of the note the score comes from
    addEdge(l.from, { to: l.to, relation: l.relation, direction: 'out' })
    addEdge(l.to, { to: l.from, relation: l.relation, direction: 'in' })
    if (l.relation === 'supersedes') replacedBy.set(l.to, l.from)
  }

  const dates = index.notes.map((n) => Date.parse(n.updated)).filter(Number.isFinite)
  const [oldest, newest] = [Math.min(...dates), Math.max(...dates)]
  const recencyOf = (updated: string) => {
    const d = Date.parse(updated)
    return Number.isFinite(d) && newest > oldest ? (d - oldest) / (newest - oldest) : 0
  }

  const keyword = bm25(index.chunks.map((c) => c.embedText))
  const names = index.notes.flatMap((n) =>
    [n.title, ...n.aliases]
      .map((name) => ({ id: n.id, name, norm: words(name) }))
      .filter((x) => x.norm.trim().length > 2),
  )

  return {
    weights,
    search({ question, variant, queryVector, k = 5 }) {
      if (!question.trim()) throw new Error('The question is empty.')
      const usesVectors = variant !== 'graph'
      if (usesVectors && !queryVector)
        throw new Error(`The ${variant} search needs the question's embedding.`)
      const reasons = new Map<string, Reason[]>()
      const bestChunk = new Map<string, string>()
      const note = (id: string, reason: Reason, chunkId?: string) => {
        if (!reasons.has(id)) reasons.set(id, [])
        reasons.get(id)!.push(reason)
        if (chunkId && !bestChunk.has(id)) bestChunk.set(id, chunkId)
      }

      const lists: string[][] = []
      const listWeights: number[] = []
      if (usesVectors) {
        const list: string[] = []
        for (const hit of topK(queryVector!, index.vectors, dims, index.chunks.length)) {
          const chunk = index.chunks[hit.index]!
          if (list.includes(chunk.noteId)) continue
          list.push(chunk.noteId)
          note(chunk.noteId, { kind: 'vector', similarity: hit.similarity, chunkId: chunk.id }, chunk.id)
          if (list.length === weights.listDepth) break
        }
        lists.push(list)
        listWeights.push(1)
      }
      if (variant !== 'vector') {
        const q = words(question)
        const titles: string[] = []
        for (const n of names)
          if (q.includes(n.norm) && !titles.includes(n.id)) {
            titles.push(n.id)
            note(n.id, { kind: 'title', matched: n.name })
          }
        lists.push(titles)
        listWeights.push(weights.titleWeight)
        const list: string[] = []
        for (const hit of keyword(question)) {
          const chunk = index.chunks[hit.index]!
          if (list.includes(chunk.noteId)) continue
          list.push(chunk.noteId)
          note(chunk.noteId, { kind: 'keyword', terms: hit.matched, chunkId: chunk.id }, chunk.id)
          if (list.length === weights.listDepth) break
        }
        lists.push(list)
        listWeights.push(1)
      }

      // Base: RRF of the entry lists, normalized so the best note scores 1.
      const fused = rrf(lists, RRF_K, listWeights)
      const top = fused[0]?.score ?? 1
      const base = new Map(fused.map((f) => [f.id, f.score / top]))
      const total = new Map(base)

      if (variant !== 'vector') {
        const weightOf = (relation: string) =>
          (weights.relations[relation] ?? 0) *
          (weights.cueBoost && RELATION_CUES[relation]?.test(question) ? 1 + weights.cueBoost : 1)
        const via = new Map<string, Reason>()
        let frontier = new Map(base)
        for (const hops of [1, 2] as const) {
          const next = new Map<string, { score: number; reason: Reason }>()
          for (const [from, score] of frontier)
            for (const e of edges.get(from) ?? []) {
              // A hop never adds score: at most the score of the note it comes from.
              const s = score * Math.min(1, weights.alpha * weightOf(e.relation))
              if (s <= 0 || s <= (next.get(e.to)?.score ?? 0)) continue
              next.set(e.to, {
                score: s,
                reason: { kind: 'link', from, relation: e.relation, direction: e.direction, hops },
              })
            }
          for (const [id, { score, reason }] of next)
            if (score > (total.get(id) ?? 0)) {
              total.set(id, score)
              via.set(id, reason)
            }
          frontier = new Map([...next].map(([id, x]) => [id, x.score]))
        }
        // A newer note takes over the score of the note it replaces (chains of replacements too).
        for (let pass = 0; pass < 3; pass++)
          for (const [older, newer] of replacedBy) {
            const s = total.get(older) ?? 0
            if (s > (total.get(newer) ?? 0)) {
              total.set(newer, s)
              via.set(newer, { kind: 'supersedes', older })
            }
          }
        for (const [id, reason] of via) note(id, reason)
      }

      const hits: SearchHit[] = []
      for (const [id, raw] of total) {
        const n = notes.get(id)
        if (!n) continue
        let score = raw
        const r = recencyOf(n.updated)
        const lift = 1 + weights.recency * r
        if (lift > 1.0005) {
          score *= lift
          note(id, { kind: 'recency', updated: n.updated, factor: round(lift) })
        }
        const by = replacedBy.get(id)
        if (by || weights.staleStatuses.includes(n.status)) {
          score *= weights.stale
          note(id, { kind: 'stale', status: n.status, ...(by ? { by } : {}), factor: weights.stale })
        }
        hits.push({
          noteId: id,
          ...(bestChunk.has(id) ? { chunkId: bestChunk.get(id)! } : {}),
          score,
          reasons: reasons.get(id) ?? [],
        })
      }
      return hits.sort((a, b) => b.score - a.score || (a.noteId < b.noteId ? -1 : 1)).slice(0, Math.max(0, k))
    },
  }
}

const round = (x: number) => Math.round(x * 1e4) / 1e4
