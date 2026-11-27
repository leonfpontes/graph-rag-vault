import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'
import { axe } from './test/axe'

describe('App', () => {
  it('names the product and the three search variants, with no accessibility violations', async () => {
    const { container } = render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Graph RAG over a Markdown vault' })).toBeTruthy()
    for (const variant of ['vector', 'graph', 'hybrid']) expect(screen.getByText(variant)).toBeTruthy()
    expect(await axe(container)).toEqual([])
  })
})
