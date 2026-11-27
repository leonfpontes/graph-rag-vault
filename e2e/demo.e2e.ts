// The static demo's data layer in a real browser, against the built app on the demo server
// (--no-key, like the public site): the client package loads the index file, the scoreboard, the
// recorded answers and the questions, and the first search answers in under 2 s from the moment the
// page starts loading. The screens (F1) call the same loadDemo.
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import type * as Client from '../packages/client/src/index.js'

const PACKAGES: Record<string, string> = { client: 'client', search: 'search', answer: 'answer' }

const HARNESS = `<!doctype html><html><head>
<script type="importmap">{"imports":{
  "@graph-rag/client":"/__pkg/client/index.js",
  "@graph-rag/search":"/__pkg/search/index.js",
  "@graph-rag/answer/passages":"/__pkg/answer/browser.js"
}}</script></head><body></body></html>`

test.beforeEach(async ({ page }) => {
  // The built packages (dist), served from the app's own origin so /data and /api are the real ones.
  await page.route('**/__pkg/**', (route) => {
    const [, pkg, ...rest] = new URL(route.request().url()).pathname.split('/').slice(1)
    const dir = PACKAGES[pkg!]
    if (!dir) return route.fulfill({ status: 404 })
    return route.fulfill({
      contentType: 'text/javascript',
      body: readFileSync(path.resolve('packages', dir, 'dist', ...rest)),
    })
  })
  await page.route('**/__demo', (route) => route.fulfill({ contentType: 'text/html', body: HARNESS }))
})

test('opens the demo and answers the first search in under 2 s, with no key', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/__demo')
  const result = await page.evaluate(async () => {
    const { loadDemo } = (await import('@graph-rag/client' as string)) as typeof Client
    const demo = await loadDemo()
    const search = demo.search({ question: demo.questions[10]!.question })
    // performance.now() counts from the start of the page load
    const firstSearchMs = performance.now()
    return {
      firstSearchMs,
      searchMs: search.ms,
      mode: demo.mode,
      questions: demo.questions.length,
      ran: search.ran,
      top: search.hits.map((h) => h.noteId),
      verdict: demo.scoreboard.verdict.metric,
    }
  })
  test.info().annotations.push({
    type: 'timing',
    description: `first search ${Math.round(result.firstSearchMs)} ms after page start (search itself ${result.searchMs.toFixed(1)} ms)`,
  })
  expect(result.firstSearchMs).toBeLessThan(2000)
  expect(result).toMatchObject({ mode: 'demo', questions: 50, ran: 'hybrid', verdict: 'recall@5' })
  expect(result.top).toHaveLength(5)
  expect(errors).toEqual([])
})

test('replays the 50 recorded answers at once, and a free question gets the search and the local steps', async ({
  page,
}) => {
  await page.goto('/__demo')
  const result = await page.evaluate(async () => {
    const { loadDemo } = (await import('@graph-rag/client' as string)) as typeof Client
    const demo = await loadDemo()
    const recorded: { id: string; kind: string; sameNotes: boolean; ms: number }[] = []
    for (const q of demo.questions) {
      const start = performance.now()
      const outcome = await demo.answer({ question: q.question })
      recorded.push({
        id: q.id,
        kind: outcome.kind,
        sameNotes:
          outcome.kind === 'recorded' &&
          JSON.stringify(outcome.search.hits.map((h) => h.noteId)) ===
            JSON.stringify(outcome.answer.passageNotes),
        ms: performance.now() - start,
      })
    }
    const free = await demo.answer({ question: 'Which supplier makes the Ridgeline battery cells?' })
    const post = await fetch('/api/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'x' }),
    })
    return {
      recorded,
      free: { kind: free.kind, ran: free.search.ran, hits: free.search.hits.length },
      commands: free.kind === 'needs-key' ? free.commands : [],
      post: { status: post.status, body: (await post.json()) as { error: string } },
    }
  })
  expect(result.recorded).toHaveLength(50)
  for (const r of result.recorded) {
    expect(r.kind, r.id).toBe('recorded')
    expect(r.sameNotes, r.id).toBe(true)
    expect(r.ms, r.id).toBeLessThan(500)
  }
  expect(result.free).toEqual({ kind: 'needs-key', ran: 'graph', hits: 5 })
  expect(result.commands.at(-1)).toBe('pnpm demo')
  expect(result.post.status).toBe(503)
  expect(result.post.body.error).toContain('.env.local')
})
