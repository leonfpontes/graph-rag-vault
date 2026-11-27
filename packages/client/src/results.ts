// The evaluation's files as the app reads them: the scoreboard (evals/results/latest.json), every
// recorded answer (evals/results/answers.json) and the questions (evals/questions.yaml, as JSON).
// The app serves the first two byte for byte (apps/web/data-files.ts), so a number on screen is
// always the number in latest.json. These are read-only views of evals' own types; a test checks
// that evals' types still fit them.
import type { CitationCount, RemovedSentence, Sentence } from '@graph-rag/answer/passages'
import type { SearchVariant } from '@graph-rag/search'

export type QuestionKind = 'fact' | 'multi-hop' | 'temporal' | 'unanswerable'
export type Split = 'probe' | 'dev' | 'test'

/** One of the 50 questions (`/data/questions.json`). */
export interface RecordedQuestion {
  id: string
  kind: QuestionKind
  /** `probe` and `dev` tuned the search; `test` makes the scoreboard. */
  split: Split
  question: string
  /** The notes a good answer comes from. Empty for unanswerable questions. */
  expectedSources: string[]
  /** What makes it hard for a search on embeddings alone (`bridge`, `supersedes`, `alias`…). */
  traps: string[]
}

export interface RetrievalScore {
  questions: number
  recall5: number | undefined
  mrr: number | undefined
}

export interface Spread {
  mean: number | undefined
  /** Sample standard deviation over the rounds. */
  sd: number
  rounds: (number | undefined)[]
}

export interface GenerationScore {
  faithfulness: Spread
  citationPrecision: Spread
  removedShare: Spread
  correctUnknown: Spread
  answered: Spread
  sourceRecall: Spread
  answers: number
  errors: number
  costPerAnswerUsd: number | undefined
  medianLatencyMs: number | undefined
}

export type Outcome = 'win' | 'tie' | 'loss'

/** `/data/latest.json`: the scoreboard. Show only what is here; never a number written by hand. */
export interface Scoreboard {
  version: 1
  runAt: string
  rehearsal: boolean
  splits: Split[]
  questions: { total: number; byKind: Record<string, number> }
  rounds: number
  models: { answer: string; answerFallback: string | null; judge: string; embeddings: string }
  promptVersions: { answer: string; judge: string }
  index: { sourceHash: string; model: string }
  /** Per variant: `all` and each answerable kind. */
  retrieval: Record<SearchVariant, Record<string, RetrievalScore>>
  baselines: { model: string; scores: Record<string, RetrievalScore> }[]
  verdict: {
    metric: 'recall@5'
    bestOther: { variant: Exclude<SearchVariant, 'hybrid'>; recall5: number | undefined }
    pointsVsBestOther: number | undefined
    outcomeVsBestOther: Outcome | undefined
    hybrid: number | undefined
    vector: number | undefined
    bestVector: { model: string; recall5: number | undefined } | null
    points: number | undefined
    pointsVsBest: number | undefined
    outcome: Outcome | undefined
    outcomeVsBest: Outcome | undefined
  }
  generation: Record<SearchVariant, GenerationScore>
  cost: {
    capUsd: number
    spentUsd: number
    answerUsd: number
    judgeUsd: number
    skipped: number
    /** Answers kept from the earlier run because their search notes did not change. */
    reused?: number
    stoppedEarly: boolean
  }
  human: {
    items: number
    answers: number
    observed: number
    kappa: number | undefined
    labeledBy: string
    labeledAt: string
    /** False when the person reviewed the judge's verdicts rather than labelling without them. */
    blind?: boolean
    /** Answers in the sample, and those with a sentence the person has not labelled yet. */
    sampleAnswers?: number
    pendingAnswers?: number
    pendingReason?: string
    /** The sentences the person labelled blind, inside a review that was otherwise not blind. */
    blindPart?: {
      items: number
      agreed: number
      labeledAt: string
      disagreements: {
        item: string
        questionId: string
        variant: string
        sentence: string
        judge: 'supported' | 'partial' | 'unsupported'
        human: 'supported' | 'partial' | 'unsupported'
      }[]
    }
  } | null
  /** A second automatic judge on the same sample: agreement between 2 models, not a human check. */
  secondJudge?: {
    model: string
    judgedAt: string
    costUsd: number
    items: number
    answers: number
    observed: number
    kappa: number | undefined
    /** Sentences the main judge did not mark as fully supported. */
    judgeFlagged: number
    /** The labels the second judge gave (one label only: kappa says little). */
    secondLabels?: ('supported' | 'partial' | 'unsupported')[]
    disagreements: {
      item: string
      questionId: string
      variant: string
      sentence: string
      judge: 'supported' | 'partial' | 'unsupported'
      second: 'supported' | 'partial' | 'unsupported'
      reason: string
    }[]
  }
  notes: string[]
}

/** One recorded answer (`/data/answers.json`). */
export interface RecordedAnswer {
  questionId: string
  kind: QuestionKind
  split: Split
  variant: SearchVariant
  round: number
  /** The notes whose passages the answer read, in order: the search's top 5. */
  passageNotes: string[]
  status: 'answered' | 'unknown' | 'error'
  sentences: Sentence[]
  removed: RemovedSentence[]
  /** With "I don't know": the notes nearest to the question. */
  nearest: string[]
  citations: CitationCount
  /** The judge's label for each kept sentence, in order. */
  verdicts: { verdict: 'supported' | 'partial' | 'unsupported'; reason: string }[]
  answerModel: string | null
  judgeModel: string | null
  fallbackUsed: boolean
  answerMicros: number
  judgeMicros: number
  latencyMs: number
  error?: string
}

/** The answer the demo replays for a question: round 1 of that variant, if it was recorded. */
export function recordedAnswerFor(
  answers: readonly RecordedAnswer[],
  questionId: string,
  variant: SearchVariant = 'hybrid',
): RecordedAnswer | undefined {
  return answers.find((a) => a.questionId === questionId && a.variant === variant && a.round === 1)
}
