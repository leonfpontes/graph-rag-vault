// The Node side of the vault (`@graph-rag/vault/node`): reading a vault folder, and the world file
// that generates the example vault. Kept apart from the main entry so the browser never pulls in fs.
import { type Dirent, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { Note } from './index.js'
import { danglingLinks, NoteError, parseNote } from './parse.js'

export * from './world.js'

export interface VaultRead {
  /** Notes in path order. */
  notes: Note[]
  /** Every note that couldn't be read, duplicate ids and broken links, one line each. */
  problems: string[]
}

/** All `.md` files under `dir`, as vault paths with forward slashes, sorted. */
export function vaultFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort()
}

/** Reads every note of the vault in `dir`. Never throws on a bad note: it lands in `problems`. */
export function readVault(dir: string): VaultRead {
  const notes: Note[] = []
  const problems: string[] = []
  const byId = new Map<string, string>()
  for (const file of vaultFiles(dir)) {
    try {
      const note = parseNote(file, readFileSync(path.join(dir, file), 'utf8'))
      const other = byId.get(note.id)
      if (other) problems.push(`${file}: id "${note.id}" is also used by ${other}`)
      else {
        byId.set(note.id, file)
        notes.push(note)
      }
    } catch (e) {
      if (!(e instanceof NoteError)) throw e
      problems.push(e.message)
    }
  }
  problems.push(...danglingLinks(notes).map((l) => `broken link ${l}`))
  return { notes, problems }
}
