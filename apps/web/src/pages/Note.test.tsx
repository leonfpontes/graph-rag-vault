import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { axe } from '../test/axe'
import { renderAt } from '../test/render'

describe('Note', () => {
  it('shows the note in its chunks, with the questions whose answers cite each one', async () => {
    const { container } = renderAt('/notes/dec-switch-battery-voltaro')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Switch Ridgeline battery cells to Voltaro' }),
    ).toBeTruthy()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Explore' }).getAttribute('href')).toBe('/explore')
    expect(within(crumbs).getByText('Decisions')).toBeTruthy()
    expect(within(crumbs).getByText('dec-switch-battery-voltaro.md').getAttribute('aria-current')).toBe(
      'page',
    )
    const chunk = screen.getByRole('region', { name: 'Chunk 1 of 2' })
    expect(await within(chunk).findByRole('link', { name: 'q-004' })).toBeTruthy()
    expect(
      within(screen.getByRole('region', { name: 'Chunk 2 of 2' }))
        .getByRole('link', { name: 'Ridgeline' })
        .getAttribute('href'),
    ).toBe('/notes/prj-ridgeline-emtb')
    expect(screen.getByText('supersedes →')).toBeTruthy()
    expect(screen.getByRole('link', { name: /q-022 · In which meeting/ }).getAttribute('href')).toBe(
      '/ask?q=q-022',
    )
    expect(screen.getByRole('link', { name: /Show in graph/ }).getAttribute('href')).toBe(
      '/explore?focus=dec-switch-battery-voltaro',
    )
    expect(await axe(container)).toEqual([])
  })

  it('folds the frontmatter into a table of properties', async () => {
    const { user } = renderAt('/notes/dec-switch-battery-voltaro')
    const toggle = await screen.findByRole('button', { name: 'Properties (frontmatter)' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('decided_in')).toBeTruthy()
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('warns that a superseded note is replaced, and links the newer one', async () => {
    renderAt('/notes/dec-keep-ampcore')
    expect(await screen.findByText('Superseded on 2 Oct 2026')).toBeTruthy()
    expect(
      screen.getAllByRole('link', { name: 'Switch Ridgeline battery cells to Voltaro' }).length,
    ).toBeGreaterThan(0)
  })

  it('says when a note does not exist, with the way back', async () => {
    const { container } = renderAt('/notes/no-such-note')
    expect(await screen.findByRole('heading', { name: 'No note called “no-such-note”' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Explore' }).getAttribute('href')).toBe('/explore')
    expect(document.title).toBe('Note not found · graph-rag-vault')
    expect(await axe(container)).toEqual([])
  })
})
