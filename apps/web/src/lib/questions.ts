// How many recorded questions there are, and how many of them the scoreboard scores (split `test`);
// the others tuned the search. The screens say both, from questions.json, never a number by hand.
import type { RecordedQuestion } from '@graph-rag/client'

export function questionCounts(questions: readonly RecordedQuestion[]) {
  const scored = questions.filter((q) => q.split === 'test').length
  return { all: questions.length, scored, tuned: questions.length - scored }
}

/** "50 recorded questions (40 scored, 10 for tuning)". */
export function recordedQuestionsText(questions: readonly RecordedQuestion[]): string {
  const c = questionCounts(questions)
  return `${c.all} recorded questions (${c.scored} scored, ${c.tuned} for tuning)`
}
