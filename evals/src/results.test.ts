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
  humanAgreement,
  secondJudgeCheck,
  loadQuestions,
  verdictOf,
  retrievalReport,
  summarizeGeneration,
  toMarkdown,
  type AnswerRecord,
  type HumanLabels,
  type SecondJudgeFile,
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
    const { items } = json<{ items: SampleItem[] }>('evals/results/judge-sample.json')
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

  it('states the judge checks their files give, and the README says the same', () => {
    const file = (p: string) => existsSync(at(`evals/results/${p}`))
    const { items } = json<{ items: SampleItem[] }>('evals/results/judge-sample.json')
    const readme = readFileSync(at('README.md'), 'utf8').replace(/\s+/g, ' ')
    if (file('human-labels.json')) {
      const labels = json<HumanLabels>('evals/results/human-labels.json')
      expect(results.human).toEqual(JSON.parse(JSON.stringify(humanAgreement(items, labels))))
      if (labels.blind === false) {
        expect(results.human?.kappa).toBeUndefined()
        const h = results.human!
        const b = h.blindPart
        const agreed = Math.round(h.observed * h.items)
        if (b) {
          expect(readme).toContain(`Checked by a person (${labels.labeledBy})`)
          expect(readme).toContain(
            `Reviewed not blind: agreed with the judge on ${agreed - b.agreed} of ${h.items - b.items} sentences.`,
          )
          expect(readme).toContain(
            `Labelled blind, without the judge's verdicts: agreed on ${b.agreed} of ${b.items} sentences`,
          )
        } else
          expect(readme).toContain(
            `Reviewed by a person (${labels.labeledBy}), not blind: agreed with the judge on ${agreed} of ${h.items} sentences`,
          )
        if (!h.pendingAnswers) expect(readme).not.toContain('Review pending')
      }
    } else expect(results.human).toBeNull()
    if (file('second-judge.json')) {
      const second = json<SecondJudgeFile>('evals/results/second-judge.json')
      expect(results.secondJudge).toEqual(JSON.parse(JSON.stringify(secondJudgeCheck(items, second))))
      const s = results.secondJudge!
      expect(readme).toContain(`${Math.round(s.observed * 100)}%, Cohen's kappa ${s.kappa!.toFixed(2)}`)
      expect(readme).toContain(`All ${s.disagreements.length} disagreements go the same way`)
      expect(readme).toContain(
        s.secondLabels?.length === 1
          ? `the second judge marked all ${s.items} sentences ${s.secondLabels[0]}`
          : `only ${s.judgeFlagged} of ${s.items} sentences`,
      )
      if (results.human?.pendingAnswers)
        expect(readme).toContain(
          `Review pending for ${results.human.pendingAnswers} of ${results.human.sampleAnswers} answers`,
        )
    } else expect(results.secondJudge).toBeUndefined()
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
