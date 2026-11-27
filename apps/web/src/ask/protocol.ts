// Messages between the Ask page and its embedding worker.

export interface ToWorker {
  id: number
  question: string
}

export type FromWorker =
  /** Bytes of the model weights so far (total when the server says). */
  | { type: 'progress'; loaded: number; total?: number }
  /** The model is loaded (from the network or the browser's cache). */
  | { type: 'ready'; model: string }
  | { type: 'vector'; id: number; vector: Float32Array }
  | { type: 'error'; id: number; message: string }
