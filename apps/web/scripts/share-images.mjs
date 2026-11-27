// Draws the share images from the app's /share page, on the same server as pnpm demo (no key):
// - docs/social-preview.png, 1280 × 640 (GitHub's social preview, set by hand in the repository settings)
// - apps/web/public/og.png, 1200 × 630 (the og:image of the site)
// - docs/cover-light.png and docs/cover-dark.png, 830 × 415 drawn at 2× (the README cover, one per theme)
// It also writes docs/share.values.json, the values the images show; apps/web/src/lib/share.test.ts
// compares them with the scoreboard and the recorded answer, so an image can't fall behind its sources.
// Usage: pnpm share-images   (builds first; needs Chromium: pnpm exec playwright install chromium)
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import { format } from 'prettier'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const out = (file) => fileURLToPath(new URL(file, `file://${root}`))

// A free port of our own: never a server someone else left running.
const port = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address()
    s.close(() => resolve(port))
  })
})
const server = spawn(
  process.execPath,
  ['packages/api/dist/cli.js', 'serve', '--port', String(port), '--no-key'],
  { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] },
)
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes(`http://127.0.0.1:${port}`) && resolve())
  server.on('exit', (code) => reject(new Error(`The server stopped (${code}). Run pnpm build first.`)))
})

const PIECES = [
  ['#art-social', 'docs/social-preview.png', 1],
  ['#art-og', 'apps/web/public/og.png', 1],
  ['#art-cover-light', 'docs/cover-light.png', 2],
  ['#art-cover-dark', 'docs/cover-dark.png', 2],
]

const browser = await chromium.launch()
try {
  let values
  for (const scale of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 2600 }, deviceScaleFactor: scale })
    await page.goto(`http://127.0.0.1:${port}/share?record&theme=light`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForFunction(() => window.__shareValues !== undefined)
    for (const [selector, file, s] of PIECES) {
      if (s !== scale) continue
      await page.locator(selector).screenshot({ path: out(file) })
      console.log(`share-images: wrote ${file}`)
    }
    values = await page.evaluate(() => window.__shareValues)
    await page.close()
  }
  writeFileSync(
    out('docs/share.values.json'),
    await format(JSON.stringify(values, null, 2), { parser: 'json' }),
  )
  console.log('share-images: wrote docs/share.values.json')
} finally {
  await browser.close()
  server.kill()
}
