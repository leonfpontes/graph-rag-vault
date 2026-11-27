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

test('serves the API next to the app, read-only', async ({ request }) => {
  const meta = await request.get('/api/meta')
  expect(meta.status()).toBe(200)
  expect(await meta.json()).toEqual({ name: 'graph-rag-vault', mode: 'demo' })
  expect((await request.get('/api/nothing')).status()).toBe(404)
  expect((await request.post('/api/meta')).status()).toBe(405)
})
