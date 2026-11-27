import { decodeIndex } from '@graph-rag/search'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { axe } from '../test/axe'
import { INDEX_BYTES } from '../test/demo'
import { asPhone, renderAt } from '../test/render'

const index = decodeIndex(INDEX_BYTES)
const count = (type: string) => index.notes.filter((n) => n.type === type).length

describe('Explore', () => {
  it('counts the notes and links of the index, filters by type and link, and has no axe violations', async () => {
    const { container, user } = renderAt('/explore')
    expect(await screen.findByText(`${index.notes.length} notes · ${index.links.length} links`)).toBeTruthy()
    const person = screen.getByRole('checkbox', { name: new RegExp(`^Person\\s*${count('person')}$`) })
    expect(person.getAttribute('aria-checked')).toBe('true')
    await user.click(person)
    expect(person.getAttribute('aria-checked')).toBe('false')
    const owner = index.links.filter((l) => l.relation === 'owner').length
    expect(screen.getByRole('checkbox', { name: new RegExp(`^owner\\s*${owner}$`) })).toBeTruthy()
    expect(screen.getByRole('img', { name: /Graph of \d+ notes in \d+ constellations/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '3D' }).getAttribute('aria-selected')).toBe('true')
    expect(await axe(container)).toEqual([])
  })

  it('tells the story of the graph before a selection: the biggest constellations', async () => {
    renderAt('/explore')
    const projects = count('project')
    expect(
      await screen.findByRole('heading', { name: `${index.notes.length} notes, ${projects} projects` }),
    ).toBeTruthy()
    const links = screen.getAllByRole('link', { name: /^Show the .+ constellation$/ })
    expect(links).toHaveLength(6)
    expect(links[0]!.getAttribute('href')).toMatch(/^\/explore\?cluster=prj-/)
  })

  it('previews the selected note: superseded, its neighbors, and the ways out', async () => {
    renderAt('/explore?focus=dec-keep-ampcore')
    const preview = (await screen.findAllByRole('complementary', { name: 'Selected note' }))[0]!
    expect(within(preview).getByRole('heading', { name: 'Keep Ampcore as battery supplier' })).toBeTruthy()
    expect(within(preview).getByText('Superseded')).toBeTruthy()
    // The file path breaks only after a "/".
    const file = within(preview).getByText(
      (_, el) => el?.tagName === 'P' && el.textContent === 'decisions/dec-keep-ampcore.md',
    )
    expect(file.querySelectorAll('wbr')).toHaveLength(1)
    expect(file.className).not.toMatch(/break-all/)
    expect(
      within(preview).getByRole('link', { name: 'Switch Ridgeline battery cells to Voltaro' }),
    ).toBeTruthy()
    expect(within(preview).getByRole('link', { name: 'Open note' }).getAttribute('href')).toBe(
      '/notes/dec-keep-ampcore',
    )
    expect(
      within(preview)
        .getByRole('link', { name: /Ask about this note/ })
        .getAttribute('href'),
    ).toMatch(/^\/ask\?draft=/)
    expect(screen.getByRole('img', { name: /Selected: Keep Ampcore as battery supplier\./ })).toBeTruthy()
  })

  it('frames a constellation from the address', async () => {
    renderAt('/explore?cluster=prj-ridgeline-emtb')
    expect(await screen.findByText('Constellation')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open project note' }).getAttribute('href')).toBe(
      '/notes/prj-ridgeline-emtb',
    )
  })

  it('finds a note by an alias from the keyboard, and selects it', async () => {
    const { user } = renderAt('/explore')
    const box = await screen.findByRole('combobox', { name: 'Find a note' })
    await user.click(box)
    await user.keyboard('RL-1')
    expect(screen.getByRole('option', { name: /Ridgeline e-MTB/ })).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(window.location.search).toBe('?focus=prj-ridgeline-emtb')
  })

  it('says when nothing matches, and clears the search and the filters', async () => {
    const { user } = renderAt('/explore')
    await user.type(await screen.findByRole('combobox', { name: 'Find a note' }), 'warranty japan')
    expect(screen.getByRole('heading', { name: 'No note matches “warranty japan”' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Clear search and filters' }))
    expect((screen.getByRole('combobox', { name: 'Find a note' }) as HTMLInputElement).value).toBe('')
  })

  it('lists the constellations for keyboards and screen readers, with a way back to the graph', async () => {
    const { user, container } = renderAt('/explore?view=list')
    const list = await screen.findByRole('region', { name: 'Notes by constellation' })
    const triggers = within(list).getAllByRole('button', { expanded: true })
    expect(triggers).toHaveLength(1)
    const closed = within(list).getAllByRole('button', { expanded: false })[0]!
    closed.focus()
    await user.keyboard('{Enter}')
    expect(closed.getAttribute('aria-expanded')).toBe('true')
    expect(within(list).getAllByRole('link', { name: /^Show .+ in the graph$/ }).length).toBeGreaterThan(5)
    const notes = within(list).getAllByRole('link', { name: /\d{4}-\d{2}-\d{2}$/ })
    expect(notes.length).toBeGreaterThan(10)
    expect(notes[0]!.getAttribute('href')).toMatch(/^\/notes\//)
    expect(await axe(container)).toEqual([])
    await user.click(screen.getByRole('tab', { name: '3D' }))
    expect(window.location.search).toBe('')
  })

  it('shows the download of the index while it loads, and what to do when it fails', async () => {
    renderAt('/explore', { hangIndex: true })
    expect(await screen.findByText('Loading the graph index')).toBeTruthy()
  })

  it('says the index did not load and tries again', async () => {
    const { user, calls } = renderAt('/explore', { indexStatus: 404 })
    expect(await screen.findByRole('heading', { name: 'The graph index did not load' })).toBeTruthy()
    expect(screen.getByText(/HTTP 404/)).toBeTruthy()
    const before = calls.filter((c) => c.endsWith('index.bin')).length
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(calls.filter((c) => c.endsWith('index.bin')).length).toBe(before + 1))
  })

  it('opens on a map of constellations on phones, with the filters in a sheet and no 3D', async () => {
    asPhone()
    const { user, container } = renderAt('/explore')
    expect(await screen.findByRole('tab', { name: 'Map' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: '3D' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Map' }).getAttribute('aria-selected')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Filter note types (6 of 6 shown)' }))
    expect(await screen.findByRole('dialog', { name: 'Filters' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(await axe(container)).toEqual([])
  })
})
