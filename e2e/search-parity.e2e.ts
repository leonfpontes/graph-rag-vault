// The same search package, in Node and in the browser, gives the same top 5 for every recorded
// question in the three variants: the static demo ranks exactly as the evaluation measures. The
// browser loads the built package (packages/search/dist) and the index file the demo serves.
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import type * as Search from '../packages/search/src/index.js'

const dist = path.resolve('packages/search/dist')

test('ranks the same top 5 in the browser as in Node, for every recorded question', async ({
  page,
  browserName,
}) => {
  const search = (await import(path.join(dist, 'index.js'))) as typeof Search
  const index = search.decodeIndex(readFileSync('apps/web/public/data/index.bin'))
  const searcher = search.createSearch(index)
  const node = index.queries.flatMap((q) =>
    search.SEARCH_VARIANTS.map((variant) =>
      searcher.search({ question: q.question, variant, queryVector: q.vector }).map((h) => h.noteId),
    ),
  )

  await page.route('**/__search/**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: readFileSync(path.join(dist, new URL(route.request().url()).pathname.replace('/__search/', ''))),
    }),
  )
  await page.goto('/')
  const browser = await page.evaluate(async () => {
    const s = (await import('/__search/index.js' as string)) as typeof Search
    const bytes = new Uint8Array(await (await fetch('/data/index.bin')).arrayBuffer())
    const idx = s.decodeIndex(bytes)
    const searcher = s.createSearch(idx)
    return idx.queries.flatMap((q) =>
      s.SEARCH_VARIANTS.map((variant) =>
        searcher.search({ question: q.question, variant, queryVector: q.vector }).map((h) => h.noteId),
      ),
    )
  })
  expect(browserName).toBe('chromium')
  expect(browser).toHaveLength(index.queries.length * 3)
  expect(browser).toEqual(node)
})
