#!/usr/bin/env node
// pnpm retrieval [--split probe,dev] [--weights '{"alpha":0.5}'] [--index <file>] [--details]
// Scores the three search variants on the recorded questions of the exported index (their vectors
// are in it): no model, no key, no cost. Custom weights are refused on the test split.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { createSearch, decodeIndex, type SearchWeights } from '@graph-rag/search'

import { loadQuestions } from './questions.js'
import { formatRetrieval, retrievalReport } from './retrieval.js'
import { SPLITS, type Split } from './types.js'

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    split: { type: 'string', default: 'probe,dev' },
    weights: { type: 'string' },
    index: { type: 'string', default: 'apps/web/public/data/index.bin' },
    questions: { type: 'string', default: 'evals/questions.yaml' },
    details: { type: 'boolean', default: false },
  },
})
const root = process.env.INIT_CWD ?? process.cwd()
const splits = values.split.split(',').map((s) => s.trim()) as Split[]
for (const s of splits)
  if (!(SPLITS as readonly string[]).includes(s)) throw new Error(`Unknown split "${s}".`)
const weights = values.weights ? (JSON.parse(values.weights) as Partial<SearchWeights>) : undefined

const index = decodeIndex(readFileSync(path.resolve(root, values.index)))
const questions = loadQuestions(readFileSync(path.resolve(root, values.questions), 'utf8'))
const vectors = new Map(index.queries.map((q) => [q.id, q]))
const searcher = createSearch(index, weights)
const report = retrievalReport(
  questions,
  (q, variant) => {
    const recorded = vectors.get(q.id)
    if (!recorded || recorded.question !== q.question)
      throw new Error(`The index has no vector for ${q.id} as written now: run pnpm index.`)
    return searcher
      .search({ question: q.question, variant, queryVector: recorded.vector, k: 20 })
      .map((h) => h.noteId)
  },
  { splits, tuning: weights !== undefined },
)
console.log(formatRetrieval(report))
if (values.details)
  for (const r of report.rows)
    if (r.recall5 !== undefined && r.recall5 < 1)
      console.log(
        `  ${r.id} ${r.kind} ${r.variant}: recall@5 ${r.recall5.toFixed(2)} · top5 ${r.top5.join(', ')}`,
      )
