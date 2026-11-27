// The index schema: its rules live in the database (CHECKs, foreign keys, triggers), and every query
// the search makes on it uses an index.
import type { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { migrate, MIGRATIONS, openIndex } from './index.js'

const objects = (db: DatabaseSync) =>
  (
    db
      .prepare("SELECT type || ' ' || name AS o FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY o")
      .all() as { o: string }[]
  ).map((r) => r.o)

const note = (db: DatabaseSync, id: string, extra: Record<string, string> = {}) =>
  db
    .prepare(
      `INSERT INTO notes (id, type, title, created, updated, status, path, body, content_hash)
       VALUES (:id, :type, :title, :created, :updated, 'active', :path, :body, 'h')`,
    )
    .run({
      id,
      type: 'person',
      title: id,
      created: '2026-01-05',
      updated: '2026-03-01',
      path: `people/${id}.md`,
      body: 'Body.',
      ...extra,
    })

const chunk = (db: DatabaseSync, id: string, noteId: string, ord: number, text: string) =>
  db
    .prepare(
      `INSERT INTO chunks (id, note_id, ord, heading, text, embed_text, tokens)
       VALUES (?, ?, ?, 'Summary', ?, ?, 3)`,
    )
    .run(id, noteId, ord, text, `Title › Summary\n\n${text}`)

const plan = (db: DatabaseSync, sql: string) =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ')

describe('index schema', () => {
  it('creates notes, aliases, links, chunks with full-text search and embeddings, and drops them all', () => {
    const db = openIndex()
    expect(objects(db)).toEqual([
      'index aliases_norm',
      'index links_dst',
      'index notes_type_updated',
      'table aliases',
      'table chunks',
      'table chunks_fts',
      'table chunks_fts_config',
      'table chunks_fts_data',
      'table chunks_fts_docsize',
      'table chunks_fts_idx',
      'table embeddings',
      'table links',
      'table notes',
      'trigger chunks_ad',
      'trigger chunks_ai',
      'trigger chunks_au',
    ])
    for (let v = MIGRATIONS.length - 1; v >= 0; v--) migrate(db, MIGRATIONS, v)
    expect(objects(db)).toEqual([])
  })

  it('refuses a bad note: id, type, date order', () => {
    const db = openIndex()
    expect(() => note(db, 'Maya')).toThrow(/CHECK/)
    expect(() => note(db, 'maya_okafor')).toThrow(/CHECK/)
    expect(() => note(db, 'maya', { type: 'company' })).toThrow(/CHECK/)
    expect(() => note(db, 'maya', { created: '2026-04-01' })).toThrow(/CHECK/)
    expect(() => note(db, 'maya', { updated: '1 March' })).toThrow(/CHECK/)
    note(db, 'maya-okafor')
    expect(() => note(db, 'other', { path: 'people/maya-okafor.md' })).toThrow(/UNIQUE/)
  })

  it('keeps links typed, lets a link point at a missing note, and drops a note with its links, aliases and chunks', () => {
    const db = openIndex()
    note(db, 'maya-okafor')
    note(db, 'elena-brandt', { path: 'people/elena-brandt.md' })
    const link = db.prepare('INSERT INTO links (src, dst, relation) VALUES (?, ?, ?)')
    link.run('maya-okafor', 'elena-brandt', 'reports_to')
    link.run('maya-okafor', 'not-written-yet', 'mentions')
    expect(() => link.run('maya-okafor', 'elena-brandt', 'likes')).toThrow(/CHECK/)
    expect(() => link.run('maya-okafor', 'maya-okafor', 'mentions')).toThrow(/CHECK/)
    expect(() => link.run('ghost', 'maya-okafor', 'mentions')).toThrow(/FOREIGN KEY/)
    db.prepare('INSERT INTO aliases (note_id, alias, norm) VALUES (?, ?, ?)').run(
      'maya-okafor',
      'Maya',
      'maya',
    )
    chunk(db, 'maya-okafor#0', 'maya-okafor', 0, 'Head of product.')

    db.prepare('DELETE FROM notes WHERE id = ?').run('maya-okafor')
    for (const table of ['links', 'aliases', 'chunks'])
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
  })

  it('keeps the full-text index in step with the chunks through insert, update and delete', () => {
    const db = openIndex()
    note(db, 'dec-cells')
    chunk(db, 'dec-cells#0', 'dec-cells', 0, 'We move the cell order to a new supplier.')
    const hits = (q: string) =>
      (
        db
          .prepare(
            'SELECT c.id FROM chunks_fts f JOIN chunks c ON c.rowid = f.rowid WHERE chunks_fts MATCH ?',
          )
          .all(q) as { id: string }[]
      ).map((r) => r.id)
    expect(hits('supplier')).toEqual(['dec-cells#0'])
    expect(hits('ordering')).toEqual(['dec-cells#0']) // porter stemming: ordering → order
    db.prepare('UPDATE chunks SET text = ?, embed_text = ? WHERE id = ?').run(
      'Frames stay in aluminium.',
      'Frames stay in aluminium.',
      'dec-cells#0',
    )
    expect(hits('supplier')).toEqual([])
    expect(hits('aluminium')).toEqual(['dec-cells#0'])
    db.prepare('DELETE FROM chunks WHERE id = ?').run('dec-cells#0')
    expect(hits('aluminium')).toEqual([])
  })

  it('stores one Float32 vector per chunk and model, of the length its dimension says', () => {
    const db = openIndex()
    note(db, 'maya-okafor')
    chunk(db, 'maya-okafor#0', 'maya-okafor', 0, 'Head of product.')
    const put = db.prepare('INSERT INTO embeddings (chunk_id, model, dim, vector) VALUES (?, ?, ?, ?)')
    const vector = new Uint8Array(new Float32Array([0.5, -0.25, 1]).buffer)
    put.run('maya-okafor#0', 'bge-small-en-v1.5', 3, vector)
    put.run('maya-okafor#0', 'all-MiniLM-L6-v2', 3, vector)
    expect(() => put.run('maya-okafor#0', 'bge-small-en-v1.5', 3, vector)).toThrow(/UNIQUE|PRIMARY/)
    expect(() => put.run('maya-okafor#0', 'other', 4, vector)).toThrow(/CHECK/)
    expect(() => put.run('missing#0', 'other', 3, vector)).toThrow(/FOREIGN KEY/)
    expect(() => chunk(db, 'maya-okafor#7', 'maya-okafor', 1, 'Id and position disagree.')).toThrow(/CHECK/)
    db.prepare('DELETE FROM chunks').run()
    expect(db.prepare('SELECT COUNT(*) AS n FROM embeddings').get()).toEqual({ n: 0 })
  })

  it('answers the search queries from an index, never a full scan', () => {
    const db = openIndex()
    const queries = {
      'note by alias': "SELECT note_id FROM aliases WHERE norm = 'maya'",
      'outgoing links': "SELECT dst, relation FROM links WHERE src = 'maya-okafor'",
      'incoming links': "SELECT src, relation FROM links WHERE dst = 'maya-okafor'",
      'chunks of a note': "SELECT id, text FROM chunks WHERE note_id = 'maya-okafor' ORDER BY ord",
      'vectors of a model': "SELECT chunk_id, vector FROM embeddings WHERE model = 'bge-small-en-v1.5'",
      'newest notes of a type': "SELECT id FROM notes WHERE type = 'decision' ORDER BY updated DESC LIMIT 10",
      'changed notes': "SELECT content_hash FROM notes WHERE id = 'maya-okafor'",
    }
    for (const [name, sql] of Object.entries(queries)) {
      const detail = plan(db, sql)
      expect(detail, name).toMatch(/USING (COVERING |PRIMARY KEY|INDEX)|USING INTEGER PRIMARY KEY/)
      expect(detail, name).not.toMatch(/TEMP B-TREE/)
    }
  })
})
