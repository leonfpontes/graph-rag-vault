// Q1 bugs 1 and 2 at unit level (the e2e tests in e2e/q1-bugs.e2e.ts check them in a real browser).
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { App } from '../App'
import { hasWebGL } from '../graph/three'
import { demoOptions } from '../test/demo'

describe('the demo state', () => {
  // https://trello.com/c/lwFdXcrH
  for (const file of ['latest.json', 'questions.json'])
    it(`keeps the error with Try again when /data/${file} fails and the index arrives after it`, async () => {
      const base = demoOptions()
      let release!: () => void
      const late = new Promise<void>((done) => (release = done))
      const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
        if (url === `/data/${file}`) return new Response('Not found', { status: 404 })
        const res = await base.fetch!(input, init)
        if (url === '/data/index.bin') await late
        return res
      }) as typeof fetch
      window.history.replaceState(null, '', '/explore')
      render(<App demo={{ ...base, fetch: doFetch }} />)
      expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
      release()
      // The index bytes arrive and report progress: the error must stay.
      await new Promise((done) => setTimeout(done, 200))
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
      expect(screen.getByText(new RegExp(`/data/${file.replace('.', '\\.')} \\(HTTP 404\\)`))).toBeTruthy()
      expect(screen.queryByText('Loading the graph index')).toBeNull()
    })
})

describe('the WebGL check', () => {
  // https://trello.com/c/8VhRY9xs
  it('asks the browser once per page, however many times the graph renders', () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    const first = hasWebGL()
    const calls = spy.mock.calls.length
    for (let i = 0; i < 50; i++) expect(hasWebGL()).toBe(first)
    expect(spy.mock.calls.length).toBe(calls)
    spy.mockRestore()
  })
})
