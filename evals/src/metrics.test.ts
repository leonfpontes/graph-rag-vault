import { describe, expect, it } from 'vitest'

import { mean, QUESTION_KINDS, reciprocalRank, recallAtK, SPLITS, stdev } from './index.js'

describe('retrieval metrics', () => {
  it('counts the expected sources inside the first k results', () => {
    const results = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(recallAtK(results, ['a', 'f'], 5)).toBe(0.5)
    expect(recallAtK(results, ['a', 'f'], 6)).toBe(1)
    expect(recallAtK(results, ['x'], 5)).toBe(0)
    expect(recallAtK(results, ['a', 'a'], 5)).toBe(1) // a repeated source counts once
  })

  it('ranks the first expected source', () => {
    expect(reciprocalRank(['a', 'b', 'c'], ['c', 'b'])).toBe(0.5)
    expect(reciprocalRank(['a'], ['a'])).toBe(1)
    expect(reciprocalRank(['a'], ['z'])).toBe(0)
  })

  it('leaves unanswerable questions out of the retrieval means', () => {
    expect(recallAtK(['a'], [], 5)).toBeUndefined()
    expect(reciprocalRank(['a'], [])).toBeUndefined()
    expect(mean([1, undefined, 0])).toBe(0.5)
    expect(mean([undefined])).toBeUndefined()
  })

  it('reports the sample deviation across rounds', () => {
    expect(stdev([1, 1, 1])).toBe(0)
    expect(stdev([0.8])).toBe(0)
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3)
  })
})

describe('evaluation contract', () => {
  it('has the four kinds of question and keeps test questions apart from tuning', () => {
    expect(QUESTION_KINDS).toEqual(['fact', 'multi-hop', 'temporal', 'unanswerable'])
    expect(SPLITS).toEqual(['probe', 'dev', 'test'])
  })
})
