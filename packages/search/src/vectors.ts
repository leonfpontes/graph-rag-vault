// Embeddings as Float32 vectors: stored as little-endian BLOBs in SQLite and in the exported index,
// compared by brute-force cosine. At this size (about 2 thousand chunks of 384 dimensions) a scan
// takes milliseconds, so no vector extension (docs/adr/0002).

/** Dimensions of the embedding model the index and the browser share. */
export const EMBEDDING_DIMS = 384

/** Little-endian bytes of a vector, the same on every platform. */
export function toBlob(vector: Float32Array): Uint8Array {
  const bytes = new Uint8Array(vector.length * 4)
  const view = new DataView(bytes.buffer)
  vector.forEach((value, i) => view.setFloat32(i * 4, value, true))
  return bytes
}

/** The vector stored by `toBlob`. */
export function fromBlob(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 4 !== 0)
    throw new Error(`A vector BLOB has a multiple of 4 bytes, not ${bytes.byteLength}.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const vector = new Float32Array(bytes.byteLength / 4)
  for (let i = 0; i < vector.length; i++) vector[i] = view.getFloat32(i * 4, true)
  return vector
}

function sameLength(a: Float32Array, b: Float32Array) {
  if (a.length !== b.length) throw new Error(`Vectors of different sizes: ${a.length} and ${b.length}.`)
}

export function dot(a: Float32Array, b: Float32Array): number {
  sameLength(a, b)
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!
  return sum
}

/** Cosine similarity; 0 when either vector is all zeros. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const norms = Math.sqrt(dot(a, a) * dot(b, b))
  return norms === 0 ? 0 : dot(a, b) / norms
}

/** The unit vector in the same direction (a zero vector stays zero). */
export function normalize(vector: Float32Array): Float32Array {
  const norm = Math.sqrt(dot(vector, vector))
  return norm === 0 ? new Float32Array(vector.length) : vector.map((v) => v / norm)
}

export interface Neighbour {
  /** Row of the matrix. */
  index: number
  similarity: number
}

/**
 * The k rows of `matrix` (n unit vectors of `dims`, back to back) nearest to `query`, by cosine.
 * Rows must be normalized; the query is normalized here. Ties keep the lower row first.
 */
export function topK(query: Float32Array, matrix: Float32Array, dims: number, k: number): Neighbour[] {
  if (query.length !== dims) throw new Error(`The query has ${query.length} dimensions, the index ${dims}.`)
  if (matrix.length % dims !== 0)
    throw new Error(`The matrix length ${matrix.length} is not a multiple of ${dims}.`)
  const q = normalize(query)
  const rows = matrix.length / dims
  const all: Neighbour[] = []
  for (let row = 0; row < rows; row++) {
    let sum = 0
    const offset = row * dims
    for (let i = 0; i < dims; i++) sum += q[i]! * matrix[offset + i]!
    all.push({ index: row, similarity: sum })
  }
  return all.sort((a, b) => b.similarity - a.similarity || a.index - b.index).slice(0, Math.max(0, k))
}
