// The path an answer walked, from two records and nothing else:
// - the search's own reasons: a result reached through a typed link (`link` reason) lights that link,
//   with its type written on it; a two-hop reason lights both links, through the note between them;
// - the answer's citations of a note's links passage (`<note>#links`, which words its typed links):
//   a quote that names a linked note lights that link, because the answer read it there.
// Only these links light up, never every link among the results (docs/DESIGN.md, Answer path).
// Citation numbers follow the rank of the cited note among the sources.
import type { SearchHit, SearchIndex } from '@graph-rag/search'

export interface PathEdge {
  from: string
  to: string
  relation: string
}

export interface AnswerPath {
  /** Notes to light: the results, and the notes a lit link reaches. */
  notes: string[]
  edges: PathEdge[]
  /** Citation number by note id, for the notes the answer cited. */
  cites: Record<string, number>
}

export interface CitedPassage {
  noteId: string
  chunkId: string
  quote: string
}

type Graph = Pick<SearchIndex, 'links' | 'notes'>

/** The source number of each cited note: its rank among the hits (1-based). */
export function citationNumbers(
  hits: readonly SearchHit[],
  citedNotes: Iterable<string>,
): Record<string, number> {
  const rank = new Map(hits.map((h, i) => [h.noteId, i + 1]))
  const cites: Record<string, number> = {}
  for (const id of citedNotes) {
    const n = rank.get(id)
    if (n) cites[id] = n
  }
  return cites
}

/** At most this many notes from outside the results join the path (the steps between results). */
const MAX_STEPS = 4

export function answerPath(
  index: Graph,
  hits: readonly SearchHit[],
  citations: readonly CitedPassage[] = [],
): AnswerPath {
  const notes = new Set(hits.map((h) => h.noteId))
  const edges: PathEdge[] = []
  const seen = new Set<string>()
  let steps = 0
  const reach = (id: string) => {
    if (notes.has(id)) return true
    if (steps >= MAX_STEPS) return false
    steps++
    notes.add(id)
    return true
  }
  const add = (from: string, to: string, relation: string) => {
    const key = [from, to, relation].join('|')
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ from, to, relation })
  }
  const between = (a: string, b: string) =>
    index.links.filter((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a))

  for (const hit of hits) {
    for (const r of hit.reasons) {
      if (r.kind !== 'link') continue
      if (r.hops === 1) {
        if (!reach(r.from)) continue
        // `out`: the note the search found links to this result (found.relation = result).
        if (r.direction === 'out') add(r.from, hit.noteId, r.relation)
        else add(hit.noteId, r.from, r.relation)
        continue
      }
      // Two hops: the note between them; the last link has the reason's relation.
      const last = index.links.find((l) => {
        if (l.relation !== r.relation || (l.from !== hit.noteId && l.to !== hit.noteId)) return false
        return between(r.from, l.from === hit.noteId ? l.to : l.from).length > 0
      })
      if (!last) continue
      const mid = last.from === hit.noteId ? last.to : last.from
      const first = between(r.from, mid)[0]!
      if (!reach(r.from) || !reach(mid)) continue
      add(first.from, first.to, first.relation)
      add(last.from, last.to, last.relation)
    }
  }

  // Links the answer quoted from a note's links passage ("X replaces Y.", "The owner of X is Y.").
  const title = new Map(index.notes.map((n) => [n.id, n.title]))
  for (const c of citations) {
    if (!c.chunkId.endsWith('#links')) continue
    for (const l of index.links) {
      if (l.relation === 'mentions' || (l.from !== c.noteId && l.to !== c.noteId)) continue
      const other = l.from === c.noteId ? l.to : l.from
      // Incoming links are worded only for `supersedes` ("Y was replaced by X").
      if (l.to === c.noteId && l.relation !== 'supersedes') continue
      const name = title.get(other)
      if (!name || !c.quote.includes(name) || !reach(other)) continue
      add(l.from, l.to, l.relation)
    }
  }
  return {
    notes: [...notes],
    edges,
    cites: citationNumbers(
      hits,
      citations.map((c) => c.noteId),
    ),
  }
}

/** The note most links of the path touch: "The path, as text" writes it once, on top. */
export function pathHub(edges: readonly PathEdge[]): string | undefined {
  const count = new Map<string, number>()
  for (const e of edges) {
    count.set(e.from, (count.get(e.from) ?? 0) + 1)
    count.set(e.to, (count.get(e.to) ?? 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}
