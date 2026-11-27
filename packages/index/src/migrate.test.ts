import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterAll, describe, expect, it } from 'vitest'

import { checkMigrations, migrate, MIGRATIONS, openIndex, schemaVersion, type Migration } from './index.js'

const sample: Migration[] = [
  { version: 1, name: 'notes', up: 'CREATE TABLE notes (id TEXT PRIMARY KEY)', down: 'DROP TABLE notes' },
  {
    version: 2,
    name: 'links',
    up: 'CREATE TABLE links (src TEXT NOT NULL REFERENCES notes(id), dst TEXT NOT NULL)',
    down: 'DROP TABLE links',
  },
]
const tables = (db: DatabaseSync) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string
    }[]
  ).map((t) => t.name)

const dir = mkdtempSync(path.join(tmpdir(), 'graph-rag-index-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('migrations', () => {
  it('goes up to the latest version and back down to any version', () => {
    const db = new DatabaseSync(':memory:')
    expect(migrate(db, sample)).toBe(2)
    expect(tables(db)).toEqual(['links', 'notes'])
    expect(migrate(db, sample, 1)).toBe(1)
    expect(tables(db)).toEqual(['notes'])
    expect(migrate(db, sample, 0)).toBe(0)
    expect(tables(db)).toEqual([])
    expect(migrate(db, sample)).toBe(2) // up again: every down really undid its up
  })

  it('rolls back a failing migration and keeps the previous version', () => {
    const db = new DatabaseSync(':memory:')
    const broken = [...sample, { version: 3, name: 'broken', up: 'CREATE TABLE x (; nonsense', down: '' }]
    expect(() => migrate(db, broken)).toThrow(/Migration 3 "broken" failed going up/)
    expect(schemaVersion(db)).toBe(2)
    expect(tables(db)).toEqual(['links', 'notes'])
  })

  it('refuses gaps, targets out of range and a database newer than the code', () => {
    expect(() => checkMigrations([{ ...sample[0]!, version: 2 }])).toThrow(/expected 1/)
    const db = new DatabaseSync(':memory:')
    expect(() => migrate(db, sample, 3)).toThrow(/outside 0..2/)
    expect(() => migrate(db, sample, 1.5)).toThrow(/outside/)
    migrate(db, sample)
    expect(() => migrate(db, sample.slice(0, 1))).toThrow(/newer than this code/)
  })

  it('has a reversible schema: every migration of the index goes up, down and up again', () => {
    const db = new DatabaseSync(':memory:')
    expect(migrate(db, MIGRATIONS)).toBe(MIGRATIONS.length)
    expect(migrate(db, MIGRATIONS, 0)).toBe(0)
    expect(tables(db)).toEqual([])
    expect(migrate(db, MIGRATIONS)).toBe(MIGRATIONS.length)
  })
})

describe('openIndex', () => {
  it('opens a file database migrated, with foreign keys on', () => {
    const db = openIndex(path.join(dir, 'index.sqlite'))
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1)
    expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal')
    db.close()
    expect(schemaVersion(openIndex())).toBe(MIGRATIONS.length)
  })
})
