import type { Scoreboard } from '@graph-rag/client'
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { headline, kindLine } from '../lib/headline'
import { HEADLINE, JUDGE_LINES, JUDGE_NEVER } from '../test/approved'
import { axe } from '../test/axe'
import { evalFile, latest } from '../test/demo'
import { renderAt } from '../test/render'

const sb = JSON.parse(evalFile('latest.json')) as Scoreboard

describe('Evaluation', () => {
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
    expect(cells.slice(1)).toEqual(['78%', '93% ✓ best', '91%', '+13 pp'])
    const mrr = within(table).getByText('MRR').closest('tr')!
    expect(within(mrr).getAllByRole('cell')[3]!.textContent).toBe(
      `${sb.retrieval.hybrid.all!.mrr!.toFixed(2)} ✓ best`,
    )
  })

  it("says how the judge was checked, in the approved words, with the two judges' disagreements", async () => {
    const { user } = renderAt('/evaluation')
    const card = (await screen.findByText('Faithfulness judge')).closest('section')!
    for (const line of JUDGE_LINES) expect(within(card).getByText(line)).toBeTruthy()
    for (const never of JUDGE_NEVER) expect(card.textContent).not.toMatch(never)
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
