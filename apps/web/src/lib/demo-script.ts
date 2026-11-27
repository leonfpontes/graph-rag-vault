// The script of the README GIF and the 1-minute video: which scene shows at each moment and the
// captions, written from the data (the featured question, its results, its answer and path, and the
// scoreboard). The stage (pages/Demo.tsx) is a pure function of the clock, so a recording is the same
// every time. scripts/record-demo.mjs writes the captions to docs/media/graph-rag-demo.numbers.json;
// demo-script.test.ts compares them with these functions.
import type { Scoreboard } from '@graph-rag/client'

import { headline } from './headline'
import type { Featured } from './share'

export type SceneName = 'ask' | 'sources' | 'answer' | 'citation' | 'evaluation' | 'end'

export interface Scene {
  name: SceneName
  from: number
  to: number
}

export interface Caption {
  from: number
  to: number
  text: string
}

export const VIDEO_MS = 60_000
export const GIF_MS = 20_000

export const VIDEO_SCENES: Scene[] = [
  { name: 'ask', from: 0, to: 8_000 },
  { name: 'sources', from: 8_000, to: 19_000 },
  { name: 'answer', from: 19_000, to: 35_000 },
  { name: 'citation', from: 35_000, to: 43_000 },
  { name: 'evaluation', from: 43_000, to: 54_000 },
  { name: 'end', from: 54_000, to: VIDEO_MS },
]

export const GIF_SCENES: Scene[] = [
  { name: 'ask', from: 0, to: 3_000 },
  { name: 'sources', from: 3_000, to: 7_000 },
  { name: 'answer', from: 7_000, to: 15_000 },
  { name: 'evaluation', from: 15_000, to: GIF_MS },
]

export const REPO = 'github.com/leonfpontes/graph-rag-vault'

export function sceneAt(scenes: readonly Scene[], t: number): Scene {
  return scenes.find((s) => t >= s.from && t < s.to) ?? scenes.at(-1)!
}

/** 0 → 1 over the scene, clamped. */
export const progress = (s: Scene, t: number) => Math.min(1, Math.max(0, (t - s.from) / (s.to - s.from)))

/** How many of `n` items show at `t`: one every `step` ms after `start` ms into the scene. */
export const shown = (s: Scene, t: number, n: number, start: number, step: number) =>
  Math.max(0, Math.min(n, Math.floor((t - s.from - start) / step) + 1))

function captionText(name: SceneName, f: Featured, sb: Scoreboard, results: number): string {
  const h = headline(sb)
  switch (name) {
    case 'ask':
      return 'Ask the Tarnwick vault a question. The search runs in your browser, with no key.'
    case 'sources':
      return `Hybrid search: vectors, words and typed links. Each of the ${results} results says why it came in.`
    case 'answer':
      return `Every sentence cites its source. The path lights the ${f.edges.length} links the answer walked.`
    case 'citation':
      return 'A citation opens the exact passage the answer read.'
    case 'evaluation':
      return `Measured on ${sb.questions.total} held-out questions. ${h?.short ?? ''}`.trim()
    case 'end':
      return `Three commands, no key: ${REPO}`
  }
}

export function captions(scenes: readonly Scene[], f: Featured, sb: Scoreboard, results = 5): Caption[] {
  return scenes.map((s) => ({ from: s.from, to: s.to, text: captionText(s.name, f, sb, results) }))
}
