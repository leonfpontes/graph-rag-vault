// The evaluation's contract: a question, the notes a good answer must come from, and where the
// question may be used. The world file generates the expected sources, so they can't drift from
// the vault.

/** The four kinds of question in the set. */
export const QUESTION_KINDS = ['fact', 'multi-hop', 'temporal', 'unanswerable'] as const
export type QuestionKind = (typeof QUESTION_KINDS)[number]

/**
 * `probe` calibrates the difficulty, `dev` tunes the search weights, `test` makes the scoreboard.
 * Test questions are never used for tuning.
 */
export const SPLITS = ['probe', 'dev', 'test'] as const
export type Split = (typeof SPLITS)[number]

export interface Question {
  /** Stable id (`q-001`). */
  id: string
  kind: QuestionKind
  split: Split
  question: string
  /** Note ids the answer must come from, in any order. Empty for `unanswerable`. */
  expectedSources: string[]
}
