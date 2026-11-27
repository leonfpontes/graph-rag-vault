// The one runtime the vectors come from, in the index (Node) and in the Ask worker (browser):
// onnxruntime-web on WebAssembly, single-threaded. Its 8-bit kernels round differently from
// onnxruntime-node's (cosine 0.996 on the same tokens), so a mix would move the top 5; the same
// runtime on both sides gives the same vectors (cosine > 0.9999, docs/adr/0003).

/** Must be the onnxruntime-web that transformers.js loads in the browser (a test checks it). */
export const ONNX_WEB_VERSION = '1.31.0-dev.20260914-8d85527a0'
export const EMBEDDING_RUNTIME = `onnxruntime-web@${ONNX_WEB_VERSION} wasm q8`

/**
 * One vector per text from the model's last hidden state, as transformers.js does it: the first
 * token (`cls`) or the mean of the real tokens (`mean`), then scaled to unit length.
 */
export function poolAndNormalize(
  hidden: ArrayLike<number>,
  [rows, tokens, dims]: readonly [number, number, number],
  mask: ArrayLike<number | bigint>,
  pooling: 'cls' | 'mean',
): Float32Array {
  const out = new Float32Array(rows * dims)
  for (let r = 0; r < rows; r++) {
    const v = out.subarray(r * dims, (r + 1) * dims)
    if (pooling === 'cls') for (let d = 0; d < dims; d++) v[d] = hidden[r * tokens * dims + d]!
    else {
      let n = 0
      for (let t = 0; t < tokens; t++) {
        if (Number(mask[r * tokens + t]) === 0) continue
        n++
        for (let d = 0; d < dims; d++) v[d]! += hidden[(r * tokens + t) * dims + d]!
      }
      for (let d = 0; d < dims; d++) v[d]! /= Math.max(n, 1)
    }
    const norm = Math.max(Math.hypot(...v), 1e-12)
    for (let d = 0; d < dims; d++) v[d]! /= norm
  }
  return out
}
