// The page's side of the embedding worker: one worker for the session, started on the first question
// a person types. Cancel stops the download (the worker is terminated, the next question starts
// again). `window.graphRag.embedQuery` exposes the same call, so the end-to-end test can compare the
// browser's vectors with the ones Node wrote in the index (cosine > 0.999, same top 5).
import type { FromWorker, ToWorker } from './protocol'

export interface ModelProgress {
  loaded: number
  total?: number
}

let worker: Worker | undefined
let ready = false
let nextId = 1
const waiting = new Map<number, { resolve: (v: Float32Array) => void; reject: (e: Error) => void }>()
const listeners = new Set<(p: ModelProgress) => void>()

function start(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (event: MessageEvent<FromWorker>) => {
    const m = event.data
    if (m.type === 'progress') for (const l of listeners) l({ loaded: m.loaded, total: m.total })
    else if (m.type === 'ready') ready = true
    else {
      const job = waiting.get(m.id)
      waiting.delete(m.id)
      if (m.type === 'vector') job?.resolve(m.vector)
      else job?.reject(new Error(m.message))
    }
  }
  w.onerror = (event) => {
    for (const job of waiting.values()) job.reject(new Error(event.message || 'The search model stopped.'))
    waiting.clear()
    stop()
  }
  worker = w
  return w
}

function stop() {
  worker?.terminate()
  worker = undefined
  ready = false
}

/** True once the model is loaded in this session: the next question needs no download. */
export const modelReady = () => ready

/** The question's unit embedding, computed in the browser. Aborting stops the download. */
export function embedQuery(
  question: string,
  { onProgress, signal }: { onProgress?: (p: ModelProgress) => void; signal?: AbortSignal } = {},
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const w = start()
    const id = nextId++
    if (onProgress) listeners.add(onProgress)
    const done = () => {
      if (onProgress) listeners.delete(onProgress)
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      done()
      waiting.delete(id)
      // Stopping the worker is the only way to stop transformers.js mid-download.
      if (!ready) {
        for (const job of waiting.values()) job.reject(new DOMException('Cancelled', 'AbortError'))
        waiting.clear()
        stop()
      }
      reject(new DOMException('Cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    waiting.set(id, {
      resolve: (v) => {
        done()
        resolve(v)
      },
      reject: (e) => {
        done()
        reject(e)
      },
    })
    w.postMessage({ id, question } satisfies ToWorker)
  })
}

declare global {
  interface Window {
    graphRag?: { embedQuery: (question: string) => Promise<number[]> }
  }
}

if (typeof window !== 'undefined')
  window.graphRag = { embedQuery: async (question) => Array.from(await embedQuery(question)) }
