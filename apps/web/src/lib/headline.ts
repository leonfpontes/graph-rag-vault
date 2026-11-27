// The scoreboard sentence (docs/DESIGN.md, The sentence): written from the verdict in latest.json, never
// by hand. Hybrid search is compared with the best other variant on recall@5, and under 5 points is a
// tie (`verdict.outcomeVsBestOther`); a second line says what the graph adds to vectors whenever the
// best other variant is not vectors only. Recall@5 is the share of the expected notes in the top 5,
// so the words are "of the expected notes", never "of questions".
import type { Scoreboard } from '@graph-rag/client'
import type { SearchVariant } from '@graph-rag/search'

import { pct, signed } from './format'

export const VARIANT_NAME: Record<SearchVariant, string> = {
  vector: 'Vectors only',
  graph: 'Graph only',
  hybrid: 'Hybrid',
}

/** The toggle's short words for the variants. */
export const VARIANT_SHORT: Record<SearchVariant, string> = {
  hybrid: 'Hybrid',
  vector: 'Vectors',
  graph: 'Graph',
}

export interface Headline {
  outcome: 'win' | 'tie' | 'loss'
  /** One line for titles and the share pieces. */
  short: string
  /** The Evaluation page's sentence. */
  long: string
  /** What the graph adds to vectors, when the best other variant is not vectors only ('' otherwise). */
  sub: string
  subShort: string
}

export function headline(scoreboard: Scoreboard): Headline | undefined {
  const v = scoreboard.verdict
  const outcome = v.outcomeVsBestOther
  const points = v.pointsVsBestOther
  if (!outcome || points === undefined || v.hybrid === undefined || v.bestOther.recall5 === undefined) return
  const best = VARIANT_NAME[v.bestOther.variant]
  const lower = best.toLowerCase()
  const h = pct(v.hybrid)
  const b = pct(v.bestOther.recall5)
  const diff = `${signed(points, 0)} points`
  const short = {
    win: `Hybrid search: recall@5 ${h}. ${best}: ${b}.`,
    tie: `Hybrid search and ${lower} tie: recall@5 ${h} and ${b}.`,
    loss: `${best}: recall@5 ${b}. Hybrid search: ${h}.`,
  }[outcome]
  const long = {
    win: `Hybrid search finds ${h} of the expected notes in the top 5, against ${b} with ${lower} (${diff}).`,
    tie: `Hybrid search and ${lower} tie: ${h} and ${b} of the expected notes in the top 5 (${diff}, under the 5-point tie line).`,
    loss: `${best} finds ${b} of the expected notes in the top 5, and hybrid search ${h} (${diff}).`,
  }[outcome]
  const vsVectors = v.bestOther.variant !== 'vector' && v.vector !== undefined && v.points !== undefined
  return {
    outcome,
    short,
    long,
    sub: vsVectors
      ? `Against vectors only (${pct(v.vector)}), hybrid search is ${signed(v.points!)} points: what the graph adds to vectors.`
      : '',
    subShort: vsVectors ? `Vectors only: ${pct(v.vector)} (hybrid ${signed(v.points!)} points).` : '',
  }
}

export const ANSWERABLE_KINDS = ['fact', 'multi-hop', 'temporal'] as const

/** The line over "recall@5 by question kind": neutral when the graph does not help. */
export function kindLine(scoreboard: Scoreboard): { title: string; text: string } {
  const r = scoreboard.retrieval
  const d = ANSWERABLE_KINDS.map((k) => {
    const hy = r.hybrid[k]?.recall5
    const ve = r.vector[k]?.recall5
    return [k, hy === undefined || ve === undefined ? 0 : Math.round((hy - ve) * 100)] as const
  })
  const up = d.filter(([, x]) => x >= 5)
  const down = d.filter(([, x]) => x <= -5)
  const list = (xs: (typeof d)[number][], sign: number) => {
    const p = xs.map(([k, x]) => `${k} (${sign * x} points)`)
    return p.length > 1 ? `${p.slice(0, -1).join(', ')} and ${p.at(-1)}` : p[0]
  }
  if (up.length && !down.length)
    return {
      title: 'Where the graph helps',
      text: `Hybrid search adds ${up.map(([k, x]) => `${x} points on ${k}`).join(' and ')} questions over vectors only.`,
    }
  if (!up.length && !down.length)
    return {
      title: 'Recall@5 by question kind',
      text: 'Hybrid search and vectors only stay within 5 points on every kind of question.',
    }
  return {
    title: 'Recall@5 by question kind',
    text: `Vectors only scores higher on ${list(down, -1)}${up.length ? `; hybrid search scores higher on ${list(up, 1)}` : ''}.`,
  }
}
