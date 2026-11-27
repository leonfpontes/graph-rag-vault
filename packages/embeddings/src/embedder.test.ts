import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  createEmbedder,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_MODEL_KEYS,
  EMBEDDING_MODELS,
  resolveModel,
  type Extractor,
  type LoadExtractor,
} from './index.js'

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? []

/** A fake pipeline: a bag of hashed words, normalized. Similar texts get similar vectors. */
function fakeExtractor(dims = 384) {
  const calls: { texts: string[]; pooling: string; normalize: boolean }[] = []
  const embed = (text: string) => {
    const v = new Float32Array(dims)
    for (const w of words(text)) {
      let h = 0
      for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0
      v[h % dims]! += 1
    }
    const norm = Math.hypot(...v) || 1
    return v.map((x) => x / norm)
  }
  const extractor = Object.assign(
    async (texts: string[], options: { pooling: 'cls' | 'mean'; normalize: boolean }) => {
      calls.push({ texts, ...options })
      const data = new Float32Array(texts.length * dims)
      texts.forEach((t, i) => data.set(embed(t), i * dims))
      return { data, dims: [texts.length, dims] }
    },
    // one token per word, plus [CLS] and [SEP]
    { tokenizer: { encode: (text: string) => [101, ...words(text).map((_, i) => i + 1000), 102] } },
  ) satisfies Extractor
  return { extractor, calls }
}

const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i]!, 0)

describe('createEmbedder', () => {
  it('loads the default model by its pinned revision, through the injected loader', async () => {
    const { extractor } = fakeExtractor()
    const load = vi.fn<LoadExtractor>(async () => extractor)
    const embedder = await createEmbedder({ load, cacheDir: '/tmp/models', device: 'cpu' })
    expect(embedder.model.key).toBe(DEFAULT_EMBEDDING_MODEL)
    expect(load).toHaveBeenCalledWith(EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL], {
      cacheDir: '/tmp/models',
      device: 'cpu',
    })
  })

  it('puts the query prefix on questions only, with the model pooling and unit vectors', async () => {
    const { extractor, calls } = fakeExtractor()
    const embedder = await createEmbedder({ load: async () => extractor })
    const q = await embedder.embedQuery('  Who owns the gravel frame?  ')
    const [p] = await embedder.embedPassages(['Gravel frame › Owner\n\nMaya owns it.'])
    expect(calls[0]).toEqual({
      texts: ['Represent this sentence for searching relevant passages: Who owns the gravel frame?'],
      pooling: 'cls',
      normalize: true,
    })
    expect(calls[1]!.texts).toEqual(['Gravel frame › Owner\n\nMaya owns it.'])
    expect(q).toBeInstanceOf(Float32Array)
    expect(q.length).toBe(384)
    expect(dot(q, q)).toBeCloseTo(1)
    expect(dot(q, p!)).toBeGreaterThan(0)
  })

  it('uses mean pooling and no prefix for all-MiniLM', async () => {
    const { extractor, calls } = fakeExtractor()
    const embedder = await createEmbedder({ model: 'all-minilm-l6-v2', load: async () => extractor })
    await embedder.embedQuery('frame supplier')
    expect(calls[0]).toMatchObject({ texts: ['frame supplier'], pooling: 'mean' })
  })

  it('embeds passages in batches and keeps their order', async () => {
    const { extractor, calls } = fakeExtractor()
    const embedder = await createEmbedder({ load: async () => extractor, batchSize: 2 })
    const texts = ['alpha frame', 'beta wheel', 'gamma saddle', 'delta chain', 'epsilon brake']
    const vectors = await embedder.embedPassages(texts)
    expect(calls.map((c) => c.texts.length)).toEqual([2, 2, 1])
    expect(vectors).toHaveLength(5)
    const alone = await embedder.embedPassages(['gamma saddle'])
    expect(Array.from(vectors[2]!)).toEqual(Array.from(alone[0]!))
    expect(await embedder.embedPassages([])).toEqual([])
  })

  it('counts tokens with the model tokenizer, special tokens included', async () => {
    const { extractor } = fakeExtractor()
    const embedder = await createEmbedder({ load: async () => extractor })
    expect(embedder.countTokens('three short words')).toBe(5)
  })

  it('refuses a passage the model would cut, an empty question and a bad batch size', async () => {
    const { extractor } = fakeExtractor()
    const embedder = await createEmbedder({ model: 'all-minilm-l6-v2', load: async () => extractor })
    const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ')
    await expect(embedder.embedPassages(['ok', long])).rejects.toThrow(
      'Passage 1 has 302 tokens; Xenova/all-MiniLM-L6-v2 reads 256',
    )
    await expect(embedder.embedQuery('   ')).rejects.toThrow('The question is empty.')
    await expect(createEmbedder({ load: async () => extractor, batchSize: 0 })).rejects.toThrow(
      'batchSize must be a whole number',
    )
  })

  it('fails loudly when the model returns another shape', async () => {
    const { extractor } = fakeExtractor(768)
    const embedder = await createEmbedder({ load: async () => extractor })
    await expect(embedder.embedQuery('frame')).rejects.toThrow(
      'returned a [1, 768] tensor for 1 texts; expected [1, 384]',
    )
  })

  it('refuses an unknown model before loading anything', async () => {
    const load = vi.fn<LoadExtractor>()
    await expect(createEmbedder({ model: 'text-embedding-3-small', load })).rejects.toThrow(
      'Unknown embedding model "text-embedding-3-small"',
    )
    expect(load).not.toHaveBeenCalled()
  })
})

describe('models', () => {
  it('pins every model to a commit, with its license, 384 dimensions and a known size', () => {
    for (const key of EMBEDDING_MODEL_KEYS) {
      const m = resolveModel(key)
      expect(m.key).toBe(key)
      expect(m.revision).toMatch(/^[0-9a-f]{40}$/)
      expect(['MIT', 'Apache-2.0']).toContain(m.license)
      expect(m.dims).toBe(384)
      expect(m.bytes).toBeGreaterThan(10_000_000)
      expect(m.bytes).toBeLessThan(40_000_000)
    }
    expect(resolveModel().key).toBe(DEFAULT_EMBEDDING_MODEL)
  })
})

describe('runs in the browser', () => {
  it('imports nothing from Node: the Ask worker loads it', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    expect(sources.length).toBeGreaterThan(0)
    for (const file of sources)
      expect(readFileSync(path.join(dir, file), 'utf8'), file).not.toMatch(/from 'node:|require\(/)
  })
})

// The real model: 34 MB from the Hugging Face hub, so only on demand (GRAPH_RAG_LIVE_MODEL=1).
describe.runIf(process.env.GRAPH_RAG_LIVE_MODEL === '1')('the real model', () => {
  it('embeds a question nearer to its passage than to an unrelated one', { timeout: 180_000 }, async () => {
    const embedder = await createEmbedder({ cacheDir: process.env.GRAPH_RAG_MODEL_CACHE })
    const q = await embedder.embedQuery('Who supplies the carbon frames?')
    const [related, unrelated] = await embedder.embedPassages([
      'Frame supply › Decision\n\nCarbon frames now come from a composites supplier.',
      'Office › Lunch\n\nThe canteen serves soup on Fridays.',
    ])
    expect(q.length).toBe(384)
    expect(dot(q, q)).toBeCloseTo(1, 3)
    expect(dot(q, related!)).toBeGreaterThan(dot(q, unrelated!))
    expect(embedder.countTokens('frame')).toBe(3)
  })
})
