// The embedder in Node, on the browser's runtime: transformers.js gives the tokenizer, and the ONNX
// file runs in onnxruntime-web (WebAssembly), as in the Ask worker. transformers.js in Node only
// offers onnxruntime-node, whose 8-bit kernels give other vectors (docs/adr/0003). The index, the
// local API and the evaluation import createEmbedder from here.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { createEmbedder as createWith, type EmbedderOptions, type LoadExtractor } from './embedder.js'
import type { EmbeddingModel } from './models.js'
import { EMBEDDING_RUNTIME, ONNX_WEB_VERSION, poolAndNormalize } from './runtime.js'

export * from './index.js'

export const DEFAULT_MODEL_CACHE = path.join(homedir(), '.cache', 'graph-rag-vault', 'models')
const MODEL_FILE = 'onnx/model_quantized.onnx'

/** The 8-bit ONNX file of the pinned revision, from the cache or downloaded into it once. */
export async function modelFile(
  model: Pick<EmbeddingModel, 'id' | 'revision'>,
  cacheDir: string,
  fetchFile: typeof fetch = fetch,
): Promise<Uint8Array> {
  const file = path.join(cacheDir, model.id, model.revision, MODEL_FILE)
  if (existsSync(file)) return readFileSync(file)
  const url = `https://huggingface.co/${model.id}/resolve/${model.revision}/${MODEL_FILE}`
  const response = await fetchFile(url)
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}.`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(`${file}.part`, bytes)
  renameSync(`${file}.part`, file)
  return bytes
}

export const loadWasm: LoadExtractor = async (model, options) => {
  const cacheDir = options.cacheDir ?? DEFAULT_MODEL_CACHE
  const [{ AutoTokenizer, env }, ort] = await Promise.all([
    import('@huggingface/transformers'),
    import('onnxruntime-web'),
  ])
  if (ort.env.versions.web !== ONNX_WEB_VERSION)
    throw new Error(
      `onnxruntime-web ${ort.env.versions.web} is loaded; the vectors need ${ONNX_WEB_VERSION}.`,
    )
  env.cacheDir = cacheDir
  const tokenizer = await AutoTokenizer.from_pretrained(model.id, { revision: model.revision })
  ort.env.wasm.numThreads = 1
  const session = await ort.InferenceSession.create(await modelFile(model, cacheDir), {
    executionProviders: ['wasm'],
  })
  const output = session.outputNames.includes('last_hidden_state')
    ? 'last_hidden_state'
    : session.outputNames[0]!
  const extractor = async (texts: string[], { pooling }: { pooling: 'cls' | 'mean'; normalize: boolean }) => {
    const encoded = tokenizer(texts, { padding: true, truncation: true }) as unknown as Record<
      string,
      { data: ArrayLike<bigint>; dims: number[] }
    >
    const feeds = Object.fromEntries(
      session.inputNames.map((name) => {
        const t = encoded[name]
        if (!t) throw new Error(`${model.id} needs the input "${name}", which the tokenizer did not give.`)
        return [name, new ort.Tensor('int64', BigInt64Array.from(t.data), t.dims)]
      }),
    )
    const hidden = (await session.run(feeds))[output]!
    const [rows, tokens, dims] = hidden.dims as [number, number, number]
    const data = poolAndNormalize(
      hidden.data as Float32Array,
      [rows, tokens, dims],
      encoded.attention_mask!.data,
      pooling,
    )
    return { data, dims: [rows, dims] as const }
  }
  return Object.assign(extractor, {
    tokenizer: { encode: (text: string) => tokenizer.encode(text) },
    runtime: EMBEDDING_RUNTIME,
  })
}

/** createEmbedder on the WASM runtime; a `device` (cpu, coreml) goes to transformers.js instead. */
export function createEmbedder(options: EmbedderOptions = {}) {
  return createWith(options.device || options.load ? options : { ...options, load: loadWasm })
}
