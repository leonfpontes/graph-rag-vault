import { loadDemo, QUICKSTART_COMMANDS, type Scoreboard } from '@graph-rag/client'
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { headline, kindLine } from '../lib/headline'
import { FEATURED_QUESTION } from '../lib/share'
import { HEADLINE } from '../test/approved'
import { axe } from '../test/axe'
import { demoOptions, evalFile, latest } from '../test/demo'
import { asPhone, renderAt } from '../test/render'
import { frontmatterLines, judgeClause, SAMPLE_NOTE } from './HowItWorks'

const sb = JSON.parse(evalFile('latest.json')) as Scoreboard

describe('How it works (the landing page)', () => {
  it('says the scoreboard sentence as its title, from latest.json, with what the graph adds to vectors', async () => {
    const { container } = renderAt('/')
    const h = headline(sb)!
    expect(await screen.findByRole('heading', { level: 1, name: h.short })).toBeTruthy()
    expect(h.short).toBe(HEADLINE.short)
    expect(screen.getByText(h.sub)).toBeTruthy()
    expect(screen.queryByText(/Example numbers/)).toBeNull()
    expect(await axe(container)).toEqual([])
  })

  it('shows the recorded answer of the featured question, each citation leading to its source in Ask', async () => {
    renderAt('/')
    const hero = await screen.findByRole('figure', {
      name: 'A recorded answer from the demo, with its sources and the path in the graph',
    })
    const q = within(hero).getByRole('link', { name: /Velo Lund\?$/ })
    expect(q.getAttribute('href')).toBe(`/ask?q=${FEATURED_QUESTION}`)
    const cites = within(hero).getAllByRole('link', { name: /^Source \d: / })
    expect(cites.length).toBeGreaterThan(0)
    for (const c of cites)
      expect(c.getAttribute('href')).toMatch(new RegExp(`^/ask\\?q=${FEATURED_QUESTION}#src-\\d$`))
    // The path is also written out for screen readers.
    expect(within(hero).getByText(/The path, as text: .+ reports_to .+\./)).toBeTruthy()
  })

  it('reads every number from the demo files: notes, questions, splits, the model and the judge check', async () => {
    renderAt('/')
    const demo = await loadDemo(demoOptions())
    const tuned = demo.questions.filter((q) => q.split !== 'test').length
    expect(
      await screen.findByText(
        `${demo.questions.length} questions with the notes that should answer them, in 4 kinds: fact, multi-hop, temporal and no answer. ${tuned} of them tuned the weights; the scoreboard uses the other ${sb.questions.total}, in 3 variants: vectors only, graph only and hybrid.`,
      ),
    ).toBeTruthy()
    expect(screen.getByText(kindLine(sb).text)).toBeTruthy()
    expect(screen.getByText(new RegExp(judgeClause(sb).replace(/[.()?]/g, '\\$&')))).toBeTruthy()
    expect(judgeClause(sb)).toBe(
      'the person agreed on 18 of 18 sentences reviewed not blind and on 2 of 3 labelled blind; the second judge agreed on 76%.',
    )
    expect(screen.getByText('The model, Claude Haiku 5.5, answers only from the top 5 chunks.')).toBeTruthy()
    expect(
      screen.getByText(
        `Three commands, no key. The demo opens the Tarnwick Cycles vault, ${demo.index.notes.length} fictional notes.`,
      ),
    ).toBeTruthy()
    expect(
      screen.getAllByRole('img', { name: /^Recall@5 on (fact|multi-hop|temporal) questions/ }),
    ).toHaveLength(3)
  })

  it('shows a real note as the index read it, and the links it extracts', async () => {
    renderAt('/')
    const demo = await loadDemo(demoOptions())
    const lines = frontmatterLines(demo, SAMPLE_NOTE)
    expect(lines).toContain('owner: "[[per-priya-raman]]"')
    expect(lines).toContain('decided_in: "[[mtg-2026-10-02-supply-review]]"')
    const table = await screen.findByRole('table', { name: 'Links the ingestion extracts from this note' })
    const out = demo.note(SAMPLE_NOTE)!.links.filter((l) => l.direction === 'out')
    expect(within(table).getAllByRole('row')).toHaveLength(out.length + 1)
  })

  it('gives the quickstart as three commands with no key, the same as the README', async () => {
    renderAt('/')
    const quick = await screen.findByRole('region', { name: 'Quickstart' })
    expect(QUICKSTART_COMMANDS).toHaveLength(3)
    for (const c of QUICKSTART_COMMANDS) expect(within(quick).getByText(c)).toBeTruthy()
  })

  it('marks example numbers while the scoreboard is a rehearsal', async () => {
    renderAt('/', { files: { 'latest.json': JSON.stringify({ ...latest(), rehearsal: true }) } })
    expect(await screen.findByText('Example numbers until the evaluation runs')).toBeTruthy()
  })

  it('has the footer of Atlas and Crew', async () => {
    renderAt('/')
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText('Built by Leonardo Pontes')).toBeTruthy()
    expect(within(footer).getByRole('link', { name: /LinkedIn/ })).toBeTruthy()
    expect(
      within(footer).getByText(/Tarnwick Cycles, its people and its customers are fictional\./),
    ).toBeTruthy()
  })

  it('works on a phone, with no accessibility violations', async () => {
    asPhone()
    const { container } = renderAt('/')
    await screen.findByRole('figure', { name: /A recorded answer/ })
    expect(screen.queryByRole('navigation', { name: 'Page' })).toBeTruthy()
    expect(await axe(container)).toEqual([])
  })
})
