import { DatabaseSync } from 'node:sqlite'

import { migrate } from './migrate.js'
import { MIGRATIONS } from './migrations.js'

/**
 * Opens (or creates) the index database at `file`, or in memory, with foreign keys on and the
 * schema migrated to the latest version.
 */
export function openIndex(file = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  migrate(db, MIGRATIONS)
  return db
}
