import type { Scoreboard } from '@graph-rag/client'
import { createVault } from '@graph-rag/client'
import { decodeIndex, type SearchHit } from '@graph-rag/search'
import { describe, expect, it } from 'vitest'

import { excerpt } from '../ask/Sources'
import { layout } from '../graph/layout'
import { bestYaw, frame, sceneState } from '../graph/scene'
import { HEADLINE } from '../test/approved'
import { evalFile, INDEX_BYTES } from '../test/demo'
import { answerPath, citationNumbers } from './answer-path'
import { progressFetch } from './demo'
import { duration, mb, pct, pp, shortDate, signed } from './format'
import { headline, kindLine } from './headline'

const sb = JSON.parse(evalFile('latest.json')) as Scoreboard
const index = decodeIndex(INDEX_BYTES)

const withVerdict = (v: Partial<Scoreboard['verdict']>): Scoreboard => ({
  ...sb,
  verdict: { ...sb.verdict, ...v },
})

describe('the scoreboard sentence', () => {
  it('reads the verdict of latest.json: a tie with graph only, and what the graph adds to vectors', () => {
    expect(headline(sb)).toMatchObject({ outcome: 'tie', ...HEADLINE })
  })

  it('says a win, and a loss, without a word that suggests otherwise', () => {
    const win = headline(
      withVerdict({
        outcomeVsBestOther: 'win',
        hybrid: 0.9,
        pointsVsBestOther: 12,
        bestOther: { variant: 'vector', recall5: 0.78 },
      }),
    )!
    expect(win.short).toBe('Hybrid search: recall@5 90%. Vectors only: 78%.')
    expect(win.long).toBe(
      'Hybrid search finds 90% of the expected notes in the top 5, against 78% with vectors only (+12 points).',
    )
    expect(win.sub).toBe('') // the best other variant is vectors only: no second line
    const loss = headline(withVerdict({ outcomeVsBestOther: 'loss', hybrid: 0.7, pointsVsBestOther: -23 }))!
    expect(loss.short).toBe('Graph only: recall@5 93%. Hybrid search: 70%.')
    expect(loss.long).toMatch(
      /^Graph only finds 93% of the expected notes in the top 5, and hybrid search 70% \(−23 points\)\.$/,
    )
    expect(headline(withVerdict({ outcomeVsBestOther: undefined }))).toBeUndefined()
  })

  it('names where the graph helps only when it does', () => {
    expect(kindLine(sb)).toEqual({
      title: 'Where the graph helps',
      text: 'Hybrid search adds 24 points on multi-hop and 9 points on temporal questions over vectors only.',
    })
    const flat = { ...sb, retrieval: { ...sb.retrieval, hybrid: sb.retrieval.vector } }
    expect(kindLine(flat).title).toBe('Recall@5 by question kind')
    expect(kindLine(flat).text).toMatch(/within 5 points/)
    const worse = {
      ...sb,
      retrieval: { ...sb.retrieval, vector: sb.retrieval.hybrid, hybrid: sb.retrieval.vector },
    }
    expect(kindLine(worse).text).toBe(
      'Vectors only scores higher on multi-hop (24 points) and temporal (9 points).',
    )
  })
})

describe('the answer path', () => {
  const hit = (noteId: string, reasons: SearchHit['reasons'] = []): SearchHit => ({
    noteId,
    score: 1,
    reasons,
  })

  it('lights the links of the reasons and the links quoted from a links passage, and nothing else', () => {
    const hits = [
      hit('dec-switch-battery-voltaro', [
        {
          kind: 'link',
          from: 'mtg-2026-10-02-supply-review',
          relation: 'decided_in',
          direction: 'in',
          hops: 1,
        },
      ]),
      hit('mtg-2026-10-02-supply-review'),
      hit('mtg-2026-03-17-supply-review', [
        { kind: 'link', from: 'dec-keep-ampcore', relation: 'decided_in', direction: 'out', hops: 1 },
      ]),
    ]
    const path = answerPath(index, hits, [
      {
        noteId: 'dec-switch-battery-voltaro',
        chunkId: 'dec-switch-battery-voltaro#links',
        quote: 'Switch Ridgeline battery cells to Voltaro replaces Keep Ampcore as battery supplier.',
      },
    ])
    expect(path.edges).toEqual([
      { from: 'dec-switch-battery-voltaro', to: 'mtg-2026-10-02-supply-review', relation: 'decided_in' },
      { from: 'dec-keep-ampcore', to: 'mtg-2026-03-17-supply-review', relation: 'decided_in' },
      { from: 'dec-switch-battery-voltaro', to: 'dec-keep-ampcore', relation: 'supersedes' },
    ])
    expect(path.notes).toContain('dec-keep-ampcore')
    expect(path.cites).toEqual({ 'dec-switch-battery-voltaro': 1 })
  })

  it('follows a two-hop reason through the note between', () => {
    const path = answerPath(index, [
      hit('prj-ridgeline-emtb'),
      hit('per-maya-okafor', [
        { kind: 'link', from: 'prj-ridgeline-emtb', relation: 'reports_to', direction: 'out', hops: 2 },
      ]),
    ])
    expect(path.edges).toEqual([
      { from: 'prj-ridgeline-emtb', to: 'per-tomas-lindqvist', relation: 'owner' },
      { from: 'per-tomas-lindqvist', to: 'per-maya-okafor', relation: 'reports_to' },
    ])
  })

  it('numbers cited notes by their rank among the sources', () => {
    expect(citationNumbers([hit('a'), hit('b'), hit('c')], ['c', 'a', 'x'])).toEqual({ c: 3, a: 1 })
  })
})

describe('the graph layout', () => {
  const graph = createVault(index).graph()

  it('is the same on every visit, and gathers every linked note around a project', () => {
    const a = layout(graph, '2d')
    const b = layout({ ...graph }, '2d')
    expect(b.pos).toEqual(a.pos)
    expect(a.pos.every((p) => p[2] === 0)).toBe(true)
    const seeds = new Set(a.seeds.map((i) => a.nodes[i]!.type))
    expect([...seeds]).toEqual(['project'])
    expect(a.community.filter((c) => c >= 0).length).toBeGreaterThan(graph.nodes.length * 0.9)
  })

  it('shows a selection at 1 hop, half at 2, and frames no wider than the whole graph', () => {
    const L = layout(graph, '3d')
    const s = sceneState(L, { mode: '3d', focus: 'dec-keep-ampcore' }, false)
    const me = L.index.get('dec-keep-ampcore')!
    expect(s.alpha(me)).toBe(1)
    expect(s.ring(me)).toBe('focus')
    expect(s.clusterNames).toEqual([])
    const far = L.nodes.findIndex((_, i) => !s.hop.has(i))
    expect(s.alpha(far)).toBe(0.12)
    expect(frame(L, [0, L.nodes.length - 1], '3d').zoom).toBeGreaterThanOrEqual(1)
    const yaw = bestYaw(L, [0, 1, 2], 0.35, 0.6)
    expect(yaw).toBeGreaterThanOrEqual(0)
    expect(bestYaw(L, [0], 0.35, 0.6)).toBe(0.6)
  })
})

describe('formats', () => {
  it('writes numbers the way the screens show them', () => {
    expect(pct(0.909)).toBe('91%')
    expect(pct(undefined)).toBe('—')
    expect(pp(0.909, 0.7778)).toBe('+13 pp')
    expect(pp(0.9, 0.92)).toBe('−2 pp')
    expect(pp(0.9, 0.9)).toBe('±0 pp')
    expect(signed(13.13)).toBe('+13.1')
    expect(signed(-2, 0)).toBe('−2')
    expect(mb(34_014_426, 0)).toBe('34')
    expect(shortDate('2026-10-02')).toBe('2 Oct 2026')
    expect(shortDate('2026-10-02', false)).toBe('2 Oct')
    expect(duration(314)).toBe('314 ms')
    expect(duration(1492)).toBe('1.5 s')
  })

  it('cuts an excerpt around the first matched word', () => {
    const text = `${'word '.repeat(80)}battery ${'tail '.repeat(60)}`
    const e = excerpt(text, ['battery'])
    expect(e.startsWith('…')).toBe(true)
    expect(e).toContain('battery')
    expect(e.length).toBeLessThanOrEqual(245)
    expect(excerpt('short text', ['x'])).toBe('short text')
  })
})

describe('the index download', () => {
  it('reports the bytes of index.bin as they arrive, and nothing for the other files', async () => {
    const seen: number[] = []
    const base = (async (_url: string) =>
      new Response(new Uint8Array(1000), {
        headers: { 'content-length': '1000' },
      })) as unknown as typeof fetch
    const f = progressFetch(base, (d) => seen.push(d.loaded))
    await (await f('/data/latest.json')).arrayBuffer()
    expect(seen).toEqual([])
    const res = await f('/data/index.bin')
    expect((await res.arrayBuffer()).byteLength).toBe(1000)
    expect(seen.at(-1)).toBe(1000)
  })
})
