// The share images can't fall behind their sources: docs/share.values.json (written with the images
// by pnpm share-images) must equal what the scoreboard and the recorded answer say today. A failure
// means: run pnpm share-images and commit the images with the values.
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { loadDemo, type Scoreboard } from '@graph-rag/client'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { REPO_ROOT } from '../../build-plugins.ts'
import { ShareArt } from '../share/ShareArt'
import { HEADLINE } from '../test/approved'
import { demoOptions, evalFile } from '../test/demo'
import { renderAt } from '../test/render'
import { headline } from './headline'
import { exampleCase, featured, layoutPath, pathOrder, shareValues, shortTitle, type Featured } from './share'

afterEach(cleanup)

const read = (file: string) => readFileSync(path.join(REPO_ROOT, file))
/** Width and height of a PNG: big-endian integers at bytes 16 and 20. */
const pngSize = (bytes: Buffer) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })

const sb = JSON.parse(evalFile('latest.json')) as Scoreboard
const demo = await loadDemo(demoOptions())
const f = (await featured(demo))!

/** Words that claim hybrid search came out ahead. */
const WIN_WORDS = /\b(beats?|wins?|winner|better|best|outperforms?|ahead|leads?|improves?)\b/i

describe('the share images', () => {
  it('show the numbers of the scoreboard and the recorded answer (pnpm share-images when this fails)', () => {
    const values = JSON.parse(read('docs/share.values.json').toString('utf8')) as unknown
    expect(values).toEqual(JSON.parse(JSON.stringify(shareValues(sb, f))))
  })

  it('have the sizes GitHub, Open Graph and the README expect (the cover at 2×)', () => {
    expect(pngSize(read('docs/social-preview.png'))).toEqual({ width: 1280, height: 640 })
    expect(pngSize(read('apps/web/public/og.png'))).toEqual({ width: 1200, height: 630 })
    expect(pngSize(read('docs/cover-light.png'))).toEqual({ width: 1660, height: 830 })
    expect(pngSize(read('docs/cover-dark.png'))).toEqual({ width: 1660, height: 830 })
  })

  it('end with the scoreboard sentence of latest.json, from the same function as the page', () => {
    const h = headline(sb)!
    expect(h).toMatchObject({ short: HEADLINE.short, subShort: HEADLINE.subShort })
    render(<ShareArt featured={f} sentence={h} width={1280} height={640} example={false} />)
    const art = screen.getByRole('img')
    expect(art.querySelector('[data-sentence]')!.textContent).toBe(`${h.short}${h.subShort}`)
    expect(art.getAttribute('aria-label')).toContain(h.short)
    expect(art.textContent).not.toMatch(/Example numbers/)
  })

  it('suggest a win only when hybrid search wins, whatever the result', () => {
    for (const outcome of ['win', 'tie', 'loss'] as const) {
      const h = headline(exampleCase(sb, outcome))!
      expect(h.outcome).toBe(outcome)
      const { unmount } = render(<ShareArt featured={f} sentence={h} width={1280} height={640} example />)
      const text = screen.getByRole('img').textContent!
      expect(text).toMatch(/Example numbers/) // example cases always carry the tag
      if (outcome !== 'win') expect(text).not.toMatch(WIN_WORDS)
      if (outcome === 'loss') expect(h.short).toMatch(/^Graph only: recall@5 \d+%\. Hybrid search: \d+%\.$/)
      if (outcome === 'tie') expect(h.short).toMatch(/ tie: /)
      if (outcome === 'win') expect(h.short).toMatch(/^Hybrid search: recall@5 \d+%\. Vectors only: \d+%\.$/)
      unmount()
    }
  })

  it('are drawn by /share?record, which exposes the values it drew; /share alone is the 404', async () => {
    renderAt('/share?record')
    await waitFor(() => expect(document.querySelectorAll('[data-art]')).toHaveLength(4), { timeout: 10_000 })
    await waitFor(() => expect(window.__shareValues?.question.id).toBe(f.question.id))
    cleanup()
    renderAt('/share')
    expect(screen.getByRole('heading', { level: 1, name: 'No page at this address' })).toBeTruthy()
  })
})

describe('the featured question', () => {
  it('is a multi-hop test question whose hybrid answer the judge supported in every sentence', () => {
    expect(f.question).toMatchObject({ kind: 'multi-hop', split: 'test' })
    expect(f.answer.status).toBe('answered')
    expect(f.answer.removed).toEqual([])
    expect(f.answer.verdicts.map((v) => v.verdict)).toEqual(f.sentences.map(() => 'supported'))
  })

  it('has the longest lit path among such questions, and each cited note on it carries its number', async () => {
    const lengths: number[] = []
    for (const q of demo.questions.filter((x) => x.kind === 'multi-hop' && x.split === 'test')) {
      const other = await featured(demo, q.id)
      if (!other || other.answer.verdicts.some((v) => v.verdict !== 'supported')) continue
      lengths.push(other.edges.length)
    }
    expect(f.edges.length).toBe(Math.max(...lengths))
    for (const n of f.nodes) expect(n.cite).toBe(f.cites[n.id])
  })
})

describe('the path drawing', () => {
  const chain: Pick<Featured, 'nodes' | 'edges'> = f
  it('walks the path from one end, and lays a chain out left to right in a zigzag', () => {
    expect(pathOrder(chain.edges)).toEqual(chain.nodes.map((n) => n.id))
    const placed = layoutPath(chain.nodes, chain.edges)
    for (let i = 1; i < placed.length; i++) {
      expect(placed[i]!.x).toBeGreaterThan(placed[i - 1]!.x)
      expect(placed[i]!.y).not.toBe(placed[i - 1]!.y)
    }
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(600)
    }
  })

  it('puts the note most links touch in the middle when the path is not a chain', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'person', title: id, short: id }))
    const edges = ['b', 'c', 'd'].map((to) => ({ from: 'a', to, relation: 'owner' }))
    expect(layoutPath(nodes, edges)[0]).toMatchObject({ id: 'a', x: 300, y: 190 })
  })

  it('shortens titles at " · " or a word, never mid-word', () => {
    expect(shortTitle('Supply review · 2 Oct 2026')).toBe('Supply review')
    expect(shortTitle('Keep Ampcore as battery supplier')).toBe('Keep Ampcore as…')
    expect(shortTitle('Velo Lund')).toBe('Velo Lund')
  })
})
