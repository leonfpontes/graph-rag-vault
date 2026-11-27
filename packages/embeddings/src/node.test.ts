import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEmbedder, EMBEDDING_RUNTIME, modelFile, resolveModel, type Extractor } from './node.js'

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'embed-cache-'))
  dirs.push(d)
  return d
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

const MODEL = { id: 'Org/model', revision: 'abc123' }

describe('the model file', () => {
  it('downloads the pinned revision once, then reads it from the cache', async () => {
    const cache = tmp()
    const fetchFile = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))
    expect(Array.from(await modelFile(MODEL, cache, fetchFile))).toEqual([1, 2, 3])
    expect(fetchFile).toHaveBeenCalledWith(
      'https://huggingface.co/Org/model/resolve/abc123/onnx/model_quantized.onnx',
    )
    const file = path.join(cache, 'Org/model/abc123/onnx/model_quantized.onnx')
    expect(Array.from(readFileSync(file))).toEqual([1, 2, 3])
    expect(existsSync(`${file}.part`)).toBe(false)
    expect(Array.from(await modelFile(MODEL, cache, fetchFile))).toEqual([1, 2, 3])
    expect(fetchFile).toHaveBeenCalledTimes(1)
  })

  it('stops on a failed download and leaves no file behind', async () => {
    const cache = tmp()
    const fetchFile = vi.fn(async () => new Response('gone', { status: 404 }))
    await expect(modelFile(MODEL, cache, fetchFile)).rejects.toThrow('HTTP 404')
    expect(existsSync(path.join(cache, 'Org'))).toBe(false)
  })
})

describe('createEmbedder in Node', () => {
  it('keeps an injected loader and reports its runtime', async () => {
    const extractor = Object.assign(
      async (texts: string[]) => ({
        data: new Float32Array(texts.length * 384).fill(1 / Math.sqrt(384)),
        dims: [texts.length, 384],
      }),
      { tokenizer: { encode: () => [1, 2] }, runtime: 'fake' },
    ) satisfies Extractor
    const e = await createEmbedder({ load: async () => extractor })
    expect(e.runtime).toBe('fake')
  })

  // Downloads the model (34 MB) on the first run: GRAPH_RAG_LIVE_MODEL=1 pnpm test
  it.runIf(process.env.GRAPH_RAG_LIVE_MODEL === '1')(
    'runs the model on WebAssembly, one passage per call, with the same vector every time',
    async () => {
      const e = await createEmbedder()
      expect(e.runtime).toBe(EMBEDDING_RUNTIME)
      expect(e.model).toBe(resolveModel())
      const texts = ['Frames are covered for life.', 'The second curing oven moves to December.']
      const [a, b] = await e.embedPassages(texts)
      const [b2] = await e.embedPassages([texts[1]!])
      expect(Array.from(b2!)).toEqual(Array.from(b!))
      expect(Math.hypot(...a!)).toBeCloseTo(1, 5)
    },
    120_000,
  )
})
