/// <reference lib="webworker" />
// The Ask worker: the question's embedding in the browser, with the same model, revision, 8-bit
// weights, pooling and query prefix as the index (createEmbedder from @graph-rag/embeddings), on WASM
// so the arithmetic matches Node's CPU kernels (WebGPU would not). It loads only for the first
// question a person types; the browser keeps the weights (Cache API) for the next ones. The ONNX
// runtime's own files come from this site, not from a CDN.
import { createEmbedder, type Embedder } from '@graph-rag/embeddings'
import { env } from '@huggingface/transformers'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'

import type { FromWorker, ToWorker } from './protocol'

declare const self: DedicatedWorkerGlobalScope

env.allowLocalModels = false
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } }
if (onnx.wasm) {
  onnx.wasm.wasmPaths = {
    mjs: new URL(ortMjs, self.location.href).href,
    wasm: new URL(ortWasm, self.location.href).href,
  }
  // Threads need cross-origin isolation, which a static host does not give: one thread, always.
  onnx.wasm.numThreads = 1
}

const post = (message: FromWorker) => self.postMessage(message)

// The weights are the one large download: count their bytes as they arrive, for the progress bar.
// transformers.js fetches through env.fetch (it keeps its own reference to fetch).
const baseFetch = self.fetch.bind(self)
const counted = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await baseFetch(input, init)
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!res.ok || !res.body || !/\.onnx(\?|$)/.test(url)) return res
  const total = Number(res.headers.get('content-length')) || undefined
  let loaded = 0
  post({ type: 'progress', loaded, total })
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength
        post({ type: 'progress', loaded, total })
        controller.enqueue(chunk)
      },
    }),
  )
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
}
;(env as { fetch: typeof fetch }).fetch = counted as typeof fetch

let embedder: Promise<Embedder> | undefined

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const { id, question } = event.data
  try {
    embedder ??= createEmbedder({ device: 'wasm' })
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
