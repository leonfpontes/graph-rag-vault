// The index as one binary file, for the browser: "GRVI", the header length (uint32 LE), the header
// as UTF-8 JSON (notes, links, chunks, recorded questions), padding to 4 bytes, then the chunk
// vectors and the question vectors as Float32 little-endian. Little-endian everywhere, so the file
// reads the same on any machine.
import type { IndexedChunk, IndexedLink, IndexedNote, SearchIndex } from './types.js'

const MAGIC = 'GRVI'

interface Header {
  format: 1
  model: SearchIndex['model']
  sourceHash: string
  notes: IndexedNote[]
  links: IndexedLink[]
  chunks: IndexedChunk[]
  queries: { id: string; question: string }[]
}

export function encodeIndex(index: SearchIndex): Uint8Array {
  const { dims } = index.model
  if (index.vectors.length !== index.chunks.length * dims)
    throw new Error(`${index.vectors.length} vector values for ${index.chunks.length} chunks of ${dims}.`)
  for (const q of index.queries)
    if (q.vector.length !== dims)
      throw new Error(`Question ${q.id} has ${q.vector.length} dimensions, not ${dims}.`)
  const header: Header = {
    format: index.format,
    model: index.model,
    sourceHash: index.sourceHash,
    notes: index.notes,
    links: index.links,
    chunks: index.chunks,
    queries: index.queries.map(({ id, question }) => ({ id, question })),
  }
  const json = new TextEncoder().encode(JSON.stringify(header))
  const start = Math.ceil((8 + json.length) / 4) * 4
  const values = index.vectors.length + index.queries.length * dims
  const bytes = new Uint8Array(start + values * 4)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode(MAGIC), 0)
  view.setUint32(4, json.length, true)
  bytes.set(json, 8)
  let offset = start
  const write = (v: Float32Array) => {
    for (const x of v) {
      view.setFloat32(offset, x, true)
      offset += 4
    }
  }
  write(index.vectors)
  for (const q of index.queries) write(q.vector)
  return bytes
}

export function decodeIndex(bytes: Uint8Array): SearchIndex {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC)
    throw new Error('Not a search index file (no GRVI header).')
  const length = view.getUint32(4, true)
  if (8 + length > bytes.byteLength) throw new Error('The index file is cut short (header).')
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length))) as Header
  if (header.format !== 1) throw new Error(`Index format ${String(header.format)} is not supported (1).`)
  const { dims } = header.model
  const start = Math.ceil((8 + length) / 4) * 4
  const values = (header.chunks.length + header.queries.length) * dims
  if (start + values * 4 !== bytes.byteLength)
    throw new Error(`The index file has ${bytes.byteLength} bytes; expected ${start + values * 4}.`)
  let offset = start
  const read = (n: number) => {
    const v = new Float32Array(n)
    for (let i = 0; i < n; i++, offset += 4) v[i] = view.getFloat32(offset, true)
    return v
  }
  const vectors = read(header.chunks.length * dims)
  return {
    format: 1,
    model: header.model,
    sourceHash: header.sourceHash,
    notes: header.notes,
    links: header.links,
    chunks: header.chunks,
    vectors,
    queries: header.queries.map((q) => ({ ...q, vector: read(dims) })),
  }
}
