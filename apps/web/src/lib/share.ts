// What the landing hero and the share images (README cover, social preview, OG image) show: one
// composition (docs/DESIGN.md, Share images). The question, its recorded answer with the citations,
// the links the answer walked, and the scoreboard sentence on one line at the bottom. Only that line
// changes with the result, so the pieces never depend on hybrid search winning.
//
// Everything here comes from the demo's files: the question and its answer from questions.json and
// answers.json, the path from the index (answerPath), the sentence from latest.json (headline).
// scripts/share-images.mjs writes `shareValues()` next to the images; share.test.ts fails when they
// fall behind these sources.
import type { Demo, RecordedAnswer, RecordedQuestion, Scoreboard } from '@graph-rag/client'
import type { Sentence } from '@graph-rag/answer/passages'

import { answerPath, type PathEdge } from './answer-path'
import { headline, type Headline } from './headline'

/**
 * The question the pieces show: a multi-hop test question whose recorded hybrid answer the judge
 * supported sentence by sentence, with the longest lit path among those (share.test.ts checks both).
 */
export const FEATURED_QUESTION = 'q-020'

export interface FeaturedNode {
  id: string
  type: string
  title: string
  /** The name written on the graph: the title up to its first " · " or "(", at most 20 characters. */
  short: string
  /** Its citation number, if the answer cited it. */
  cite?: number
}

export interface Featured {
  question: RecordedQuestion
  answer: RecordedAnswer
  sentences: Sentence[]
  /** Source number by note id. */
  cites: Record<string, number>
  edges: PathEdge[]
  /** The notes on the lit links, in path order. */
  nodes: FeaturedNode[]
}

/** "Supply review · 2 Oct 2026" → "Supply review"; long titles end at a word, with an ellipsis. */
export function shortTitle(title: string, max = 20): string {
  const head = title.split(/ · | \(/)[0]!.trim()
  if (head.length <= max) return head
  const cut = head.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 8)).trimEnd()}…`
}

/** The notes the lit links touch, walking the path from one end (a note with one link) when there is one. */
export function pathOrder(edges: readonly PathEdge[]): string[] {
  const next = new Map<string, string[]>()
  for (const e of edges) {
    next.set(e.from, [...(next.get(e.from) ?? []), e.to])
    next.set(e.to, [...(next.get(e.to) ?? []), e.from])
  }
  const start = [...next.keys()].find((id) => next.get(id)!.length === 1) ?? [...next.keys()][0]
  const order: string[] = []
  const queue = start ? [start] : []
  while (queue.length) {
    const id = queue.shift()!
    if (order.includes(id)) continue
    order.push(id)
    queue.push(...next.get(id)!.filter((n) => !order.includes(n)))
  }
  return order
}

export async function featured(demo: Demo, questionId = FEATURED_QUESTION): Promise<Featured | undefined> {
  const question = demo.findQuestion(questionId)
  const answer = await demo.recordedAnswer(questionId, 'hybrid')
  if (!question || !answer || answer.status !== 'answered') return
  const hits = demo.search({ question: questionId, variant: 'hybrid' }).hits.slice(0, 5)
  const path = answerPath(
    demo.index,
    hits,
    answer.sentences.flatMap((s) => s.citations),
  )
  const nodes = pathOrder(path.edges).map((id): FeaturedNode => {
    const note = demo.note(id)?.note
    const title = note?.title ?? id
    return {
      id,
      type: note?.type ?? 'document',
      title,
      short: shortTitle(title),
      ...(path.cites[id] ? { cite: path.cites[id] } : {}),
    }
  })
  return { question, answer, sentences: answer.sentences, cites: path.cites, edges: path.edges, nodes }
}

/** The values a share image shows, as scripts/share-images.mjs writes them (docs/share.values.json). */
export interface ShareValues {
  runAt: string
  outcome: Headline['outcome']
  sentence: string
  sentenceSub: string
  recall5: { hybrid: number | undefined; bestOther: number | undefined; vector: number | undefined }
  question: { id: string; text: string }
  answer: { text: string; cites: number[] }[]
  path: { from: string; to: string; relation: string }[]
  nodes: { id: string; label: string; cite: number | null }[]
}

/** The source numbers a sentence shows: one per cited note, in the order it cites them. */
export function sentenceCites(sentence: Sentence, cites: Record<string, number>): number[] {
  const seen = new Set<string>()
  return sentence.citations
    .filter((c) => !seen.has(c.noteId) && seen.add(c.noteId) && cites[c.noteId])
    .map((c) => cites[c.noteId]!)
}

export function shareValues(sb: Scoreboard, f: Featured): ShareValues | undefined {
  const h = headline(sb)
  if (!h) return
  return {
    runAt: sb.runAt,
    outcome: h.outcome,
    sentence: h.short,
    sentenceSub: h.subShort,
    recall5: {
      hybrid: sb.verdict.hybrid,
      bestOther: sb.verdict.bestOther.recall5,
      vector: sb.verdict.vector,
    },
    question: { id: f.question.id, text: f.question.question },
    answer: f.sentences.map((s) => ({ text: s.text, cites: sentenceCites(s, f.cites) })),
    path: f.edges.map(({ from, to, relation }) => ({ from, to, relation })),
    nodes: f.nodes.map((n) => ({ id: n.id, label: n.short, cite: n.cite ?? null })),
  }
}

// The path drawing (viewBox 600 × 380), laid out from the path itself:
// - a chain (each note on at most 2 lit links) zigzags left to right, so every link is long enough
//   for its type written along it; labels of the low notes go under them, of the high notes above;
// - anything else: the note most links touch in the middle, the others around it.
// Citation numbers sit on the side of the note away from its label.

export const PATH_W = 600
export const PATH_H = 380

export interface PlacedNode extends FeaturedNode {
  x: number
  y: number
  /** Where the name goes: under or over the note. */
  labelSide: 'below' | 'above'
  anchor: 'start' | 'middle' | 'end'
}

export function layoutPath(nodes: readonly FeaturedNode[], edges: readonly PathEdge[]): PlacedNode[] {
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }
  const chain = edges.length === nodes.length - 1 && nodes.every((n) => (degree.get(n.id) ?? 0) <= 2)
  const n = nodes.length
  if (chain) {
    const left = 60
    const right = PATH_W - 60
    return nodes.map((node, i) => {
      const low = i % 2 === 0
      return {
        ...node,
        x: n === 1 ? PATH_W / 2 : left + ((right - left) * i) / (n - 1),
        y: low ? 255 : 105,
        labelSide: low ? 'below' : 'above',
        anchor: i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle',
      }
    })
  }
  const hub = [...nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0]!
  const others = nodes.filter((x) => x.id !== hub.id)
  return [
    { ...hub, x: PATH_W / 2, y: PATH_H / 2, labelSide: 'below', anchor: 'middle' },
    ...others.map((node, i): PlacedNode => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / others.length
      const x = PATH_W / 2 + Math.cos(a) * 220
      const y = PATH_H / 2 + Math.sin(a) * 120
      return {
        ...node,
        x,
        y,
        labelSide: y > PATH_H / 2 ? 'below' : 'above',
        anchor: x < 150 ? 'start' : x > PATH_W - 150 ? 'end' : 'middle',
      }
    }),
  ]
}

/**
 * The other two outcomes, to check that the pieces read right whatever the result (the stage's
 * `?case=`). Built from the real recall@5 values moved between variants, and marked as a rehearsal,
 * so the pieces carry the "Example numbers" tag.
 */
export function exampleCase(sb: Scoreboard, outcome: 'win' | 'tie' | 'loss'): Scoreboard {
  const v = sb.verdict
  const hy = v.hybrid ?? 0
  const ve = v.vector ?? 0
  const verdict: Scoreboard['verdict'] =
    outcome === 'win'
      ? {
          ...v,
          bestOther: { variant: 'vector', recall5: ve },
          pointsVsBestOther: (hy - ve) * 100,
          outcomeVsBestOther: 'win',
        }
      : outcome === 'loss'
        ? {
            ...v,
            hybrid: ve,
            bestOther: { variant: 'graph', recall5: hy },
            pointsVsBestOther: (ve - hy) * 100,
            outcomeVsBestOther: 'loss',
            points: 0,
          }
        : { ...v, outcomeVsBestOther: 'tie' }
  return { ...sb, rehearsal: true, verdict }
}
