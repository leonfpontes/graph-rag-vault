// The scoreboard: retrieval (one round, deterministic), the vector baselines, the generated answers
// (mean ± deviation over rounds), the cost and the human check of the judge. evals/results/latest.json
// is the source the README, the site and the share images read; latest.md is the same in prose.
import type { BaselineScore } from './baselines.js'
import type { GenerationScore, Spread } from './generation.js'
import type { RetrievalScore, RetrievalVariant } from './retrieval.js'
import type { Question, Split } from './types.js'

/** Differences under this many recall@5 points are reported as a tie. */
export const TIE_POINTS = 5

export type Outcome = 'win' | 'tie' | 'loss'

export interface Results {
  version: 1
  runAt: string
  /** A rehearsal on the tuning questions, not the scoreboard. */
  rehearsal: boolean
  splits: Split[]
  questions: { total: number; byKind: Record<string, number> }
  rounds: number
  models: { answer: string; answerFallback: string | null; judge: string; embeddings: string }
  promptVersions: { answer: string; judge: string }
  index: { sourceHash: string; model: string }
  retrieval: Record<RetrievalVariant, Record<string, RetrievalScore>>
  baselines: BaselineScore[]
  verdict: {
    metric: 'recall@5'
    hybrid: number | undefined
    vector: number | undefined
    bestVector: { model: string; recall5: number | undefined } | null
    points: number | undefined
    pointsVsBest: number | undefined
    outcome: Outcome | undefined
    outcomeVsBest: Outcome | undefined
  }
  generation: Record<RetrievalVariant, GenerationScore>
  cost: {
    capUsd: number
    spentUsd: number
    answerUsd: number
    judgeUsd: number
    skipped: number
    stoppedEarly: boolean
  }
  human: {
    items: number
    answers: number
    observed: number
    kappa: number | undefined
    labeledBy: string
    labeledAt: string
  } | null
  notes: string[]
}

export const outcome = (points: number | undefined): Outcome | undefined =>
  points === undefined ? undefined : points >= TIE_POINTS ? 'win' : points <= -TIE_POINTS ? 'loss' : 'tie'

const points = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? undefined : Math.round((a - b) * 1000) / 10

export function verdictOf(
  retrieval: Results['retrieval'],
  best: BaselineScore | undefined,
): Results['verdict'] {
  const hybrid = retrieval.hybrid.all?.recall5
  const vector = retrieval.vector.all?.recall5
  const bestRecall = best?.scores.all?.recall5
  const p = points(hybrid, vector)
  // The shipped model is one of the candidates, so the best is never below it.
  const strongest =
    bestRecall !== undefined && vector !== undefined ? Math.max(bestRecall, vector) : (bestRecall ?? vector)
  const pBest = points(hybrid, strongest)
  return {
    metric: 'recall@5',
    hybrid,
    vector,
    bestVector: best ? { model: best.model, recall5: bestRecall } : null,
    points: p,
    pointsVsBest: pBest,
    outcome: outcome(p),
    outcomeVsBest: outcome(pBest),
  }
}

export const countByKind = (questions: readonly Question[]) =>
  questions.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q.kind]: (acc[q.kind] ?? 0) + 1 }), {})

const pct = (x: number | undefined) => (x === undefined ? '—' : `${Math.round(x * 100)}%`)
const pm = (s: Spread) => (s.mean === undefined ? '—' : `${pct(s.mean)} ± ${Math.round(s.sd * 100)}`)
const usd = (x: number | undefined, digits = 4) => (x === undefined ? '—' : `$${x.toFixed(digits)}`)

const VARIANT_NAMES: Record<RetrievalVariant, string> = {
  vector: 'Vectors only',
  graph: 'Graph only',
  hybrid: 'Hybrid',
}

/** The scoreboard in prose: what latest.md says, from latest.json alone. */
export function toMarkdown(r: Results): string {
  const kinds = ['all', 'fact', 'multi-hop', 'temporal'].filter((k) => r.retrieval.vector[k])
  const v = r.verdict
  const headline =
    v.outcome === undefined
      ? 'No verdict: the run has no answerable question.'
      : v.outcome === 'win'
        ? `Hybrid search finds ${pct(v.hybrid)} of the expected notes in its top 5, against ${pct(v.vector)} for vectors only (+${v.points} points).`
        : v.outcome === 'tie'
          ? `Hybrid search and vectors only tie: ${pct(v.hybrid)} against ${pct(v.vector)} of the expected notes in the top 5 (${v.points} points, under the ${TIE_POINTS}-point tie line).`
          : `Vectors only beat hybrid search: ${pct(v.vector)} against ${pct(v.hybrid)} of the expected notes in the top 5 (${v.points} points).`
  const lines = [
    r.rehearsal
      ? `# Rehearsal on the tuning questions (${r.splits.join(' + ')}): not the scoreboard`
      : `# Scoreboard: ${r.questions.total} questions never used for tuning`,
    '',
    headline,
  ]
  if (v.bestVector && v.bestVector.model !== r.models.embeddings)
    lines.push(
      `Against the strongest vector search we tried (${v.bestVector.model}, ${pct(v.bestVector.recall5)}), hybrid is ${v.pointsVsBest! >= 0 ? '+' : ''}${v.pointsVsBest} points: a ${v.outcomeVsBest}.`,
    )
  for (const note of r.notes) lines.push('', `> **Note:** ${note}`)
  lines.push(
    '',
    `## Retrieval · recall@5 / MRR (one round: the search is deterministic)`,
    '',
    `| Variant | ${kinds.map((k) => `${k} (${r.retrieval.vector[k]!.questions})`).join(' | ')} |`,
    `| --- | ${kinds.map(() => '---').join(' | ')} |`,
    ...(['vector', 'graph', 'hybrid'] as const).map(
      (variant) =>
        `| ${VARIANT_NAMES[variant]} (${r.models.embeddings}) | ${kinds
          .map((k) => {
            const s = r.retrieval[variant][k]
            return s ? `${pct(s.recall5)} / ${s.mrr?.toFixed(2) ?? '—'}` : '—'
          })
          .join(' | ')} |`,
    ),
    ...r.baselines
      .filter((b) => b.model !== r.models.embeddings)
      .map(
        (b) =>
          `| Vectors only (${b.model}) | ${kinds
            .map((k) => {
              const s = b.scores[k]
              return s ? `${pct(s.recall5)} / ${s.mrr?.toFixed(2) ?? '—'}` : '—'
            })
            .join(' | ')} |`,
      ),
    '',
    `## Answers · mean ± deviation over ${r.rounds} rounds (${r.models.answer}, judged by ${r.models.judge})`,
    '',
    '| Variant | Faithfulness | Citations kept | Sentences removed | "I don\'t know" when unanswerable | Answered when answerable | Expected notes cited | Cost per answer | Median latency |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...(['vector', 'graph', 'hybrid'] as const)
      .filter((variant) => r.generation[variant])
      .map((variant) => {
        const g = r.generation[variant]
        return `| ${VARIANT_NAMES[variant]} | ${pm(g.faithfulness)} | ${pm(g.citationPrecision)} | ${pm(g.removedShare)} | ${pm(g.correctUnknown)} | ${pm(g.answered)} | ${pm(g.sourceRecall)} | ${usd(g.costPerAnswerUsd)} | ${g.medianLatencyMs === undefined ? '—' : `${(g.medianLatencyMs / 1000).toFixed(1)} s`} |`
      }),
    '',
    r.human
      ? `**Judge checked by a human:** ${r.human.items} sentences from ${r.human.answers} answers; agreement ${pct(r.human.observed)}, Cohen's kappa ${r.human.kappa?.toFixed(2) ?? '— (one label only)'}.`
      : '**Judge checked by a human:** pending.',
    '',
    `**Cost:** ${usd(r.cost.spentUsd, 2)} of a ${usd(r.cost.capUsd, 2)} cap (answers ${usd(r.cost.answerUsd, 2)}, judge ${usd(r.cost.judgeUsd, 2)})${r.cost.stoppedEarly ? `; stopped at the cap with ${r.cost.skipped} answers not run` : ''}.`,
    '',
    `Run ${r.runAt.slice(0, 10)} · answer prompt ${r.promptVersions.answer} · judge prompt ${r.promptVersions.judge} · index ${r.index.sourceHash.slice(0, 12)}. Faithfulness: supported 1, partial 0.5, unsupported 0, per sentence kept. "Citations kept": the share of the sources the model gave whose quote is in the cited passage (checked by code).`,
  )
  return `${lines.join('\n')}\n`
}
