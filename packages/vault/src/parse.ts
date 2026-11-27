// Reads one Markdown note: YAML frontmatter between `---` lines, then the body. Typed relations are
// frontmatter fields named after the relation, holding a wikilink or a list of them; every wikilink in
// the body is a `mentions` link. No Node APIs here: the browser can parse a note too.
import { parse as parseYaml } from 'yaml'

import {
  FRONTMATTER_RELATIONS,
  isIsoDate,
  isNoteId,
  isNoteType,
  type Link,
  type Note,
  type NoteId,
} from './index.js'

/** A note that can't be read, with the path and every reason, so a whole vault reports at once. */
export class NoteError extends Error {
  constructor(
    readonly path: string,
    readonly problems: string[],
  ) {
    super(`${path}: ${problems.join('; ')}`)
    this.name = 'NoteError'
  }
}

/** `[[target]]`, `[[target|label]]` or `[[target#heading|label]]`; group 1 is the target. */
export const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const TITLE = /^#\s+(.+?)\s*#*\s*$/m

/** The targets of the wikilinks in a text, in order of appearance. */
export function wikilinkTargets(text: string): string[] {
  return [...text.matchAll(WIKILINK)].map((m) => m[1]!.trim())
}

/** The id a relation field points at: a single wikilink (`"[[maya-okafor]]"`) or a bare id. */
function targetOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  const links = wikilinkTargets(trimmed)
  if (links.length === 1 && trimmed.replace(WIKILINK, '') === '') return links[0]
  return isNoteId(trimmed) ? trimmed : undefined
}

const dateOf = (value: unknown): unknown =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : value

/**
 * Parses a note. `path` is its place in the vault with forward slashes; the file name (without
 * `.md`) must be the note id. Throws a NoteError listing every problem found.
 */
export function parseNote(path: string, text: string): Note {
  const problems: string[] = []
  const match = FRONTMATTER.exec(text)
  if (!match) throw new NoteError(path, ['no frontmatter between --- lines at the top'])
  let data: unknown
  try {
    data = parseYaml(match[1]!)
  } catch (e) {
    throw new NoteError(path, [`frontmatter is not valid YAML (${(e as Error).message.split('\n')[0]})`])
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new NoteError(path, ['frontmatter is not a mapping of fields'])
  const fm = data as Record<string, unknown>
  const body = text.slice(match[0].length).replace(/^(\r?\n)+/, '')

  const stem = path.split('/').pop()!.replace(/\.md$/, '')
  const id = fm.id ?? stem
  if (!isNoteId(id)) problems.push(`id "${String(id)}" is not lowercase words joined by hyphens`)
  else if (id !== stem) problems.push(`id "${id}" differs from the file name "${stem}"`)
  if (!isNoteType(fm.type)) problems.push(`type "${String(fm.type)}" is not one of the six note types`)
  const created = dateOf(fm.created)
  const updated = dateOf(fm.updated ?? fm.created)
  if (!isIsoDate(created)) problems.push(`created "${String(fm.created)}" is not a YYYY-MM-DD date`)
  if (!isIsoDate(updated)) problems.push(`updated "${String(fm.updated)}" is not a YYYY-MM-DD date`)
  if (isIsoDate(created) && isIsoDate(updated) && updated < created)
    problems.push(`updated ${updated} is before created ${created}`)
  if (typeof fm.status !== 'string' || fm.status.trim() === '') problems.push('status is missing')
  const aliases = fm.aliases ?? []
  if (!Array.isArray(aliases) || !aliases.every((a) => typeof a === 'string' && a.trim() !== ''))
    problems.push('aliases is not a list of names')

  const links: Link[] = []
  const seen = new Set<string>()
  const add = (to: NoteId, relation: Link['relation']) => {
    const key = `${relation} ${to}`
    if (to === id || seen.has(key)) return
    seen.add(key)
    links.push({ from: id as NoteId, to, relation })
  }
  for (const relation of FRONTMATTER_RELATIONS) {
    if (fm[relation] === undefined || fm[relation] === null) continue
    const values = Array.isArray(fm[relation]) ? (fm[relation] as unknown[]) : [fm[relation]]
    for (const value of values) {
      const to = targetOf(value)
      if (to === undefined || !isNoteId(to))
        problems.push(`${relation} "${String(value)}" is not a wikilink to a note id`)
      else add(to, relation)
    }
  }
  for (const to of wikilinkTargets(body)) {
    if (isNoteId(to)) add(to, 'mentions')
    else problems.push(`body links to "${to}", which is not a note id`)
  }

  if (problems.length > 0) throw new NoteError(path, problems)
  return {
    id: id as NoteId,
    type: fm.type as Note['type'],
    title: TITLE.exec(body)?.[1] ?? (id as string),
    aliases: (aliases as string[]).map((a) => a.trim()),
    created: created as string,
    updated: updated as string,
    status: (fm.status as string).trim(),
    path,
    body,
    links,
  }
}

/** Links whose target is not a note of the vault (broken wikilinks), as `from → to (relation)`. */
export function danglingLinks(notes: readonly Note[]): string[] {
  const ids = new Set(notes.map((n) => n.id))
  return notes.flatMap((n) =>
    n.links.filter((l) => !ids.has(l.to)).map((l) => `${l.from} → ${l.to} (${l.relation})`),
  )
}
