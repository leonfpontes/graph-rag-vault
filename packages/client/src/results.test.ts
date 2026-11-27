import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { AnswerRecord, CaseQuestion, Results } from '@graph-rag/evals'
import { loadQuestions } from '@graph-rag/evals'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { recordedAnswerFor, type RecordedAnswer, type RecordedQuestion, type Scoreboard } from './results.js'

function repoRoot(dir = import.meta.dirname): string {
  return existsSync(path.join(dir, 'pnpm-workspace.yaml')) ? dir : repoRoot(path.dirname(dir))
}
const read = (file: string) => readFileSync(path.join(repoRoot(), file), 'utf8')

describe('the evaluation files, as the app reads them', () => {
  it("fit evals' own types, so a change there fails here", () => {
    expectTypeOf<Results>().toExtend<Scoreboard>()
    expectTypeOf<AnswerRecord>().toExtend<RecordedAnswer>()
    expectTypeOf<Pick<CaseQuestion, 'id' | 'kind' | 'split' | 'question' | 'expectedSources'>>().toExtend<
      Omit<RecordedQuestion, 'traps'>
    >()
  })

  it('have a recorded hybrid answer for each of the 50 questions, and vector and graph for the 40', () => {
    const answers = JSON.parse(read('evals/results/answers.json')) as RecordedAnswer[]
    const questions = loadQuestions(read('evals/questions.yaml'))
    expect(questions).toHaveLength(50)
    for (const q of questions) {
      const hybrid = recordedAnswerFor(answers, q.id)
      expect(hybrid?.round, q.id).toBe(1)
      expect(hybrid?.variant).toBe('hybrid')
      for (const variant of ['vector', 'graph'] as const)
        expect(recordedAnswerFor(answers, q.id, variant)?.variant, `${q.id} ${variant}`).toBe(
          q.split === 'test' ? variant : undefined,
        )
    }
    expect(recordedAnswerFor(answers, 'q-999')).toBeUndefined()
  })

  it('come from one scoreboard run: the questions and the index it scored', () => {
    const latest = JSON.parse(read('evals/results/latest.json')) as Scoreboard
    expect(latest.rehearsal).toBe(false)
    expect(latest.splits).toEqual(['test'])
    expect(latest.questions.total).toBe(40)
  })
})
