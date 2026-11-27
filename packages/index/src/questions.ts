// The recorded questions the exported index carries with their vectors: only the id and the text of
// each entry of evals/questions.yaml (the evaluation package checks the rest).
import { parse } from 'yaml'

import type { SourceQuestion } from './source.js'

export function readQuestions(text: string): SourceQuestion[] {
  const data = parse(text) as { questions?: { id?: unknown; question?: unknown }[] }
  if (!Array.isArray(data?.questions)) throw new Error('The questions file has no `questions` list.')
  return data.questions.map((q, i) => {
    if (typeof q.id !== 'string' || typeof q.question !== 'string' || !q.question.trim())
      throw new Error(`Question ${i + 1} needs an id and a question.`)
    return { id: q.id, question: q.question.trim() }
  })
}
