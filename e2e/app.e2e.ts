import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

// The built app and the API on one server (pnpm demo), at 1440 and 375 px (playwright.config.ts).
test('opens the app with no console errors and no sideways scroll', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Graph RAG over a Markdown vault' })).toBeVisible()
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  expect(errors).toEqual([])
})

test('serves the API next to the app, with no key in the demo', async ({ request }) => {
  const meta = await request.get('/api/meta')
  expect(meta.status()).toBe(200)
  expect(await meta.json()).toEqual({ name: 'graph-rag-vault', mode: 'demo' })
  expect((await request.get('/api/nothing')).status()).toBe(404)
  expect((await request.post('/api/meta')).status()).toBe(405)
  const note = await request.get('/api/notes/per-maya-okafor')
  expect(note.status()).toBe(200)
  expect(((await note.json()) as { note: { title: string } }).note.title).toBe('Maya Okafor')
  const answer = await request.post('/api/answer', { data: { question: 'Who owns RL-1?' } })
  expect(answer.status()).toBe(503)
})

test('opens the app on its routes and gives any other path a real 404', async ({ request }) => {
  for (const route of ['/', '/explore', '/ask?q=q-011', '/evaluation', '/notes/per-maya-okafor'])
    expect((await request.get(route)).status(), route).toBe(200)
  for (const route of ['/nope', '/notes/Not_An_Id', '/ask/more'])
    expect((await request.get(route)).status(), route).toBe(404)
})

test('serves the scoreboard and the recorded answers byte for byte from evals/results', async ({
  request,
}) => {
  for (const file of ['latest.json', 'answers.json']) {
    const res = await request.get(`/data/${file}`)
    expect(res.status(), file).toBe(200)
    expect(await res.text(), file).toBe(readFileSync(`evals/results/${file}`, 'utf8'))
  }
  const questions = (await (await request.get('/data/questions.json')).json()) as unknown[]
  expect(questions).toHaveLength(50)
})
