// Retrieval scores of the three search variants: recall@5 and MRR of the expected source notes, per
// variant and per kind of question. Deterministic and free (no model), so one round is enough.
// Tuning reads only the probe and dev questions: asking for the test split together with custom
// weights is refused, so the scoreboard never comes from weights fitted to it.
import { mean, recallAtK, reciprocalRank } from './metrics.js'
import { QUESTION_KINDS, type Question, type Split } from './types.js'

export const RETRIEVAL_VARIANTS = ['vector', 'graph', 'hybrid'] as const
export type RetrievalVariant = (typeof RETRIEVAL_VARIANTS)[number]

export interface RetrievalRow {
  id: string
  kind: Question['kind']
  split: Split
  variant: RetrievalVariant
  recall5: number | undefined
  rr: number | undefined
  top5: string[]
}

export interface RetrievalScore {
  questions: number
  recall5: number | undefined
  mrr: number | undefined
}

export interface RetrievalReport {
  splits: Split[]
  rows: RetrievalRow[]
  /** variant → kind (or `all`) → score; kinds with no answerable question are left out. */
  scores: Record<RetrievalVariant, Record<string, RetrievalScore>>
}

export interface RetrievalOptions {
  splits: readonly Split[]
  /** True when the run uses weights other than the committed defaults (a tuning run). */
  tuning?: boolean
}

export function retrievalReport(
  questions: readonly Question[],
  rank: (question: Question, variant: RetrievalVariant) => string[],
  { splits, tuning = false }: RetrievalOptions,
): RetrievalReport {
  if (splits.length === 0) throw new Error('Pick at least one split.')
  if (tuning && splits.includes('test'))
    throw new Error(
      'Weights are tuned on the probe and dev questions only; the test split is for the scoreboard.',
    )
  const chosen = questions.filter((q) => splits.includes(q.split))
  const rows: RetrievalRow[] = []
  for (const q of chosen)
    for (const variant of RETRIEVAL_VARIANTS) {
      const ranked = rank(q, variant)
      rows.push({
        id: q.id,
        kind: q.kind,
        split: q.split,
        variant,
        recall5: recallAtK(ranked, q.expectedSources, 5),
        rr: reciprocalRank(ranked, q.expectedSources),
        top5: ranked.slice(0, 5),
      })
    }
  const scores = {} as RetrievalReport['scores']
  for (const variant of RETRIEVAL_VARIANTS) {
    scores[variant] = {}
    for (const kind of ['all', ...QUESTION_KINDS]) {
      const sel = rows.filter(
        (r) => r.variant === variant && (kind === 'all' || r.kind === kind) && r.recall5 !== undefined,
      )
      if (sel.length === 0) continue
      scores[variant][kind] = {
        questions: sel.length,
        recall5: mean(sel.map((r) => r.recall5)),
        mrr: mean(sel.map((r) => r.rr)),
      }
    }
  }
  return { splits: [...splits], rows, scores }
}

const fmt = (x: number | undefined) => (x === undefined ? '—' : x.toFixed(2))

/** The report as a plain table: one line per kind, recall@5 and MRR of each variant. */
export function formatRetrieval(report: RetrievalReport): string {
  const kinds = ['all', ...QUESTION_KINDS].filter((k) => report.scores.vector[k])
  const lines = [
    `Retrieval on ${report.splits.join(' + ')} · recall@5 / MRR`,
    `${'kind'.padEnd(14)}${RETRIEVAL_VARIANTS.map((v) => v.padEnd(16)).join('')}`,
  ]
  for (const kind of kinds)
    lines.push(
      `${`${kind} (${report.scores.vector[kind]!.questions})`.padEnd(14)}${RETRIEVAL_VARIANTS.map((v) => {
        const s = report.scores[v][kind]
        return `${fmt(s?.recall5)} / ${fmt(s?.mrr)}`.padEnd(16)
      }).join('')}`,
    )
  return lines.join('\n')
}
