// The committed scoreboard against its own sources: the answers it was built from, the search index
// and the questions. When the vault, the questions or the search change, the scoreboard is behind
// and this test says to run `pnpm eval` again.
import { existsSync, readFileSync } from 'node:fs'

import { normalize } from '@graph-rag/answer'
import { createSearch, decodeIndex } from '@graph-rag/search'
import { format, resolveConfig } from 'prettier'
import { describe, expect, it } from 'vitest'

import {
  bestBaseline,
  loadQuestions,
  verdictOf,
  retrievalReport,
  summarizeGeneration,
  toMarkdown,
  type AnswerRecord,
  type Results,
  type SampleItem,
} from './index.js'

const at = (p: string) => new URL(`../../${p}`, import.meta.url)
const json = <T>(p: string): T => JSON.parse(readFileSync(at(p), 'utf8')) as T
const has = existsSync(at('evals/results/latest.json'))

describe.runIf(has)('the committed scoreboard', () => {
  const results = has ? json<Results>('evals/results/latest.json') : (undefined as never)
  const answers = has ? json<AnswerRecord[]>('evals/results/answers.json') : []
  const questions = loadQuestions(readFileSync(at('evals/questions.yaml'), 'utf8'))
  const scored = questions.filter((q) => results.splits.includes(q.split))

  it('is the scoreboard, on the test split only', () => {
    expect(results.rehearsal).toBe(false)
    expect(results.splits).toEqual(['test'])
    expect(results.questions.total).toBe(scored.length)
  })

  it('has the retrieval the current index and questions give: run pnpm eval when this fails', () => {
    const index = decodeIndex(readFileSync(at('apps/web/public/data/index.bin')))
    expect(results.index.sourceHash, 'the index changed since the scoreboard ran').toBe(index.sourceHash)
    const vectors = new Map(index.queries.map((q) => [q.id, q.vector]))
    const search = createSearch(index)
    const report = retrievalReport(
      scored,
      (q, variant) =>
        search
          .search({ question: q.question, variant, queryVector: vectors.get(q.id)!, k: 20 })
          .map((h) => h.noteId),
      { splits: results.splits },
    )
    expect(results.retrieval).toEqual(JSON.parse(JSON.stringify(report.scores)))
  })

  it('has the answer scores and the cost of its recorded answers', () => {
    const main = answers.filter((r) => results.splits.includes(r.split))
    expect(main).toHaveLength(scored.length * 3 * results.rounds)
    const variants = Object.keys(results.generation) as (keyof Results['generation'])[]
    expect(results.generation).toEqual(
      JSON.parse(JSON.stringify(summarizeGeneration(main, scored, variants))),
    )
    const usd = (key: 'answerMicros' | 'judgeMicros') => answers.reduce((s, r) => s + r[key], 0) / 1e6
    expect(results.cost.answerUsd).toBeCloseTo(usd('answerMicros'), 9)
    expect(results.cost.judgeUsd).toBeCloseTo(usd('judgeMicros'), 9)
    expect(results.cost.spentUsd).toBeLessThanOrEqual(results.cost.capUsd)
  })

  it('records one hybrid answer per tuning question for the demo', () => {
    const extras = answers.filter((r) => !results.splits.includes(r.split))
    expect(extras.map((r) => r.questionId).sort()).toEqual(
      questions.filter((q) => !results.splits.includes(q.split)).map((q) => q.id),
    )
    expect(new Set(extras.map((r) => `${r.variant}|${r.round}`))).toEqual(new Set(['hybrid|1']))
  })

  it('samples the human check from its recorded answers', () => {
    const { items } = json<{ items: SampleItem[] }>('evals/results/human-sample.json')
    for (const it of items) {
      const record = answers.find(
        (r) => r.questionId === it.questionId && r.variant === it.variant && r.round === it.round,
      )
      expect(
        record?.sentences.map((s) => s.text),
        it.item,
      ).toContain(it.sentence)
      for (const c of it.cited)
        expect(normalize(c.text), `${it.item} ${c.chunkId}`).toContain(normalize(c.quote))
    }
  })

  it('states the verdict the rule gives for its retrieval and baselines', () => {
    expect(results.verdict).toEqual(
      JSON.parse(JSON.stringify(verdictOf(results.retrieval, bestBaseline(results.baselines)))),
    )
  })

  it('says in latest.md what latest.json says', async () => {
    const md = readFileSync(at('evals/results/latest.md'), 'utf8')
    const file = at('evals/results/latest.md').pathname
    expect(md).toBe(await format(toMarkdown(results), { ...(await resolveConfig(file)), filepath: file }))
  })
})
