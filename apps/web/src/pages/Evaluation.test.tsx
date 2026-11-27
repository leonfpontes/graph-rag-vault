import type { Scoreboard } from '@graph-rag/client'
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { pct, pp } from '../lib/format'
import { headline, kindLine } from '../lib/headline'
import { HEADLINE, JUDGE_LINES, JUDGE_NEVER } from '../test/approved'
import { axe } from '../test/axe'
import { evalFile, latest } from '../test/demo'
import { demoOptions } from '../test/demo'
import { renderAt } from '../test/render'
import { questionResults } from './Evaluation'
import { loadDemo } from '@graph-rag/client'

const sb = JSON.parse(evalFile('latest.json')) as Scoreboard

describe('Evaluation', () => {
  it('ranks the questions with the same search the scoreboard measured: its mean is recall@5', async () => {
    const demo = await loadDemo(demoOptions())
    const rows = questionResults(demo).filter((r) => r.expected.length > 0)
    for (const v of ['vector', 'graph', 'hybrid'] as const) {
      const mean = rows.reduce((t, r) => t + r.result[v].found / r.expected.length, 0) / rows.length
      expect(mean, v).toBeCloseTo(sb.retrieval[v].all!.recall5!, 6)
    }
  })

  it('writes the sentence from the verdict in latest.json, with the second line about vectors', async () => {
    const { container } = renderAt('/evaluation')
    const h = headline(sb)!
    expect(await screen.findByText(h.long)).toBeTruthy()
    expect(screen.getByText(h.sub)).toBeTruthy()
    // With this scoreboard the sentence is the approved one.
    expect(h.long).toBe(HEADLINE.long)
    expect(h.sub).toBe(HEADLINE.sub)
    expect(screen.getByText(kindLine(sb).text)).toBeTruthy()
    expect(screen.getByText(/held-out questions, /).textContent).toMatch(
      /^40 held-out questions, 3 search variants, answers by Claude Haiku 5\.5\. The search weights were tuned on 10 other questions/,
    )
    expect(await axe(container)).toEqual([])
  })

  it('marks the best value of each row, with the hybrid − vectors column', async () => {
    renderAt('/evaluation')
    const table = await screen.findByRole('region', { name: 'Scoreboard table' })
    const recall = within(table).getByText('Recall@5').closest('tr')!
    const cells = within(recall)
      .getAllByRole('cell')
      .map((c) => c.textContent)
    const r = (v: 'vector' | 'graph' | 'hybrid') => sb.retrieval[v].all!.recall5!
    const best = Math.max(r('vector'), r('graph'), r('hybrid'))
    const cell = (v: 'vector' | 'graph' | 'hybrid') => `${pct(r(v))}${r(v) === best ? ' ✓ best' : ''}`
    expect(cells.slice(1)).toEqual([
      cell('vector'),
      cell('graph'),
      cell('hybrid'),
      pp(r('hybrid'), r('vector')),
    ])
    const mrr = within(table).getByText('MRR').closest('tr')!
    expect(within(mrr).getAllByRole('cell')[3]!.textContent).toBe(
      `${sb.retrieval.hybrid.all!.mrr!.toFixed(2)} ✓ best`,
    )
  })

  it('gives the ✓ to every variant whose shown value ties with the best', async () => {
    renderAt('/evaluation')
    const table = await screen.findByRole('region', { name: 'Scoreboard table' })
    for (const row of within(table).getAllByRole('row').slice(1)) {
      const cells = within(row).getAllByRole('cell').slice(1, 4)
      const best = cells.filter((c) => c.textContent?.endsWith('✓ best'))
      expect(best.length, row.textContent!).toBeGreaterThan(0)
      // Cells that read the same (the mean, before its ±) all carry it, or none does.
      const head = (c: HTMLElement) => c.textContent!.replace(' ✓ best', '').split(' ± ')[0]
      const bestHead = head(best[0]!)
      for (const c of cells)
        expect(c.textContent!.endsWith('✓ best'), row.textContent!).toBe(head(c) === bestHead)
    }
    const precision = within(table).getByText('Citation precision').closest('tr')!
    const shown = within(precision)
      .getAllByRole('cell')
      .slice(1, 4)
      .map((c) => c.textContent!.split(' ± ')[0])
    if (new Set(shown).size === 1)
      expect(within(precision).getAllByText('best', { exact: false })).toHaveLength(3)
  })

  it("says how the judge was checked, in the approved words, with the two judges' disagreements", async () => {
    const { user } = renderAt('/evaluation')
    const card = (await screen.findByText('Faithfulness judge')).closest('section')!
    for (const line of JUDGE_LINES) expect(within(card).getByText(line)).toBeTruthy()
    for (const never of JUDGE_NEVER) expect(card.textContent).not.toMatch(never)
    // Both parts of the person's check, with the same weight.
    const hu = sb.human!
    const blind = hu.blindPart!
    const reviewed = `${Math.round(hu.observed * hu.items) - blind.agreed} of ${hu.items - blind.items}`
    expect(within(card).getByText(`${reviewed} · ${blind.agreed} of ${blind.items} blind`)).toBeTruthy()
    await user.click(
      within(card).getByRole('button', { name: 'See the 5 sentences where the two judges disagree' }),
    )
    expect(within(card).getAllByText(/^Main judge:/)).toHaveLength(5)
    expect(within(card).getByText(`“${sb.secondJudge!.disagreements[0]!.sentence}”`)).toBeTruthy()
  })

  it('lists the test questions with the rank of the first expected note, and filters them', async () => {
    const { user } = renderAt('/evaluation')
    const all = await screen.findByRole('region', { name: 'Questions: All' })
    expect(within(all).getAllByRole('row')).toHaveLength(11)
    await user.click(screen.getByRole('button', { name: 'Show all 40 questions' }))
    expect(within(screen.getByRole('region', { name: 'Questions: All' })).getAllByRole('row')).toHaveLength(
      41,
    )
    await user.click(screen.getByRole('tab', { name: /Hybrid wins/ }))
    const wins = screen.getByRole('region', { name: 'Questions: Hybrid wins' })
    expect(within(wins).getAllByRole('row').length).toBeGreaterThan(1)
    expect(screen.getByRole('tab', { name: /Hybrid wins/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('shows the notes of the run and how to run it, with the budget from the file', async () => {
    renderAt('/evaluation')
    for (const note of sb.notes) expect(await screen.findByText(note)).toBeTruthy()
    expect(screen.getByText(`pnpm eval --rounds ${sb.rounds} --budget ${sb.cost.capUsd}`)).toBeTruthy()
  })

  it('says there are no results yet when the scoreboard is a rehearsal', async () => {
    const rehearsal = { ...latest(), rehearsal: true }
    renderAt('/evaluation', { files: { 'latest.json': JSON.stringify(rehearsal) } })
    expect(await screen.findByRole('heading', { name: 'No results yet' })).toBeTruthy()
    expect(screen.getByRole('note').textContent).toMatch(/Example numbers until pnpm eval runs/)
  })
})
