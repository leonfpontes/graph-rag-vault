import type { RecordedAnswer } from '@graph-rag/client'
import { decodeIndex } from '@graph-rag/search'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { nestRows, pathTree } from './Ask'
import { axe } from '../test/axe'
import { evalFile, INDEX_BYTES } from '../test/demo'
import { asPhone, renderAt } from '../test/render'

const index = decodeIndex(INDEX_BYTES)
const answers = JSON.parse(evalFile('answers.json')) as RecordedAnswer[]
const recorded = (id: string, variant = 'hybrid') =>
  answers.find((a) => a.questionId === id && a.variant === variant && a.round === 1)!

// The embedding worker does not run in jsdom: the page's side of it is replaced, per test.
const model = vi.hoisted(() => ({
  embed:
    vi.fn<
      (
        q: string,
        o: { onProgress?: (p: { loaded: number; total?: number }) => void; signal?: AbortSignal },
      ) => Promise<Float32Array>
    >(),
}))
vi.mock('../ask/embedder', () => ({ embedQuery: model.embed, modelReady: () => false }))

beforeEach(() => {
  model.embed.mockReset()
})

describe('Ask', () => {
  it('says how many recorded questions answer at once, scored and for tuning, from questions.json', async () => {
    renderAt('/ask')
    expect(
      await screen.findByText(
        /^The 50 recorded questions \(40 scored, 10 for tuning\) answer at once from the recorded run\./,
      ),
    ).toBeTruthy()
    expect(screen.getByText('· 50 answer at once (40 scored, 10 for tuning)')).toBeTruthy()
  })

  it('starts with recorded questions by kind, open, and the graph waiting for a path', async () => {
    const { container } = renderAt('/ask')
    expect(screen.getByRole('heading', { level: 1, name: 'Ask the vault' })).toBeTruthy()
    const start = await screen.findByRole('button', { name: /Recorded questions/ })
    expect(start.getAttribute('aria-expanded')).toBe('true')
    const links = screen.getAllByRole('link', { name: /(Multi-hop|Fact|Temporal|No answer)$/ })
    expect(links).toHaveLength(5)
    expect(links[0]!.getAttribute('href')).toMatch(/^\/ask\?q=q-0\d\d$/)
    expect(screen.getByText('The path of each answer lights up here.')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Hybrid' }).getAttribute('aria-checked')).toBe('true')
    expect(await axe(container)).toEqual([])
  })

  it('answers a recorded question at once: every sentence cites its sources by their rank', async () => {
    const { container } = renderAt('/ask?q=q-022')
    const a = recorded('q-022')
    expect(await screen.findByText(a.sentences[0]!.text, { exact: false })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Your question' }) as HTMLTextAreaElement).value).toBe(
      index.queries.find((q) => q.id === 'q-022')!.question,
    )
    expect(screen.getByText('q-022 · recorded answer')).toBeTruthy()
    // Each cited note's number is its rank among the sources the answer read (passageNotes).
    for (const s of a.sentences)
      for (const c of s.citations) {
        const n = a.passageNotes.indexOf(c.noteId) + 1
        expect(screen.getAllByRole('link', { name: new RegExp(`^Source ${n}: `) }).length).toBeGreaterThan(0)
        expect(document.getElementById(`src-${n}`)?.textContent).toContain(`[${n}]`)
      }
    expect(screen.getAllByText('not cited').length).toBe(
      5 - new Set(a.sentences.flatMap((s) => s.citations.map((c) => c.noteId))).size,
    )
    expect(await axe(container)).toEqual([])
  })

  it('opens the exact passage behind a citation on focus, with the quote marked', async () => {
    renderAt('/ask?q=q-022')
    const chip = (await screen.findAllByRole('link', { name: /^Source 1: / }))[0]!
    act(() => chip.focus())
    const quote = recorded('q-022').sentences[0]!.citations[0]!.quote
    const mark = await screen.findByText(quote, { selector: 'mark' })
    expect(mark.closest('blockquote')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the note' }).getAttribute('href')).toBe(
      '/notes/dec-switch-battery-voltaro',
    )
  })

  it('lights the path the answer walked, with the type of each link, and writes it as text', async () => {
    renderAt('/ask?q=q-022')
    const text = await screen.findByRole('region', { name: 'The path, as text' })
    expect(within(text).getByText('supersedes →')).toBeTruthy()
    expect(within(text).getAllByText('decided_in →')).toHaveLength(2)
    expect(within(text).getByRole('link', { name: 'Keep Ampcore as battery supplier' })).toBeTruthy()
    expect(screen.getByText('Links the answer walked')).toBeTruthy()
  })

  it('shows what another variant misses, and links back to hybrid', async () => {
    renderAt('/ask?q=q-022&variant=vector')
    expect(await screen.findByText(/With vectors only, 2 expected notes are not in the top 5/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Compare with hybrid' }).getAttribute('href')).toBe(
      '/ask?q=q-022',
    )
    expect(screen.getByRole('radio', { name: 'Vectors' }).getAttribute('aria-checked')).toBe('true')
  })

  it("says “I don't know” on a question with no answer in the vault, and that it is the expected reply", async () => {
    renderAt('/ask?q=q-044')
    expect(await screen.findByText("I don't know.")).toBeTruthy()
    expect(screen.getByText(/the vault has no answer, so “I don't know” is the correct reply/)).toBeTruthy()
    expect(screen.getByText('No path: nothing in the vault answers this.')).toBeTruthy()
    expect(screen.queryByText('not cited')).toBeNull()
  })

  it('embeds a new question in the browser, shows the download, then the search and the way to an answer', async () => {
    let release!: (v: Float32Array) => void
    model.embed.mockImplementation((_q, { onProgress } = {}) => {
      onProgress?.({ loaded: 11_000_000, total: 34_000_000 })
      return new Promise((resolve) => (release = resolve))
    })
    const { user, container } = renderAt('/ask')
    const box = screen.getByRole('textbox', { name: 'Your question' })
    await user.type(box, 'Which dealers asked for a cargo bike?{Enter}')
    expect(await screen.findByText('Loading the search model')).toBeTruthy()
    // Only the step is a live region; the byte count is outside it (the progress bar has the value).
    expect(screen.getByRole('status').textContent).toBe('Loading the search model')
    expect(screen.getByText('11 of 34 MB')).toBeTruthy()
    expect(
      screen.getByRole('progressbar', { name: 'Search model download' }).getAttribute('aria-valuenow'),
    ).toBe('32')
    expect(model.embed).toHaveBeenCalledWith('Which dealers asked for a cargo bike?', expect.anything())
    await act(async () => release(index.queries[0]!.vector))
    expect(await screen.findByText('The search ran; the answer needs your key')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^Sources/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Generated answers run on your machine' })).toBeTruthy()
    expect(screen.getByText('Notes the search found')).toBeTruthy()
    expect(await axe(container)).toEqual([])
  })

  it('cancels the model download and keeps the question in the box', async () => {
    model.embed.mockImplementation(
      (_q, { signal } = {}) =>
        new Promise((_, reject) =>
          signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))),
        ),
    )
    const { user } = renderAt('/ask?q=Who%20paints%20the%20frames%3F')
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(window.location.search).toBe('?draft=Who+paints+the+frames%3F'))
    expect((screen.getByRole('textbox', { name: 'Your question' }) as HTMLTextAreaElement).value).toBe(
      'Who paints the frames?',
    )
  })

  it('says the model did not load, and tries again', async () => {
    model.embed.mockImplementationOnce(async (_q, { onProgress } = {}) => {
      onProgress?.({ loaded: 11_000_000, total: 34_000_000 })
      throw new Error('network error')
    })
    model.embed.mockResolvedValueOnce(index.queries[1]!.vector)
    const { user } = renderAt('/ask?q=Who%20paints%20the%20frames%3F')
    expect(await screen.findByText('The search model did not load')).toBeTruthy()
    expect(screen.getByText(/The download stopped at 11 of 34 MB \(network error\)/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('The search ran; the answer needs your key')).toBeTruthy()
  })

  it('in local mode, a new question gets a written answer from the local server', async () => {
    const a = recorded('q-011')
    renderAt('/ask?q=Where%20is%20the%20paint%20line%3F', {
      mode: 'local',
      answer: () =>
        new Response(
          JSON.stringify({
            question: 'Where is the paint line?',
            variant: 'hybrid',
            hits: a.passageNotes.map((noteId, i) => ({ noteId, score: 1 / (i + 1), reasons: [] })),
            answer: {
              ...a,
              status: 'answered',
              model: 'claude-haiku-5-5',
              costMicros: 400,
              usage: {},
              calls: 1,
              promptVersion: 'x',
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    })
    expect(await screen.findByText(a.sentences[0]!.text, { exact: false })).toBeTruthy()
    expect(screen.getByText('your question · answered on this machine')).toBeTruthy()
    expect(model.embed).not.toHaveBeenCalled()
  })

  it("shows the local server's error as it is, with a way to try again", async () => {
    renderAt('/ask?q=Where%20is%20the%20paint%20line%3F', {
      mode: 'local',
      answer: () =>
        new Response(JSON.stringify({ error: 'One answer at a time.' }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
    })
    expect(await screen.findByText('One answer at a time.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('refuses a question over the limit before asking', async () => {
    const { user } = renderAt('/ask')
    const box = screen.getByRole('textbox', { name: 'Your question' })
    fireEvent.change(box, { target: { value: 'x'.repeat(501) } })
    expect(screen.getByText(/Keep the question under 500 characters/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('radio', { name: 'Graph' }))
    expect(window.location.search).toBe('?variant=graph')
  })

  it('on phones, a citation opens a bottom sheet with Close', async () => {
    asPhone()
    const { user } = renderAt('/ask?q=q-022')
    const chip = (await screen.findAllByRole('button', { name: /^Source 1: / }))[0]!
    await user.click(chip)
    const sheet = await screen.findByRole('dialog', { name: 'Source 1' })
    await user.click(within(sheet).getByRole('button', { name: 'Close source preview' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('nestRows', () => {
  it('puts each link inside the note it starts from, with two branches', () => {
    const tree = nestRows(
      pathTree([
        { from: 'hub', to: 'b', relation: 'owner' },
        { from: 'hub', to: 'c', relation: 'supersedes' },
        { from: 'c', to: 'd', relation: 'decided_in' },
        { from: 'b', to: 'e', relation: 'reports_to' },
      ]),
    )
    const shape = (n: ReturnType<typeof nestRows>[number]): unknown => [n.row.note, n.children.map(shape)]
    expect(tree.map(shape)).toEqual([
      [
        'hub',
        [
          ['b', [['e', []]]],
          ['c', [['d', []]]],
        ],
      ],
    ])
  })

  it('renders the tree as nested lists for screen readers', async () => {
    renderAt('/ask?q=q-022')
    const region = await screen.findByRole('region', { name: 'The path, as text' })
    const top = within(region).getAllByRole('list')[0]!
    const nested = top.querySelector('li > ol')
    expect(nested).toBeTruthy()
    expect(nested!.closest('li')!.querySelector('a')!.textContent).toBeTruthy()
  })
})

describe('pathTree', () => {
  it('writes the path once, from the note most links touch, and keeps every link', () => {
    const rows = pathTree([
      { from: 'a', to: 'b', relation: 'decided_in' },
      { from: 'a', to: 'c', relation: 'supersedes' },
      { from: 'c', to: 'd', relation: 'decided_in' },
      { from: 'e', to: 'd', relation: 'attendees' },
      { from: 'x', to: 'y', relation: 'owner' },
    ])
    expect(rows.map((r) => [r.note, r.depth, r.relation, r.outward])).toEqual([
      ['a', 0, undefined, undefined],
      ['b', 1, 'decided_in', true],
      ['c', 1, 'supersedes', true],
      ['d', 2, 'decided_in', true],
      ['e', 3, 'attendees', false],
      ['x', 0, undefined, undefined],
      ['y', 1, 'owner', true],
    ])
  })
})
