import type { Note } from '@graph-rag/vault'
import { describe, expect, it } from 'vitest'

import { decodeIndex, encodeIndex } from '@graph-rag/search'

import {
  chunkVault,
  exportIndex,
  ingest,
  noteHash,
  openIndex,
  readQuestions,
  sourceHash,
  type PassageEmbedder,
} from './index.js'

const note = (id: string, body: string, extra: Partial<Note> = {}): Note => ({
  id,
  type: 'document',
  title: id.replace(/-/g, ' '),
  aliases: [],
  created: '2026-01-01',
  updated: '2026-02-01',
  status: 'active',
  path: `documents/${id}.md`,
  body,
  links: [],
  ...extra,
})

/** A fake model: a 4-number vector from the text length, and a log of every text it embedded. */
function fakeEmbedder(id = 'fake-model'): PassageEmbedder & { seen: string[] } {
  const seen: string[] = []
  return {
    model: { id, dims: 4 },
    seen,
    async embedPassages(texts) {
      seen.push(...texts)
      return texts.map((t) =>
        Float32Array.from([1, t.length % 7, 0, 0]).map((x, _, a) => x / Math.hypot(...a)),
      )
    },
  }
}

const vault = () => [
  note('frame-spec', '# frame spec\n\nThe C27 frame is aluminium.\n\n## Joining\n\nWelded by [[welder]].'),
  note('welder', '# welder\n\nCalvane welds the frames.', { type: 'customer', aliases: ['Calvane Works'] }),
  note('kickoff', '# kickoff\n\nWe met.', {
    type: 'meeting',
    links: [
      { from: 'kickoff', to: 'welder', relation: 'customer' },
      { from: 'kickoff', to: 'nobody-yet', relation: 'attendees' },
    ],
  }),
]

const count = (db: ReturnType<typeof openIndex>, table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

describe('ingest', () => {
  it('writes notes, aliases, links, chunks and one vector per chunk', async () => {
    const db = openIndex()
    const embedder = fakeEmbedder()
    const notes = vault()
    notes[0]!.links = [{ from: 'frame-spec', to: 'welder', relation: 'mentions' }]
    const report = await ingest(db, notes, embedder)
    expect(report.notes).toEqual({ added: 3, updated: 0, removed: 0, unchanged: 0 })
    expect(report.chunks.added).toBe(4)
    expect(report.embedded).toBe(4)
    expect(count(db, 'notes')).toBe(3)
    expect(count(db, 'embeddings')).toBe(4)
    expect(db.prepare('SELECT alias, norm FROM aliases').all()).toEqual([
      { alias: 'Calvane Works', norm: 'calvane works' },
    ])
    expect(count(db, 'links')).toBe(3)
    // the linked note is named by its title in what gets embedded
    expect(embedder.seen).toContain('frame spec › Joining\n\nWelded by welder.')
  })

  it('re-processes only what changed: an edited note, a removed note, a new note', async () => {
    const db = openIndex()
    const embedder = fakeEmbedder()
    await ingest(db, vault(), embedder)
    embedder.seen.length = 0

    const again = await ingest(db, vault(), embedder)
    expect(again.notes.unchanged).toBe(3)
    expect(again.chunks.unchanged).toBe(4)
    expect(again.embedded).toBe(0)
    expect(embedder.seen).toEqual([])

    const edited = vault()
    edited[0]!.body = '# frame spec\n\nThe C27 frame is steel now.\n\n## Joining\n\nWelded by [[welder]].'
    edited.splice(2, 1) // kickoff removed
    edited.push(note('paint', '# paint\n\nMatte only.'))
    const report = await ingest(db, edited, embedder)
    expect(report.notes).toEqual({ added: 1, updated: 1, removed: 1, unchanged: 1 })
    expect(embedder.seen).toEqual(['frame spec\n\nThe C27 frame is steel now.', 'paint\n\nMatte only.'])
    expect(report.chunks).toEqual({ added: 1, updated: 1, removed: 1, unchanged: 2 })
    expect(count(db, 'notes')).toBe(3)
    // the removed note took its links and chunks with it
    expect(count(db, 'links')).toBe(0)
    expect(count(db, 'embeddings')).toBe(count(db, 'chunks'))
  })

  it('re-embeds a chunk whose note did not change when a linked title did', async () => {
    const db = openIndex()
    const embedder = fakeEmbedder()
    await ingest(db, vault(), embedder)
    embedder.seen.length = 0
    const renamed = vault()
    renamed[1]!.title = 'Calvane'
    await ingest(db, renamed, embedder)
    expect(embedder.seen).toContain('frame spec › Joining\n\nWelded by Calvane.')
  })

  it('drops chunks a shorter note no longer has, and updates a chunk whose heading alone changed', async () => {
    const db = openIndex()
    await ingest(db, vault())
    const shorter = vault()
    shorter[0]!.body = '# frame spec\n\nThe C27 frame is aluminium.'
    const report = await ingest(db, shorter)
    expect(report.chunks.removed).toBe(1)
    expect(count(db, 'chunks')).toBe(3)
  })

  it('embeds every chunk again for a second model, keeping the first', async () => {
    const db = openIndex()
    await ingest(db, vault(), fakeEmbedder('model-a'))
    const b = fakeEmbedder('model-b')
    const report = await ingest(db, vault(), b)
    expect(report.embedded).toBe(4)
    expect(count(db, 'embeddings')).toBe(8)
  })

  it('embeds every chunk again on another runtime, and exports only the vectors of that runtime', async () => {
    const db = openIndex()
    await ingest(db, vault(), fakeEmbedder('model-a'))
    const wasm = { ...fakeEmbedder('model-a'), runtime: 'wasm' }
    expect((await ingest(db, vault(), wasm)).embedded).toBe(4)
    expect((await ingest(db, vault(), wasm)).embedded).toBe(0)
    expect(count(db, 'embeddings')).toBe(8)
    const model = { id: 'model-a', revision: 'r', dims: 4 }
    expect(exportIndex(db, { model, sourceHash: 'h', runtime: 'wasm' }).chunks).toHaveLength(4)
    expect(() => exportIndex(db, { model, sourceHash: 'h', runtime: 'cpu' })).toThrow('has no model-a vector')
  })

  it('writes nothing when the model fails or returns the wrong shape', async () => {
    const db = openIndex()
    const failing: PassageEmbedder = {
      model: { id: 'x', dims: 4 },
      embedPassages: async () => {
        throw new Error('model down')
      },
    }
    await expect(ingest(db, vault(), failing)).rejects.toThrow('model down')
    expect(count(db, 'notes')).toBe(0)
    const short: PassageEmbedder = { model: { id: 'x', dims: 4 }, embedPassages: async () => [] }
    await expect(ingest(db, vault(), short)).rejects.toThrow(/0 vectors for 4 chunks/)
    const wide: PassageEmbedder = {
      model: { id: 'x', dims: 4 },
      embedPassages: async (t) => t.map(() => new Float32Array(3)),
    }
    await expect(ingest(db, vault(), wide)).rejects.toThrow(/3 dimensions, not 4/)
    expect(count(db, 'notes')).toBe(0)
  })

  it('rolls back the whole run when a write fails, and refuses duplicate ids', async () => {
    const db = openIndex()
    const bad = vault()
    bad[1]!.updated = '2025-01-01' // before created: the schema's CHECK refuses it
    await expect(ingest(db, bad)).rejects.toThrow()
    expect(count(db, 'notes')).toBe(0)
    await expect(ingest(db, [note('a', 'x'), note('a', 'y')])).rejects.toThrow(/Two notes have the id "a"/)
  })
})

describe('exportIndex', () => {
  it('exports what the search reads, round-tripping through the index file', async () => {
    const db = openIndex()
    await ingest(db, vault(), fakeEmbedder())
    const index = exportIndex(db, {
      model: { id: 'fake-model', revision: 'r1', dims: 4 },
      sourceHash: 'abc',
      queries: [{ id: 'q-001', question: 'Who welds?', vector: Float32Array.from([1, 0, 0, 0]) }],
    })
    expect(index.notes.map((n) => n.id)).toEqual(['frame-spec', 'kickoff', 'welder'])
    expect(index.notes.find((n) => n.id === 'welder')!.aliases).toEqual(['Calvane Works'])
    // the link to a note that doesn't exist is left out
    expect(index.links).toEqual([{ from: 'kickoff', to: 'welder', relation: 'customer' }])
    expect(index.chunks.map((c) => c.id)).toEqual(['frame-spec#0', 'frame-spec#1', 'kickoff#0', 'welder#0'])
    expect(index.vectors).toHaveLength(16)
    expect(decodeIndex(encodeIndex(index))).toEqual(index)
  })

  it('refuses a model with missing vectors or other dimensions', async () => {
    const db = openIndex()
    await ingest(db, vault(), fakeEmbedder())
    expect(() => exportIndex(db, { model: { id: 'other', revision: 'r', dims: 4 }, sourceHash: '' })).toThrow(
      /no other vector/,
    )
    expect(() =>
      exportIndex(db, { model: { id: 'fake-model', revision: 'r', dims: 8 }, sourceHash: '' }),
    ).toThrow(/4 dimensions, not 8/)
  })
})

describe('source hash', () => {
  const model = { id: 'm', revision: 'r' }
  const questions = [{ id: 'q-001', question: 'Who welds?' }]

  it('changes with any note, question or model, and not with the order of the notes', () => {
    const base = sourceHash(vault(), questions, model)
    expect(sourceHash([...vault()].reverse(), questions, model)).toBe(base)
    const edited = vault()
    edited[1]!.status = 'paused'
    expect(sourceHash(edited, questions, model)).not.toBe(base)
    expect(sourceHash(vault(), [{ id: 'q-001', question: 'Who welds now?' }], model)).not.toBe(base)
    expect(sourceHash(vault(), questions, { id: 'm', revision: 'r2' })).not.toBe(base)
    // vectors of another runtime are other vectors: the index is behind
    expect(sourceHash(vault(), questions, model, 'onnxruntime-web wasm')).not.toBe(base)
    expect(noteHash(vault()[0]!)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reads the id and text of each recorded question', () => {
    expect(
      readQuestions('questions:\n  - id: q-001\n    question: " Who welds? "\n    kind: fact\n'),
    ).toEqual(questions)
    expect(() => readQuestions('nothing: here')).toThrow(/no `questions` list/)
    expect(() => readQuestions('questions:\n  - id: q-001\n')).toThrow(/needs an id and a question/)
  })

  it('chunks a vault with linked notes named by title', () => {
    expect(chunkVault(vault()).map((c) => c.id)).toEqual([
      'frame-spec#0',
      'frame-spec#1',
      'welder#0',
      'kickoff#0',
    ])
  })
})
