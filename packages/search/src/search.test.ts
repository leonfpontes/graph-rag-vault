import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { cosine, EMBEDDING_DIMS, fromBlob, normalize, rrf, SEARCH_VARIANTS, toBlob, topK } from './index.js'

const v = (...values: number[]) => Float32Array.from(values)

describe('vectors', () => {
  it('round-trips a vector through its little-endian BLOB', () => {
    const vector = Float32Array.from({ length: EMBEDDING_DIMS }, (_, i) => Math.sin(i) / 3)
    const blob = toBlob(vector)
    expect(blob.byteLength).toBe(EMBEDDING_DIMS * 4)
    expect(Array.from(fromBlob(blob))).toEqual(Array.from(vector))
    // little-endian whatever the machine: 1.0 is 00 00 80 3f
    expect(Array.from(toBlob(v(1)))).toEqual([0, 0, 0x80, 0x3f])
  })

  it('reads a BLOB that starts in the middle of a buffer, and refuses a broken one', () => {
    const padded = new Uint8Array(12)
    padded.set(toBlob(v(2, -1)), 4)
    expect(Array.from(fromBlob(padded.subarray(4)))).toEqual([2, -1])
    expect(() => fromBlob(new Uint8Array(6))).toThrow(/multiple of 4/)
  })

  it('measures cosine, with zero vectors at 0 and different sizes refused', () => {
    expect(cosine(v(1, 0), v(0, 1))).toBe(0)
    expect(cosine(v(1, 1), v(2, 2))).toBeCloseTo(1)
    expect(cosine(v(1, 0), v(-1, 0))).toBeCloseTo(-1)
    expect(cosine(v(0, 0), v(1, 1))).toBe(0)
    expect(() => cosine(v(1), v(1, 2))).toThrow(/different sizes/)
    expect(Array.from(normalize(v(3, 4)))).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)])
    expect(Array.from(normalize(v(0, 0)))).toEqual([0, 0])
  })

  it('finds the nearest rows by brute force, ties in row order', () => {
    const matrix = Float32Array.from([
      ...normalize(v(1, 0)),
      ...normalize(v(0, 1)),
      ...normalize(v(1, 1)),
      ...normalize(v(1, 0)),
    ])
    const hits = topK(v(2, 0), matrix, 2, 3)
    expect(hits.map((h) => h.index)).toEqual([0, 3, 2])
    expect(hits[0]!.similarity).toBeCloseTo(1)
    expect(topK(v(1, 0), matrix, 2, 0)).toEqual([])
    expect(() => topK(v(1, 0, 0), matrix, 2, 1)).toThrow(/dimensions/)
    expect(() => topK(v(1, 0), matrix.subarray(1), 2, 1)).toThrow(/multiple/)
  })
})

describe('fusion', () => {
  it('ranks by reciprocal rank across lists, counting a repeat once', () => {
    const fused = rrf([
      ['a', 'b', 'c'],
      ['b', 'd', 'b'],
    ])
    expect(fused.map((f) => f.id)).toEqual(['b', 'a', 'd', 'c'])
    expect(fused[0]!.score).toBeCloseTo(1 / 62 + 1 / 61)
    expect(rrf([])).toEqual([])
  })
})

describe('search contract', () => {
  it('compares the three variants of the evaluation', () => {
    expect(SEARCH_VARIANTS).toEqual(['vector', 'graph', 'hybrid'])
  })

  it('imports nothing from Node: the static demo runs it in the browser', () => {
    // The lint rule and the typecheck (no Node types) catch it too; this also covers require().
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    expect(sources.length).toBeGreaterThan(0)
    for (const file of sources)
      expect(readFileSync(path.join(dir, file), 'utf8'), file).not.toMatch(/from 'node:|require\(/)
  })
})
