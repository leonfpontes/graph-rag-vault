import { describe, expect, it } from 'vitest'

import {
  bm25,
  createSearch,
  decodeIndex,
  DEFAULT_WEIGHTS,
  encodeIndex,
  normalize,
  rrf,
  type SearchHit,
  type SearchIndex,
  stem,
  terms,
} from './index.js'

const unit = (...v: number[]) => normalize(Float32Array.from(v))

// A tiny vault: a project named by an alias, its owner and the owner's manager two hops away; an old
// warranty document replaced by a newer decision that uses other words; and an unrelated note.
const note = (id: string, title: string, updated: string, extra: Partial<SearchIndex['notes'][0]> = {}) => ({
  id,
  type: 'document',
  title,
  aliases: [],
  created: '2025-01-01',
  updated,
  status: 'active',
  path: `x/${id}.md`,
  ...extra,
})
const chunk = (noteId: string, embedText: string) => ({
  id: `${noteId}#0`,
  noteId,
  ord: 0,
  heading: null,
  text: embedText,
  embedText,
})

function fixture(): SearchIndex {
  const notes = [
    note('prj-ridgeline', 'Ridgeline e-MTB', '2026-03-01', { type: 'project', aliases: ['RL-1'] }),
    note('per-tomas', 'Tomas Lindqvist', '2026-02-01', { type: 'person' }),
    note('per-maya', 'Maya Okafor', '2026-01-01', { type: 'person' }),
    note('doc-warranty', 'Warranty terms', '2025-01-01', { status: 'current' }),
    note('dec-lifetime', 'Lifetime frame cover', '2026-06-01', { type: 'decision' }),
    note('doc-paint', 'Paint colours', '2025-06-01', { status: 'outdated' }),
  ]
  const chunks = [
    chunk('prj-ridgeline', 'Ridgeline e-MTB\n\nA trail bike with a mid motor.'),
    chunk('per-tomas', 'Tomas Lindqvist\n\nEngineering lead for trail bikes.'),
    chunk('per-maya', 'Maya Okafor\n\nChief operating officer.'),
    chunk('doc-warranty', 'Warranty terms\n\nThe frame warranty is five years on every bike.'),
    chunk('dec-lifetime', 'Lifetime frame cover\n\nFrames are covered for as long as the first owner rides.'),
    chunk('doc-paint', 'Paint colours\n\nGloss and matte colours for the frame.'),
  ]
  const vectors = Float32Array.from(
    [
      unit(1, 0, 0),
      unit(0.6, 0.8, 0),
      unit(0, 1, 0),
      unit(0, 0, 1),
      unit(0, 0.3, 0.9),
      unit(0.2, 0, 0.9),
    ].flatMap((v) => [...v]),
  )
  const links = [
    { from: 'prj-ridgeline', to: 'per-tomas', relation: 'owner' },
    { from: 'per-tomas', to: 'per-maya', relation: 'reports_to' },
    { from: 'dec-lifetime', to: 'doc-warranty', relation: 'supersedes' },
    { from: 'doc-paint', to: 'missing-note', relation: 'mentions' },
  ]
  return {
    format: 1,
    model: { id: 'test-model', revision: 'r1', dims: 3 },
    sourceHash: 'h',
    notes,
    links,
    chunks,
    vectors,
    queries: [{ id: 'q-1', question: 'warranty?', vector: unit(0, 0, 1) }],
  }
}

const ids = (hits: SearchHit[]) => hits.map((h) => h.noteId)
const reasonsOf = (hits: SearchHit[], id: string) => hits.find((h) => h.noteId === id)?.reasons ?? []

describe('vector variant', () => {
  const search = createSearch(fixture())

  it('ranks notes by their nearest chunk, saying which chunk and how near', () => {
    const hits = search.search({ question: 'motor', variant: 'vector', queryVector: unit(1, 0.1, 0), k: 3 })
    expect(ids(hits)).toEqual(['prj-ridgeline', 'per-tomas', 'dec-lifetime'])
    const [first] = hits
    expect(first!.chunkId).toBe('prj-ridgeline#0')
    expect(first!.reasons[0]).toMatchObject({ kind: 'vector', chunkId: 'prj-ridgeline#0' })
    expect((first!.reasons[0] as { similarity: number }).similarity).toBeGreaterThan(0.99)
    // vectors only: no title, keyword or graph reasons
    for (const h of hits) for (const r of h.reasons) expect(['vector', 'recency', 'stale']).toContain(r.kind)
  })

  it('needs the question embedding, and a question', () => {
    expect(() => search.search({ question: 'x', variant: 'vector' })).toThrow(/embedding/)
    expect(() => search.search({ question: 'x', variant: 'hybrid' })).toThrow(/embedding/)
    expect(() => search.search({ question: '  ', variant: 'graph' })).toThrow(/empty/)
  })
})

describe('graph variant', () => {
  const search = createSearch(fixture())

  it('starts from a note the question names by alias and walks typed links two hops, with no vectors', () => {
    const hits = search.search({ question: 'Who does the owner of RL-1 report to?', variant: 'graph' })
    expect(ids(hits).slice(0, 3)).toEqual(['prj-ridgeline', 'per-tomas', 'per-maya'])
    expect(reasonsOf(hits, 'prj-ridgeline')).toContainEqual({ kind: 'title', matched: 'RL-1' })
    expect(reasonsOf(hits, 'per-tomas')).toContainEqual({
      kind: 'link',
      from: 'prj-ridgeline',
      relation: 'owner',
      direction: 'out',
      hops: 1,
    })
    expect(reasonsOf(hits, 'per-maya')).toContainEqual({
      kind: 'link',
      from: 'per-tomas',
      relation: 'reports_to',
      direction: 'out',
      hops: 2,
    })
  })

  it('lifts the relation the question names, never past the note it comes from', () => {
    const question = 'Who does the owner of RL-1 report to?'
    const plain = createSearch(fixture(), { cueBoost: 0 }).search({ question, variant: 'graph' })
    const cued = search.search({ question, variant: 'graph' })
    const score = (hits: SearchHit[], id: string) => hits.find((h) => h.noteId === id)!.score
    expect(score(cued, 'per-maya')).toBeGreaterThan(score(plain, 'per-maya'))
    const raw = (hits: SearchHit[], id: string) => {
      const h = hits.find((x) => x.noteId === id)!
      return h.reasons.reduce((s, r) => ('factor' in r ? s / r.factor : s), h.score)
    }
    expect(raw(cued, 'per-tomas')).toBeLessThanOrEqual(raw(cued, 'prj-ridgeline') + 1e-12)
  })

  it('walks links in both directions and says which way', () => {
    const hits = search.search({ question: 'Tomas Lindqvist', variant: 'graph' })
    expect(reasonsOf(hits, 'prj-ridgeline')).toContainEqual(
      expect.objectContaining({ kind: 'link', from: 'per-tomas', relation: 'owner', direction: 'in' }),
    )
  })

  it('finds keyword matches with the terms that matched', () => {
    const hits = search.search({ question: 'Which colours are glossy?', variant: 'graph' })
    expect(reasonsOf(hits, 'doc-paint')).toContainEqual({
      kind: 'keyword',
      terms: ['colour'],
      chunkId: 'doc-paint#0',
    })
  })
})

describe('replaced and stale notes', () => {
  const search = createSearch(fixture())
  const question = 'How long is the frame warranty?'

  it('gives a newer note the score of the note it replaces, and halves the replaced one', () => {
    for (const variant of ['graph', 'hybrid'] as const) {
      const hits = search.search({ question, variant, queryVector: unit(0, 0, 1), k: 10 })
      expect(ids(hits)[0]).toBe('dec-lifetime')
      expect(reasonsOf(hits, 'dec-lifetime')).toContainEqual({ kind: 'supersedes', older: 'doc-warranty' })
      expect(reasonsOf(hits, 'doc-warranty')).toContainEqual({
        kind: 'stale',
        status: 'current',
        by: 'dec-lifetime',
        factor: DEFAULT_WEIGHTS.stale,
      })
    }
  })

  it('halves a note whose status is stale, and lifts newer notes', () => {
    const paint = search.search({ question: 'paint colours', variant: 'graph', k: 10 })
    expect(reasonsOf(paint, 'doc-paint')).toContainEqual(
      expect.objectContaining({ kind: 'stale', status: 'outdated' }),
    )
    const hits = search.search({ question: 'motor', variant: 'vector', queryVector: unit(1, 0.1, 0), k: 10 })
    const lift = reasonsOf(hits, 'dec-lifetime').find((r) => r.kind === 'recency')
    expect(lift).toEqual({ kind: 'recency', updated: '2026-06-01', factor: 1 + DEFAULT_WEIGHTS.recency })
    // the oldest note gets no recency reason at all
    expect(reasonsOf(hits, 'doc-warranty').some((r) => r.kind === 'recency')).toBe(false)
  })
})

describe('hybrid variant', () => {
  it('uses all three entry lists, deterministically', () => {
    const search = createSearch(fixture())
    const request = {
      question: 'Who does the owner of RL-1 report to?',
      variant: 'hybrid' as const,
      queryVector: unit(0, 1, 0.1),
      k: 6,
    }
    const hits = search.search(request)
    expect(ids(hits).slice(0, 2)).toEqual(['prj-ridgeline', 'per-tomas'])
    expect(ids(hits).indexOf('per-maya')).toBeLessThan(4)
    const kinds = new Set(hits.flatMap((h) => h.reasons.map((r) => r.kind)))
    for (const kind of ['vector', 'title', 'link']) expect(kinds).toContain(kind)
    expect(search.search(request)).toEqual(hits)
    expect(search.search({ ...request, k: 0 })).toEqual([])
  })

  it('takes custom weights over the defaults, and refuses an index whose vectors do not match', () => {
    const search = createSearch(fixture(), { alpha: 0.1 })
    expect(search.weights.alpha).toBe(0.1)
    expect(search.weights.titleWeight).toBe(DEFAULT_WEIGHTS.titleWeight)
    const broken = { ...fixture(), vectors: new Float32Array(3) }
    expect(() => createSearch(broken)).toThrow(/1 vectors for 6 chunks/)
  })
})

describe('fusion weights', () => {
  it('weighs a list by its weight', () => {
    expect(rrf([['a'], ['b']], 60, [1, 2]).map((f) => f.id)).toEqual(['b', 'a'])
  })
})

describe('keyword search', () => {
  it('stems plurals and drops stop words', () => {
    expect(stem('batteries')).toBe('battery')
    expect(stem('cells')).toBe('cell')
    expect(stem('boxes')).toBe('box')
    expect(stem('status')).toBe('status')
    expect(stem('bus')).toBe('bus')
    expect(stem('c27s')).toBe('c27s')
    expect(terms('Who supplies the battery cells?')).toEqual(['supply', 'battery', 'cell'])
  })

  it('ranks by BM25: rarer terms and shorter documents first, with the matched terms', () => {
    const rank = bm25(['frame frame warranty', 'frame paint colours and many other words here', 'motor'])
    const hits = rank('frame warranty')
    expect(hits.map((h) => h.index)).toEqual([0, 1])
    expect(hits[0]!.matched).toEqual(['frame', 'warranty'])
    expect(rank('saddle')).toEqual([])
    expect(bm25([])('frame')).toEqual([])
  })
})

describe('index file', () => {
  it('round-trips the index, vectors and recorded questions included', () => {
    const index = fixture()
    const decoded = decodeIndex(encodeIndex(index))
    expect(decoded).toEqual(index)
    // a copy inside a larger buffer reads the same
    const bytes = encodeIndex(index)
    const padded = new Uint8Array(bytes.length + 3)
    padded.set(bytes, 3)
    expect(decodeIndex(padded.subarray(3))).toEqual(index)
  })

  it('refuses files that are not an index, cut short, of another format or the wrong size', () => {
    const bytes = encodeIndex(fixture())
    expect(() => decodeIndex(new Uint8Array([1, 2, 3]))).toThrow(/GRVI/)
    expect(() => decodeIndex(bytes.subarray(0, 20))).toThrow(/cut short/)
    expect(() => decodeIndex(bytes.subarray(0, bytes.length - 4))).toThrow(/expected/)
    const other = encodeIndex({ ...fixture(), format: 2 as 1 })
    expect(() => decodeIndex(other)).toThrow(/format 2/)
  })

  it('refuses to write vectors that do not match the chunks or the dimensions', () => {
    expect(() => encodeIndex({ ...fixture(), vectors: new Float32Array(2) })).toThrow(/vector values/)
    const bad = fixture()
    bad.queries[0]!.vector = new Float32Array(2)
    expect(() => encodeIndex(bad)).toThrow(/dimensions/)
  })
})
