// Q1 (QA): the demo on a real phone profile (touch, mobile UA, 4x slower CPU) and on a browser with no WebGL.
import { devices, expect, test, type Page } from '@playwright/test'

const watch = (page: Page) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}
const slowCpu = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
}

test.describe('phone (Pixel 7, CPU 4x slower)', () => {
  const { defaultBrowserType: _b, ...pixel } = devices['Pixel 7']
  test.use(pixel)

  test('Explore draws the phone map on the canvas, with no errors', async ({ page }) => {
    const errors = watch(page)
    await slowCpu(page)
    const t0 = Date.now()
    await page.goto('/explore')
    const canvas = page.getByRole('img', { name: /Graph of \d+ notes/ })
    await expect(canvas).toHaveAttribute('data-renderer', 'canvas')
    test.info().annotations.push({ type: 'timing', description: `explore map ${Date.now() - t0} ms` })
    await page.waitForLoadState('networkidle')
    expect(errors).toEqual([])
  })

  test('Ask: the search answers in under 2 s from the tap on Ask', async ({ page }) => {
    const errors = watch(page)
    await slowCpu(page)
    const t0 = Date.now()
    await page.goto('/ask?q=q-022')
    await expect(page.getByRole('button', { name: /^Source 1: / }).first()).toBeVisible()
    const load = Date.now() - t0
    // A recorded question typed by hand: the search runs on the loaded index, with no model download.
    const box = page.getByPlaceholder(/Ask about Tarnwick Cycles/)
    await box.fill('In which meeting was the battery decision taken that the Voltaro switch later replaced?')
    await page.getByRole('button', { name: 'Ask', exact: true }).tap()
    const t1 = Date.now()
    await expect(page.getByRole('button', { name: /^Source 1: / }).first()).toBeVisible()
    const search = Date.now() - t1
    test.info().annotations.push({
      type: 'timing',
      description: `page start to first source ${load} ms; tap on Ask to first source ${search} ms`,
    })
    expect(search).toBeLessThan(2000)
    expect(errors).toEqual([])
  })
})

test.describe('desktop with no WebGL', () => {
  test('Explore falls back to the 2D canvas, with no errors', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (String(type).startsWith('webgl')) return null
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest)
      } as typeof orig
    })
    const errors = watch(page)
    await page.goto('/explore')
    await expect(page.getByRole('img', { name: /Graph of \d+ notes/ })).toHaveAttribute(
      'data-renderer',
      'canvas',
    )
    await page.waitForLoadState('networkidle')
    expect(errors).toEqual([])
  })
})
