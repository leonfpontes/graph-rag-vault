// The index as the search reads it (`SearchIndex`): notes, links between them, chunks in note order
// and one unit vector per chunk for one model, plus recorded questions with their vectors. The CLI
// writes it as one binary file (encodeIndex) for the static demo.
import type { DatabaseSync } from 'node:sqlite'

import { fromBlob, type IndexedQuery, type SearchIndex } from '@graph-rag/search'

import { vectorKey } from './ingest.js'

export interface ExportOptions {
  model: { id: string; revision: string; dims: number }
  sourceHash: string
  queries?: IndexedQuery[]
  /** The runtime the vectors were made with (see vectorKey); none reads the plain model id. */
  runtime?: string
}

export function exportIndex(
  db: DatabaseSync,
  { model, sourceHash, queries = [], runtime }: ExportOptions,
): SearchIndex {
  const aliases = new Map<string, string[]>()
  for (const r of db.prepare('SELECT note_id, alias FROM aliases ORDER BY note_id, alias').all() as {
    note_id: string
    alias: string
  }[]) {
    if (!aliases.has(r.note_id)) aliases.set(r.note_id, [])
    aliases.get(r.note_id)!.push(r.alias)
  }
  const notes = (
    db.prepare('SELECT id, type, title, created, updated, status, path FROM notes ORDER BY id').all() as {
      id: string
      type: string
      title: string
      created: string
      updated: string
      status: string
      path: string
    }[]
  ).map((n) => ({ ...n, aliases: aliases.get(n.id) ?? [] }))
  const links = db
    .prepare(
      'SELECT src AS "from", dst AS "to", relation FROM links WHERE dst IN (SELECT id FROM notes) ORDER BY src, relation, dst',
    )
    .all() as { from: string; to: string; relation: string }[]
  const chunks = (
    db
      .prepare('SELECT id, note_id, ord, heading, text, embed_text FROM chunks ORDER BY note_id, ord')
      .all() as {
      id: string
      note_id: string
      ord: number
      heading: string | null
      text: string
      embed_text: string
    }[]
  ).map((c) => ({
    id: c.id,
    noteId: c.note_id,
    ord: c.ord,
    heading: c.heading,
    text: c.text,
    embedText: c.embed_text,
  }))

  const stored = new Map(
    (
      db
        .prepare('SELECT chunk_id, dim, vector FROM embeddings WHERE model = ?')
        .all(vectorKey(model.id, runtime)) as {
        chunk_id: string
        dim: number
        vector: Uint8Array
      }[]
    ).map((r) => [r.chunk_id, r]),
  )
  const vectors = new Float32Array(chunks.length * model.dims)
  chunks.forEach((c, i) => {
    const row = stored.get(c.id)
    if (!row) throw new Error(`Chunk ${c.id} has no ${model.id} vector: run the ingestion with that model.`)
    if (row.dim !== model.dims) throw new Error(`Chunk ${c.id} has ${row.dim} dimensions, not ${model.dims}.`)
    vectors.set(fromBlob(row.vector), i * model.dims)
  })
  return { format: 1, model, sourceHash, notes, links, chunks, vectors, queries }
}
