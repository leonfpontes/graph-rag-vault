// Schema migrations for the index database. Each one goes up and down, so a bad migration can be
// rolled back; the database records its version in PRAGMA user_version. The schema itself (notes,
// links, chunks, embeddings) lives in ./migrations.ts.
import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  /** 1, 2, 3… with no gaps: the version the database is at after `up`. */
  version: number
  name: string
  up: string
  down: string
}

export const schemaVersion = (db: DatabaseSync): number =>
  Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)

/** Checks the list before touching a database: versions 1..n in order. */
export function checkMigrations(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1)
      throw new Error(
        `Migration "${m.name}" has version ${m.version}; expected ${i + 1} (1, 2, 3… in order).`,
      )
  })
}

/**
 * Moves the database to `target` (default: the last migration), up or down, one migration per
 * transaction. A failing migration rolls back and leaves the database at the previous version.
 */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[],
  target = migrations.length,
): number {
  checkMigrations(migrations)
  if (!Number.isInteger(target) || target < 0 || target > migrations.length)
    throw new Error(`Target version ${target} is outside 0..${migrations.length}.`)
  let current = schemaVersion(db)
  if (current > migrations.length)
    throw new Error(`The database is at version ${current}, newer than this code (${migrations.length}).`)
  while (current !== target) {
    const up = current < target
    const m = migrations[up ? current : current - 1]!
    const next = up ? current + 1 : current - 1
    db.exec('BEGIN')
    try {
      db.exec(up ? m.up : m.down)
      db.exec(`PRAGMA user_version = ${next}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw new Error(
        `Migration ${m.version} "${m.name}" failed going ${up ? 'up' : 'down'}: ${(e as Error).message}`,
        { cause: e },
      )
    }
    current = next
  }
  return current
}
