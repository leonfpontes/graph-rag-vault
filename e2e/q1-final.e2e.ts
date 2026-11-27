// Q1 (QA), final round: the landing, the 404, the Ask answers (citations and "I don't know") and a free
// question with no key, in light and dark, against the demo server with no key.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const latest = JSON.parse(readFileSync('evals/results/latest.json', 'utf8'))
const pct = (x: number) => `${Math.round(100 * x)}%`
const verdict = latest.verdict

const watch = (page: Page) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme })

    test('the landing H1 is the scoreboard sentence of latest.json', async ({ page }) => {
      const errors = watch(page)
      await page.goto('/')
      const h1 = page.getByRole('heading', { level: 1 })
      await expect(h1).toContainText(pct(verdict.hybrid), { timeout: 15_000 })
      await expect(h1).toContainText(pct(verdict.bestOther.recall5))
      if (verdict.outcomeVsBestOther === 'tie') await expect(h1).toContainText(/tie/i)
      await expect(h1).not.toContainText(/\b(beats|wins|better)\b/i)
      await page.waitForLoadState('networkidle')
      expect(await sideways(page)).toBeLessThanOrEqual(0)
      expect(errors).toEqual([])
    })

    test('an unknown path is a real 404 with the 404 page', async ({ page }) => {
      const res = await page.goto('/this-page-does-not-exist')
      expect(res?.status()).toBe(404)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('link', { name: /explore|home|how it works|back/i }).first()).toBeVisible()
    })

    test('Ask: an unanswerable recorded question says "I don\'t know", with no citation', async ({
      page,
    }) => {
      const errors = watch(page)
      await page.goto('/ask?q=q-044')
      const answer = page.getByRole('region', { name: 'Answer' })
      await expect(answer.getByText("I don't know.")).toBeVisible({ timeout: 15_000 })
      await expect(answer.getByText(/Expected for this question/)).toBeVisible()
      await expect(page.getByRole(/* desktop */ 'link', { name: /^Source \d+: / })).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('Ask: the featured answer cites every sentence', async ({ page }) => {
      await page.goto('/ask?q=q-020')
      const cites = page.locator('[aria-label^="Source "]')
      await expect(cites.first()).toBeVisible({ timeout: 15_000 })
      expect(await cites.count()).toBeGreaterThanOrEqual(3)
    })
  })
}

test('a free question, with no key: the search runs in the browser and the page explains how to get an answer', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = watch(page)
  const keyCalls: string[] = []
  page.on('request', (r) => /anthropic|\/api\/answer/.test(r.url()) && keyCalls.push(r.url()))
  await page.goto('/ask')
  await page.getByPlaceholder(/Ask about Tarnwick Cycles/).fill('Who leads customer service at Tarnwick?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  const t0 = Date.now()
  await expect(page.getByText('The search ran; the answer needs your key')).toBeVisible({ timeout: 90_000 })
  await expect(
    page.getByRole('heading', { name: /^Sources/ }).or(page.getByText(/^Sources/).first()),
  ).toBeVisible()
  test
    .info()
    .annotations.push({ type: 'timing', description: `free question to first result ${Date.now() - t0} ms` })
  expect(keyCalls).toEqual([])
  expect(errors).toEqual([])
})
