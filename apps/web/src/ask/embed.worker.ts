/// <reference lib="webworker" />
// The Ask worker: the question's embedding in the browser, with the same model, revision, 8-bit
// weights, pooling and query prefix as the index (createEmbedder from @graph-rag/embeddings), on WASM
// so the arithmetic matches Node's CPU kernels (WebGPU would not). It loads only for the first
// question a person types; the browser keeps the weights (Cache API) for the next ones. The ONNX
// runtime's own files come from this site, not from a CDN.
import {
  createEmbedder,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_MODELS,
  type Embedder,
} from '@graph-rag/embeddings'
import { env } from '@huggingface/transformers'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

import { DownloadTally, type Part } from './progress'
import type { FromWorker, ToWorker } from './protocol'

declare const self: DedicatedWorkerGlobalScope

const post = (message: FromWorker) => self.postMessage(message)

// Two large downloads, counted together for the progress bar: the model's weights (through
// env.fetch: transformers.js keeps its own reference to fetch) and the runtime's .wasm, which the
// worker starts at once, alongside the model, instead of after it as onnxruntime would.
const tally = new DownloadTally(
  { model: EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL].bytes, runtime: __ORT_WASM_BYTES__ },
  (p) => post({ type: 'progress', ...p }),
)
const baseFetch = self.fetch.bind(self)
async function counted(input: RequestInfo | URL, part: Part, init?: RequestInit): Promise<Response> {
  const res = await baseFetch(input, init)
  if (!res.ok || !res.body) return res
  // With compression, Content-Length is the compressed size: the runtime's real size is known.
  const length = Number(res.headers.get('content-length')) || undefined
  if (part === 'model' && !res.headers.get('content-encoding')) tally.total(part, length)
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        tally.add(part, chunk.byteLength)
        controller.enqueue(chunk)
      },
    }),
  )
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
}

const wasmUrl = new URL(ortWasm, self.location.href).href
let runtime: Promise<ArrayBuffer> | undefined
const loadRuntime = () =>
  (runtime ??= counted(wasmUrl, 'runtime')
    .then((r) => {
      if (!r.ok) throw new Error(`The search runtime did not load (HTTP ${r.status}).`)
      return r.arrayBuffer()
    })
    .catch((e: unknown) => {
      runtime = undefined // the next question tries again
      throw e
    }))

env.allowLocalModels = false
// The worker hands the runtime's binary over itself (below), so transformers.js does not fetch it again.
;(env as { useWasmCache?: boolean }).useWasmCache = false
;(env as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return /\.onnx(\?|$)/.test(url) ? counted(input, 'model', init) : baseFetch(input, init)
}) as typeof fetch
const onnx = env.backends.onnx as {
  wasm?: { wasmPaths?: unknown; wasmBinary?: ArrayBuffer | Uint8Array; numThreads?: number }
}
if (onnx.wasm) {
  // The plain SIMD build (14 MB), not the asyncify one (27 MB): the WebAssembly backend needs no
  // async kernels, and the parity test (e2e/embed-parity.e2e.ts) checks the vectors stay the same.
  onnx.wasm.wasmPaths = { mjs: new URL(ortMjs, self.location.href).href, wasm: wasmUrl }
  // Threads need cross-origin isolation, which a static host does not give: one thread, always.
  onnx.wasm.numThreads = 1
}
// If onnxruntime asks for the .wasm before the worker has it, it gets the same download.
self.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === wasmUrl)
    return new Response(await loadRuntime(), { headers: { 'content-type': 'application/wasm' } })
  return baseFetch(input, init)
}) as typeof fetch

let embedder: Promise<Embedder> | undefined

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const { id, question } = event.data
  try {
    embedder ??= (() => {
      // The runtime and the model download side by side; the binary is handed over when it arrives.
      void loadRuntime().then(
        (bytes) => {
          if (onnx.wasm) onnx.wasm.wasmBinary = bytes
        },
        () => {},
      )
      return createEmbedder({ device: 'wasm' })
    })()
    const e = await embedder.catch((error: unknown) => {
      embedder = undefined // the next question tries the download again
      throw error
    })
    post({ type: 'ready', model: e.model.id })
    const vector = await e.embedQuery(question)
    post({ type: 'vector', id, vector })
  } catch (error) {
    post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
  }
}
