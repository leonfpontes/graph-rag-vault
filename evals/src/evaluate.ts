// One evaluation from start to end, with its inputs injected (index, questions, model provider,
// embedders), so the tests run it with a scripted model and the CLI with the real one.
import {
  ANSWER_MODELS,
  passagesFromHits,
  promptVersion,
  readAnswerPrompt,
  type ModelProvider,
} from '@graph-rag/answer'
import type { Embedder } from '@graph-rag/embeddings'
import { createSearch, type SearchIndex } from '@graph-rag/search'

import type { EvalArgs } from './args.js'
import { bestBaseline, vectorBaseline, type BaselineScore } from './baselines.js'
import { Budget } from './budget.js'
import { runGeneration, summarizeGeneration, type AnswerRecord } from './generation.js'
import { JUDGE_MODELS, judgePromptVersion, readJudgePrompt } from './judge.js'
import { retrievalReport, RETRIEVAL_VARIANTS, type RetrievalVariant } from './retrieval.js'
import { countByKind, verdictOf, type Results } from './scoreboard.js'
import type { Question } from './types.js'

export interface EvaluateInputs {
  args: Pick<
    EvalArgs,
    'splits' | 'rehearsal' | 'rounds' | 'budgetUsd' | 'concurrency' | 'variants' | 'questions' | 'demoExtras'
  >
  index: SearchIndex
  questions: readonly Question[]
  provider: ModelProvider
  /** Embedders of the other candidate models, for the vector baselines; none skips them. */
  baselineEmbedders?: () => AsyncIterable<Pick<Embedder, 'model' | 'embedQuery' | 'embedPassages'>>
  embeddingModelKey: string
  now?: () => Date
  log?: (line: string) => void
}

export interface EvaluateOutcome {
  results: Results
  /** Every answer: the scored ones and, flagged by split, the demo extras. */
  records: AnswerRecord[]
}

export async function evaluate(inputs: EvaluateInputs): Promise<EvaluateOutcome> {
  const { args, index } = inputs
  const log = inputs.log ?? (() => {})
  const recorded = new Map(index.queries.map((q) => [q.id, q]))
  for (const q of inputs.questions) {
    const r = recorded.get(q.id)
    if (!r || r.question !== q.question)
      throw new Error(`The index has no vector for ${q.id} as written now: run pnpm index.`)
  }
  const wanted = (q: Question) => !args.questions || args.questions.includes(q.id)
  const scored = inputs.questions.filter((q) => args.splits.includes(q.split) && wanted(q))
  if (scored.length === 0) throw new Error('No question matches the splits and ids asked for.')

  const search = createSearch(index)
  const hits = (q: Question, variant: RetrievalVariant, k = 20) =>
    search.search({ question: q.question, variant, queryVector: recorded.get(q.id)!.vector, k })

  log(`retrieval on ${scored.length} questions`)
  const retrieval = retrievalReport(scored, (q, v) => hits(q, v).map((h) => h.noteId), {
    splits: args.splits,
  })

  const baselines: BaselineScore[] = [{ model: inputs.embeddingModelKey, scores: retrieval.scores.vector }]
  if (inputs.baselineEmbedders)
    for await (const embedder of inputs.baselineEmbedders()) {
      log(`vector baseline with ${embedder.model.key}`)
      baselines.push(await vectorBaseline(index, scored, embedder, args.splits))
    }
  const best = bestBaseline(baselines)

  const budget = new Budget(args.budgetUsd * 1e6)
  const passagesFor = (q: Question, v: RetrievalVariant) => passagesFromHits(index, hits(q, v))
  log(`answers: ${scored.length} questions × ${args.variants.length} variants × ${args.rounds} rounds`)
  const main = await runGeneration({
    questions: scored,
    variants: args.variants,
    rounds: args.rounds,
    passagesFor,
    provider: inputs.provider,
    budget,
    concurrency: args.concurrency,
    log,
  })
  // Only the scoreboard run answers the other questions for the demo: a rehearsal must never read
  // an answer to a test question.
  const extrasQuestions =
    args.demoExtras && !args.rehearsal && !args.questions
      ? inputs.questions.filter((q) => !args.splits.includes(q.split))
      : []
  const extras = extrasQuestions.length
    ? await runGeneration({
        questions: extrasQuestions,
        variants: ['hybrid'],
        rounds: 1,
        passagesFor,
        provider: inputs.provider,
        budget,
        concurrency: args.concurrency,
        log,
      })
    : { records: [], skipped: 0, stoppedEarly: false }

  const all = [...main.records, ...extras.records]
  const sum = (key: 'answerMicros' | 'judgeMicros') => all.reduce((s, r) => s + r[key], 0) / 1e6
  const errors = main.records.filter((r) => r.status === 'error').length
  const notes: string[] = []
  if (errors)
    notes.push(`${errors} answers failed after retries and the fallback; they are counted, not scored.`)
  const results: Results = {
    version: 1,
    runAt: (inputs.now ?? (() => new Date()))().toISOString(),
    rehearsal: args.rehearsal,
    splits: [...args.splits],
    questions: { total: scored.length, byKind: countByKind(scored) },
    rounds: args.rounds,
    models: {
      answer: ANSWER_MODELS.primary,
      answerFallback: ANSWER_MODELS.fallback,
      judge: JUDGE_MODELS.primary,
      embeddings: inputs.embeddingModelKey,
    },
    promptVersions: {
      answer: promptVersion(readAnswerPrompt()),
      judge: judgePromptVersion(readJudgePrompt()),
    },
    index: { sourceHash: index.sourceHash, model: index.model.id },
    retrieval: Object.fromEntries(
      RETRIEVAL_VARIANTS.map((v) => [v, retrieval.scores[v]]),
    ) as Results['retrieval'],
    baselines,
    verdict: verdictOf(retrieval.scores, best),
    generation: summarizeGeneration(main.records, scored, args.variants) as Results['generation'],
    cost: {
      capUsd: args.budgetUsd,
      spentUsd: budget.spent / 1e6,
      answerUsd: sum('answerMicros'),
      judgeUsd: sum('judgeMicros'),
      skipped: main.skipped + extras.skipped,
      stoppedEarly: main.stoppedEarly || extras.stoppedEarly,
    },
    human: null,
    notes,
  }
  return { results, records: all }
}
