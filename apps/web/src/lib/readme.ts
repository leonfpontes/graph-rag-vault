// The README's scoreboard, written from evals/results/latest.json and never by hand: the table of the
// three variants, the search verdict (the same rule as headline()), and the judge check in the same
// sentences as the Evaluation page (judgeLines). readme.test.ts fails when README.md falls behind;
// `pnpm readme` rewrites the block between the markers.
import type { Scoreboard } from '@graph-rag/client'
import type { SearchVariant } from '@graph-rag/search'

import { judgeLines, modelLabel } from './judge'
import { pct, signed } from './format'
import { ANSWERABLE_KINDS, VARIANT_NAME } from './headline'

export const START = '<!-- scoreboard:start (generated from evals/results/latest.json by `pnpm readme`) -->'
export const END = '<!-- scoreboard:end -->'

const ORDER: SearchVariant[] = ['hybrid', 'graph', 'vector']

/** A Markdown table with its columns padded, as Prettier writes it. */
function table(head: string[], rows: string[][]): string[] {
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(width[i]!)).join(' | ')} |`
  return [line(head), `| ${width.map((w) => '-'.repeat(w)).join(' | ')} |`, ...rows.map(line)]
}

/** The search verdict in one sentence: hybrid against the best other variant, then against vectors only. */
export function searchLine(sb: Scoreboard): string {
  const v = sb.verdict
  const best = VARIANT_NAME[v.bestOther.variant].toLowerCase()
  const d = Math.abs(v.pointsVsBestOther ?? 0)
  const first = {
    tie: `hybrid and ${best} tie (${d} points apart, under the 5-point tie line).`,
    win: `hybrid is ${d} points above ${best}.`,
    loss: `${best} is ${d} points above hybrid.`,
  }[v.outcomeVsBestOther ?? 'tie']
  if (v.bestOther.variant === 'vector' || v.points === undefined) return first
  // Where most of the difference with vectors only comes from.
  const byKind = ANSWERABLE_KINDS.map((k) => ({
    k,
    hy: sb.retrieval.hybrid[k]?.recall5 ?? 0,
    ve: sb.retrieval.vector[k]?.recall5 ?? 0,
  })).sort((a, b) => b.hy - b.ve - (a.hy - a.ve))
  const top = byKind[0]!
  let text = `${first} Against vectors only, hybrid is ${signed(v.points, 0)} points`
  if (v.points > 0 && top.hy > top.ve)
    text += `, most of it on ${top.k} questions (${pct(top.hy)} against ${pct(top.ve)})`
  if (v.bestVector && v.bestVector.model !== sb.models.embeddings && v.pointsVsBest !== undefined)
    text += `; against the strongest embedding model we tried for vectors only (${v.bestVector.model}, ${pct(v.bestVector.recall5)}), ${signed(v.pointsVsBest, 0)}`
  return `${text}.`
}

/** "**Checked by a person (Leonardo Pontes)** on…", "**Cost:** $0.17…": the lead of each line in bold. */
function boldLead(line: string): string {
  const m = /^(Checked by a person \([^)]+\))(.*)$/.exec(line) ?? /^([^:]{3,48}:)(.*)$/.exec(line)
  return m ? `**${m[1]}**${m[2]}` : line
}

/** `demoAnswers`: the recorded answers beyond the scoreboard's (one per tuning question, for the demo). */
export function scoreboardBlock(sb: Scoreboard, demoAnswers = 0): string {
  const r = (v: SearchVariant) => sb.retrieval[v].all
  const g = (v: SearchVariant) => sb.generation[v]
  const rows = ORDER.map((v) => [
    VARIANT_NAME[v],
    pct(r(v)?.recall5),
    r(v)?.mrr === undefined ? '—' : r(v)!.mrr!.toFixed(2),
    pct(g(v).answered.mean),
    pct(g(v).sourceRecall.mean),
    pct(g(v).faithfulness.mean),
  ])
  const lines = [
    START,
    '',
    `${sb.questions.total} questions never used for tuning, measured on ${sb.runAt.slice(0, 10)} ([full scoreboard](evals/results/latest.md)).`,
    `Answers by ${modelLabel(sb.models.answer)}, mean of ${sb.rounds} rounds.`,
    '',
    ...table(
      [
        'Variant',
        'Expected notes in the top 5',
        'MRR',
        'Answerable questions answered',
        'Expected notes cited',
        'Faithfulness',
      ],
      rows,
    ),
    '',
    `- **Search:** ${searchLine(sb)}`,
    `- **Faithfulness** comes from an automatic judge (${modelLabel(sb.models.judge)}), sentence by sentence, against the passages each sentence cites.`,
    ...judgeLines(sb, demoAnswers).map((l) => `- ${boldLead(l)}`),
    '',
    END,
  ]
  return lines.join('\n')
}

/** The README with its scoreboard block replaced. */
export function withScoreboard(readme: string, block: string): string {
  const a = readme.indexOf(START)
  const b = readme.indexOf(END)
  if (a < 0 || b < a) throw new Error(`README.md has no ${START} … ${END} block.`)
  return readme.slice(0, a) + block + readme.slice(b + END.length)
}
