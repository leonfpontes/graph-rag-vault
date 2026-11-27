import { describe, expect, it } from 'vitest'

import { formatRetrieval, retrievalReport, type Question } from './index.js'

const q = (
  id: string,
  kind: Question['kind'],
  split: Question['split'],
  expectedSources: string[],
): Question => ({
  id,
  kind,
  split,
  question: `question ${id}`,
  expectedSources,
})
const questions = [
  q('q-001', 'multi-hop', 'probe', ['a', 'b']),
  q('q-002', 'fact', 'dev', ['c']),
  q('q-003', 'unanswerable', 'dev', []),
  q('q-011', 'fact', 'test', ['c']),
]
// vector finds only the first expected note; graph and hybrid find all of them
const rank = (question: Question, variant: string) =>
  variant === 'vector'
    ? [...question.expectedSources.slice(0, 1), 'x', 'y']
    : ['z', ...question.expectedSources]

describe('retrievalReport', () => {
  it('scores recall@5 and MRR per variant and kind, on the chosen splits only', () => {
    const report = retrievalReport(questions, rank, { splits: ['probe', 'dev'] })
    expect(report.rows.map((r) => r.id)).not.toContain('q-011')
    expect(report.scores.vector.all).toEqual({ questions: 2, recall5: 0.75, mrr: 1 })
    expect(report.scores.hybrid['multi-hop']).toEqual({ questions: 1, recall5: 1, mrr: 0.5 })
    // unanswerable questions have no sources to find: out of the retrieval means
    expect(report.scores.graph.unanswerable).toBeUndefined()
    expect(report.rows.find((r) => r.id === 'q-001' && r.variant === 'graph')!.top5).toEqual(['z', 'a', 'b'])
    expect(formatRetrieval(report)).toContain('all (2)')
    expect(formatRetrieval(report)).toMatch(/fact \(1\)\s+1\.00 \/ 1\.00/)
  })

  it('never tunes on the test split, and needs a split', () => {
    expect(() => retrievalReport(questions, rank, { splits: ['dev', 'test'], tuning: true })).toThrow(
      /scoreboard/,
    )
    expect(retrievalReport(questions, rank, { splits: ['test'] }).rows.map((r) => r.id)).toEqual([
      'q-011',
      'q-011',
      'q-011',
    ])
    expect(() => retrievalReport(questions, rank, { splits: [] })).toThrow(/at least one/)
  })
})
