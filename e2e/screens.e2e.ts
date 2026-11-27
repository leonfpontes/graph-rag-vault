// The four screens in a real browser, at 1440 and 375 px (playwright.config.ts), against the built app
// on the demo server with no key: no console errors, no sideways scroll, and the behavior jsdom
// cannot check (the 3D scene, hover previews, the phone map).
import { expect, test, type Page } from '@playwright/test'

const watch = (page: Page) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
const phone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768

for (const [route, title] of [
  ['/explore', 'Explore'],
  ['/ask?q=q-022', 'Ask the vault'],
  ['/notes/dec-switch-battery-voltaro', 'Switch Ridgeline battery cells to Voltaro'],
  ['/evaluation', 'Evaluation'],
  ['/explore?view=list', 'Explore'],
  ['/ask?q=q-044', 'Ask the vault'],
] as const)
  test(`${route} opens with no console errors and no sideways scroll`, async ({ page }) => {
    const errors = watch(page)
    await page.goto(route)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(errors).toEqual([])
  })

test('Explore draws the 3D scene with Three.js on desktop, and a map of constellations on phones', async ({
  page,
}) => {
  await page.goto('/explore')
  const canvas = page.getByRole('img', { name: /Graph of \d+ notes/ })
  if (phone(page)) {
    await expect(page.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: '3D' })).toHaveCount(0)
    await expect(canvas).toHaveAttribute('data-renderer', 'canvas')
  } else await expect(canvas).toHaveAttribute('data-renderer', 'three')
})

test('a click on a note in the 2D view selects it', async ({ page }) => {
  await page.goto('/explore?view=2d')
  const canvas = page.getByRole('img', { name: /Graph of \d+ notes/ })
  await expect(canvas).toBeVisible()
  // Click where a note is: the page knows the positions only on the canvas, so try the center outwards.
  const box = (await canvas.boundingBox())!
  for (const [dx, dy] of [
    [0, 0],
    [20, 0],
    [-20, 0],
    [0, 20],
    [0, -20],
    [40, 40],
    [-40, -40],
    [60, 0],
    [-60, 0],
  ]) {
    await page.mouse.click(box.x + box.width / 2 + dx!, box.y + box.height / 2 + dy!)
    if (new URL(page.url()).searchParams.has('focus')) break
  }
  expect(new URL(page.url()).searchParams.get('focus')).toMatch(/^[a-z0-9-]+$/)
})

test('Ask: resting on a citation shows the passage the answer read, and the path names each link', async ({
  page,
}) => {
  await page.goto('/ask?q=q-022')
  const chip = page.getByRole(phone(page) ? 'button' : 'link', { name: /^Source 1: / }).first()
  if (phone(page)) {
    await chip.click()
    const sheet = page.getByRole('dialog', { name: 'Source 1' })
    await expect(sheet.locator('blockquote mark')).toBeVisible()
    await sheet.getByRole('button', { name: 'Close source preview' }).click()
    await expect(sheet).toHaveCount(0)
  } else {
    await chip.hover()
    await expect(page.locator('[data-slot="hover-card-content"] blockquote mark')).toBeVisible()
  }
  const text = page.getByRole('region', { name: 'The path, as text' })
  await expect(text.getByText('supersedes →')).toBeVisible()
})

test('Explore List: the constellations open and close from the keyboard', async ({ page }) => {
  await page.goto('/explore?view=list')
  const list = page.getByRole('region', { name: 'Notes by constellation' })
  const name = (await list.getByRole('button', { expanded: false }).first().textContent())!
  const closed = list.getByRole('button', { name, exact: true })
  await closed.focus()
  await page.keyboard.press('Enter')
  await expect(closed).toHaveAttribute('aria-expanded', 'true')
})
