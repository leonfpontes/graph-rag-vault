// The index schema, in order. Empty until the schema story (notes, links, chunks, embeddings) adds
// version 1; every entry needs a `down` that undoes its `up` (tested in migrate.test.ts).
import type { Migration } from './migrate.js'

export const MIGRATIONS: readonly Migration[] = []
