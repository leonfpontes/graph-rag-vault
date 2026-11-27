// Q1 (QA): bugs found in the final round, each with its card. They were marked test.fail until fixed;
// now they pass for real.
import { expect, test } from '@playwright/test'

test.describe('bugs of the Q1 final round', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  // https://trello.com/c/8VhRY9xs
  test('Ask: a free question keeps the graph on few WebGL contexts, and the 3D path never loses its own', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      const w = window as unknown as { __gl: number }
      w.__gl = 0
      const orig = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        const ctx = (orig as (...a: unknown[]) => unknown).call(this, type, ...rest)
        const c = this as HTMLCanvasElement & { __counted?: true }
        if (String(type).startsWith('webgl') && ctx && !c.__counted) {
          c.__counted = true
          w.__gl++
        }
        return ctx
      } as typeof orig
    })
    let lost = 0
    page.on('console', (m) => /Too many active WebGL contexts|Context Lost/.test(m.text()) && lost++)
    await page.goto('/ask')
    await page.getByPlaceholder(/Ask about Tarnwick Cycles/).fill('Who leads customer service at Tarnwick?')
    await page.getByRole('button', { name: 'Ask', exact: true }).click()
    await expect(page.getByText('The search ran; the answer needs your key')).toBeVisible({ timeout: 90_000 })
    const created = await page.evaluate(() => (window as unknown as { __gl: number }).__gl)
    expect(created).toBeLessThanOrEqual(4)
    expect(lost).toBe(0)
  })

  // https://trello.com/c/lwFdXcrH
  for (const file of ['latest.json', 'questions.json'])
    test(`a failed /data/${file} shows the error with Try again, not "Loading" for ever`, async ({
      page,
    }) => {
      await page.route(`**/data/${file}`, (r) => r.fulfill({ status: 404, body: 'Not found' }))
      // The failure lands first and the index arrives after it, as on a slow link: the order of the bug.
      let indexServed!: () => void
      const served = new Promise<void>((done) => (indexServed = done))
      await page.route('**/data/index.bin', async (r) => {
        const res = await r.fetch()
        await new Promise((done) => setTimeout(done, 1500))
        await r.fulfill({ response: res })
        indexServed()
      })
      await page.goto('/explore')
      await served
      await page.waitForTimeout(1000)
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 2000 })
    })
})
