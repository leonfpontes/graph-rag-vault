// The Ask worker embeds a question in the browser (WASM) with the same model, weights and prefix as
// the index (Node). For the 50 recorded questions, its vectors must match the ones in index.bin
// (cosine > 0.999) and give the same top 5 in all three variants, or a typed question would rank
// differently from the evaluation. The model files come from the local cache when it has them
// (~/.cache/graph-rag-vault/models, as pnpm index leaves it); otherwise from Hugging Face.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import type * as Search from '../packages/search/src/index.js'

const CACHE = process.env.GRAPH_RAG_MODEL_CACHE ?? path.join(homedir(), '.cache', 'graph-rag-vault', 'models')

test('embeds the 50 recorded questions in the browser as Node did: cosine > 0.999 and the same top 5', async ({
  page,
}) => {
  // Loading the model (34 MB) and 50 embeddings on one WASM thread: well over the default timeout.
  test.setTimeout(240_000)
  const search = (await import(path.resolve('packages/search/dist/index.js'))) as typeof Search
  const index = search.decodeIndex(readFileSync('apps/web/public/data/index.bin'))
  const revision = index.model.revision
  await page.context().route('https://huggingface.co/**', (route) => {
    const m = /huggingface\.co\/(.+?)\/resolve\/[^/]+\/(.+)$/.exec(route.request().url())
    // transformers.js asks some files on "main": the pinned revision's copy is the same file.
    const file = m && path.join(CACHE, m[1]!, revision, m[2]!)
    if (file && existsSync(file)) return route.fulfill({ body: readFileSync(file) })
    return route.continue()
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/ask')
  await page.waitForFunction(() => !!window.graphRag)
  const vectors = await page.evaluate(
    async (questions) => {
      const out: number[][] = []
      for (const q of questions) out.push(await window.graphRag!.embedQuery(q))
      return out
    },
    index.queries.map((q) => q.question),
  )
  expect(vectors).toHaveLength(index.queries.length)
  const searcher = search.createSearch(index)
  const low: string[] = []
  const moved: string[] = []
  index.queries.forEach((q, i) => {
    const browser = Float32Array.from(vectors[i]!)
    let cosine = 0
    for (let k = 0; k < browser.length; k++) cosine += browser[k]! * q.vector[k]!
    if (!(cosine > 0.999)) low.push(`${q.id} ${cosine.toFixed(5)}`)
    for (const variant of search.SEARCH_VARIANTS) {
      const top = (v: Float32Array) =>
        searcher.search({ question: q.question, variant, queryVector: v }).map((h) => h.noteId)
      if (JSON.stringify(top(browser)) !== JSON.stringify(top(q.vector))) moved.push(`${q.id} ${variant}`)
    }
  })
  expect(low, 'cosine with the index vector').toEqual([])
  expect(moved, 'top 5 that differ').toEqual([])
  expect(errors).toEqual([])
})

declare global {
  interface Window {
    graphRag?: { embedQuery: (question: string) => Promise<number[]> }
  }
}
