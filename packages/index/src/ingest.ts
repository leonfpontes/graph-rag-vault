// Ingestion: the vault's notes into the index database, re-processing only what changed. Chunking
// is cheap, so every note is chunked on every run; embedding is the expensive part, so only chunks
// whose embedded text is new or different (or that have no vector for this model yet) go to the
// model. A note whose file didn't change keeps its rows. One transaction writes everything, after
// the embeddings are computed, so a failing model call leaves the database as it was.
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import { toBlob } from '@graph-rag/search'
import type { Note } from '@graph-rag/vault'

import { type Chunk, CHUNK_TOKENS, chunkNote } from './chunk.js'

/** What ingestion needs from an embedder (`@graph-rag/embeddings`, or a fake in tests). */
export interface PassageEmbedder {
  model: { id: string; dims: number }
  /** Where the vectors are computed: vectors of two runtimes are stored apart and never mixed. */
  runtime?: string
  embedPassages(texts: readonly string[]): Promise<Float32Array[]>
}

/** The `embeddings.model` key: the model id and, when known, the runtime that made the vector. */
export const vectorKey = (modelId: string, runtime?: string) => (runtime ? `${modelId} ${runtime}` : modelId)

export interface IngestReport {
  notes: { added: number; updated: number; removed: number; unchanged: number }
  chunks: { added: number; updated: number; removed: number; unchanged: number }
  /** Chunks sent to the model in this run. */
  embedded: number
}

/** Bumped when the chunker changes its output, so every index built before is stale. */
export const CHUNKER_VERSION = 1

/** Hash of everything a note row holds: a change in any field re-indexes the note. */
export function noteHash(note: Note): string {
  const { id, type, title, aliases, created, updated, status, path, body, links } = note
  return sha256(JSON.stringify({ id, type, title, aliases, created, updated, status, path, body, links }))
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** Lowercase words, as the graph search compares names. */
export const normName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** The chunks of every note, with linked notes named by their titles. */
export function chunkVault(notes: readonly Note[]): Chunk[] {
  const titles = new Map(notes.map((n) => [n.id, n.title]))
  return notes.flatMap((n) => chunkNote(n, { maxTokens: CHUNK_TOKENS, titleOf: (id) => titles.get(id) }))
}

interface ChunkRow {
  id: string
  note_id: string
  ord: number
  heading: string | null
  text: string
  embed_text: string
}

export async function ingest(
  db: DatabaseSync,
  notes: readonly Note[],
  embedder?: PassageEmbedder,
): Promise<IngestReport> {
  const report: IngestReport = {
    notes: { added: 0, updated: 0, removed: 0, unchanged: 0 },
    chunks: { added: 0, updated: 0, removed: 0, unchanged: 0 },
    embedded: 0,
  }
  const ids = new Set<string>()
  for (const n of notes) {
    if (ids.has(n.id)) throw new Error(`Two notes have the id "${n.id}".`)
    ids.add(n.id)
  }

  const storedNotes = new Map(
    (db.prepare('SELECT id, content_hash FROM notes').all() as { id: string; content_hash: string }[]).map(
      (r) => [r.id, r.content_hash],
    ),
  )
  const storedChunks = new Map(
    (
      db
        .prepare('SELECT id, note_id, ord, heading, text, embed_text FROM chunks')
        .all() as unknown as ChunkRow[]
    ).map((r) => [r.id, r]),
  )
  const vectored = new Set(
    embedder
      ? (
          db
            .prepare('SELECT chunk_id FROM embeddings WHERE model = ?')
            .all(vectorKey(embedder.model.id, embedder.runtime)) as {
            chunk_id: string
          }[]
        ).map((r) => r.chunk_id)
      : [],
  )

  const changedNotes = notes.filter((n) => storedNotes.get(n.id) !== noteHash(n))
  const removedNotes = [...storedNotes.keys()].filter((id) => !ids.has(id))
  const chunks = chunkVault(notes)
  const chunkIds = new Set(chunks.map((c) => c.id))
  const changedChunks = chunks.filter((c) => {
    const old = storedChunks.get(c.id)
    return !old || old.embed_text !== c.embedText || old.text !== c.text || old.heading !== c.heading
  })
  const changedIds = new Set(changedChunks.map((c) => c.id))
  const textChanged = new Set(
    changedChunks.filter((c) => storedChunks.get(c.id)?.embed_text !== c.embedText).map((c) => c.id),
  )
  const toEmbed = embedder ? chunks.filter((c) => textChanged.has(c.id) || !vectored.has(c.id)) : []

  // The model runs before any write: if it fails, nothing changes.
  const vectors = toEmbed.length > 0 ? await embedder!.embedPassages(toEmbed.map((c) => c.embedText)) : []
  if (vectors.length !== toEmbed.length)
    throw new Error(`The embedder returned ${vectors.length} vectors for ${toEmbed.length} chunks.`)
  vectors.forEach((v, i) => {
    if (v.length !== embedder!.model.dims)
      throw new Error(`Chunk ${toEmbed[i]!.id} got ${v.length} dimensions, not ${embedder!.model.dims}.`)
  })

  const run = (sql: string, ...params: (string | number | null | Uint8Array)[]) =>
    db.prepare(sql).run(...params)
  db.exec('BEGIN')
  try {
    for (const id of removedNotes) run('DELETE FROM notes WHERE id = ?', id)
    for (const n of changedNotes) {
      const fields = [n.type, n.title, n.created, n.updated, n.status, n.path, n.body, noteHash(n)] as const
      if (storedNotes.has(n.id)) {
        run(
          'UPDATE notes SET type = ?, title = ?, created = ?, updated = ?, status = ?, path = ?, body = ?, content_hash = ? WHERE id = ?',
          ...fields,
          n.id,
        )
        run('DELETE FROM aliases WHERE note_id = ?', n.id)
        run('DELETE FROM links WHERE src = ?', n.id)
      } else
        run(
          'INSERT INTO notes (type, title, created, updated, status, path, body, content_hash, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ...fields,
          n.id,
        )
      const norms = new Set<string>()
      for (const alias of n.aliases) {
        const norm = normName(alias)
        if (!norm || norms.has(norm)) continue
        norms.add(norm)
        run('INSERT INTO aliases (note_id, alias, norm) VALUES (?, ?, ?)', n.id, alias, norm)
      }
      for (const l of n.links)
        run('INSERT OR IGNORE INTO links (src, dst, relation) VALUES (?, ?, ?)', n.id, l.to, l.relation)
    }

    for (const [id, row] of storedChunks)
      if (!chunkIds.has(id) && ids.has(row.note_id)) {
        run('DELETE FROM chunks WHERE id = ?', id)
        report.chunks.removed++
      } else if (!ids.has(row.note_id)) report.chunks.removed++ // went with its note
    for (const c of chunks) {
      const tokens = Math.max(1, Math.ceil(c.tokens))
      if (!storedChunks.has(c.id)) {
        run(
          'INSERT INTO chunks (id, note_id, ord, heading, text, embed_text, tokens) VALUES (?, ?, ?, ?, ?, ?, ?)',
          c.id,
          c.noteId,
          c.ord,
          c.heading,
          c.text,
          c.embedText,
          tokens,
        )
        report.chunks.added++
      } else if (changedIds.has(c.id)) {
        run(
          'UPDATE chunks SET heading = ?, text = ?, embed_text = ?, tokens = ? WHERE id = ?',
          c.heading,
          c.text,
          c.embedText,
          tokens,
          c.id,
        )
        // Vectors of every model were made from the old text.
        if (textChanged.has(c.id)) run('DELETE FROM embeddings WHERE chunk_id = ?', c.id)
        report.chunks.updated++
      } else report.chunks.unchanged++
    }

    toEmbed.forEach((c, i) =>
      run(
        'INSERT INTO embeddings (chunk_id, model, dim, vector) VALUES (?, ?, ?, ?)',
        c.id,
        vectorKey(embedder!.model.id, embedder!.runtime),
        embedder!.model.dims,
        toBlob(vectors[i]!),
      ),
    )
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  report.notes.removed = removedNotes.length
  for (const n of changedNotes) report.notes[storedNotes.has(n.id) ? 'updated' : 'added']++
  report.notes.unchanged = notes.length - changedNotes.length
  report.embedded = toEmbed.length
  return report
}
