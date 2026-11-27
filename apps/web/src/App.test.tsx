import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { axe } from './test/axe'
import { renderAt } from './test/render'

describe('App shell', () => {
  it('names the product and the three search variants, with no accessibility violations', async () => {
    const { container } = renderAt('/')
    expect(screen.getByRole('heading', { level: 1, name: 'Graph RAG over a Markdown vault' })).toBeTruthy()
    for (const variant of ['vector', 'graph', 'hybrid']) expect(screen.getByText(variant)).toBeTruthy()
    expect(await axe(container)).toEqual([])
  })

  it('has the product tabs, marks the current one, and moves between screens without reloading', async () => {
    const { user } = renderAt('/explore')
    const nav = screen.getByRole('navigation', { name: 'Product' })
    expect(within(nav).getByRole('link', { name: 'Explore' }).getAttribute('aria-current')).toBe('page')
    await user.click(within(nav).getByRole('link', { name: 'Evaluation' }))
    expect(window.location.pathname).toBe('/evaluation')
    expect(await screen.findByRole('heading', { level: 1, name: 'Evaluation' })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: 'Evaluation' }).getAttribute('aria-current')).toBe('page')
    expect(document.title).toBe('Evaluation · graph-rag-vault')
  })

  it('switches the theme and keeps the choice', async () => {
    const { user } = renderAt('/')
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('graph-rag-vault:theme')).toBe('dark')
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('says what runs in the browser and what needs a key, and closes with Escape', async () => {
    const { user } = renderAt('/explore')
    const button = screen.getByRole('button', { name: /Demo mode/ })
    await user.click(button)
    const panel = screen.getByRole('region', { name: 'Demo mode: runs in your browser' })
    expect(within(panel).getByText(/only when you run it locally/)).toBeTruthy()
    expect(within(panel).getByText(/pnpm demo/)).toBeTruthy()
    // The recorded questions, scored and for tuning, from questions.json.
    expect(
      await within(panel).findByText('The 50 recorded questions (40 scored, 10 for tuning): instant answers'),
    ).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  })

  it('says local mode when the local server has a key', async () => {
    renderAt('/explore', { mode: 'local' })
    expect(await screen.findByRole('button', { name: /Local mode/ })).toBeTruthy()
  })

  it('shows a page for any address outside the routes', () => {
    renderAt('/nope')
    expect(screen.getByRole('heading', { level: 1, name: 'This page is not in the vault' })).toBeTruthy()
  })
})
