// The flags of `pnpm eval`, checked before anything runs. A budget that isn't a number would turn
// into NaN, and every "spent + job > NaN" check would pass: the cap would be gone. So every number is
// validated here, and a bad value stops the command with what to fix.
import { parseArgs } from 'node:util'

import { RETRIEVAL_VARIANTS, type RetrievalVariant } from './retrieval.js'
import { SPLITS, type Split } from './types.js'

/** Budgets above this need `--confirm-budget`, so a typo can't buy a large evaluation. */
export const MAX_BUDGET_USD = 20

export interface EvalArgs {
  splits: Split[]
  /** True unless the test split is scored: a rehearsal never writes the scoreboard. */
  rehearsal: boolean
  rounds: number
  budgetUsd: number
  concurrency: number
  variants: RetrievalVariant[]
  questions?: string[]
  baselines: boolean
  /** Also answer the questions outside the scored splits once (hybrid), for the demo to replay. */
  demoExtras: boolean
  index: string
  questionsFile: string
  out: string
  /** Rebuild latest.md and the human check from the files, with no model call. */
  report: boolean
  /** Write the human sample and its sheet to this path. */
  sheet?: string
}

const positive = (name: string, raw: string): number => {
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(n) || n <= 0)
    throw new Error(`--${name} must be a number of dollars above 0, like 5 or 0.5 (got "${raw}").`)
  return n
}

const count = (name: string, raw: string): number => {
  const n = Number(raw)
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(n) || n < 1)
    throw new Error(`--${name} must be a whole number of 1 or more (got "${raw}").`)
  return n
}

const list = (raw: string) =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function parseEvalArgs(argv: string[]): EvalArgs {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== '--'),
    options: {
      split: { type: 'string', default: 'test' },
      rounds: { type: 'string', default: '3' },
      budget: { type: 'string', default: '5' },
      concurrency: { type: 'string', default: '4' },
      variants: { type: 'string', default: RETRIEVAL_VARIANTS.join(',') },
      questions: { type: 'string' },
      'no-baselines': { type: 'boolean', default: false },
      'no-demo-extras': { type: 'boolean', default: false },
      index: { type: 'string', default: 'apps/web/public/data/index.bin' },
      'questions-file': { type: 'string', default: 'evals/questions.yaml' },
      out: { type: 'string', default: 'evals/results' },
      report: { type: 'boolean', default: false },
      sheet: { type: 'string' },
      'confirm-budget': { type: 'boolean', default: false },
    },
  })
  const splits = list(values.split)
  for (const s of splits)
    if (!(SPLITS as readonly string[]).includes(s))
      throw new Error(`--split must be among ${SPLITS.join(', ')} (got "${s}").`)
  if (splits.length === 0) throw new Error('--split needs at least one split.')
  const variants = list(values.variants)
  for (const v of variants)
    if (!(RETRIEVAL_VARIANTS as readonly string[]).includes(v))
      throw new Error(`--variants must be among ${RETRIEVAL_VARIANTS.join(', ')} (got "${v}").`)
  if (variants.length === 0) throw new Error('--variants needs at least one variant.')
  const budgetUsd = positive('budget', values.budget)
  if (budgetUsd > MAX_BUDGET_USD && !values['confirm-budget'])
    throw new Error(
      `--budget $${budgetUsd} is above $${MAX_BUDGET_USD}. Add --confirm-budget if you mean to spend that much.`,
    )
  const questions = values.questions === undefined ? undefined : list(values.questions)
  if (questions?.length === 0) throw new Error('--questions needs at least one question id.')
  return {
    splits: splits as Split[],
    rehearsal: !splits.includes('test'),
    rounds: count('rounds', values.rounds),
    budgetUsd,
    concurrency: count('concurrency', values.concurrency),
    variants: variants as RetrievalVariant[],
    questions,
    baselines: !values['no-baselines'],
    demoExtras: !values['no-demo-extras'],
    index: values.index,
    questionsFile: values['questions-file'],
    out: values.out,
    report: values.report,
    sheet: values.sheet,
  }
}
