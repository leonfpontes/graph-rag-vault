// The vault's contract: what a note is once it has been read. The vault itself (examples/, generated
// from a world file) and the parser fill it; the index, the search and the app only read it.

/** Every note has one type. It decides its shape and color in the app and the fields it may link. */
export const NOTE_TYPES = ['person', 'project', 'decision', 'meeting', 'document', 'customer'] as const
export type NoteType = (typeof NOTE_TYPES)[number]

/**
 * How two notes are linked. Typed relations come from frontmatter fields with the same name;
 * `mentions` comes from a wikilink in the body. `supersedes` points from the newer note to the older.
 */
export const RELATIONS = [
  'owner',
  'attendees',
  'decided_in',
  'customer',
  'supersedes',
  'reports_to',
  'mentions',
] as const
export type Relation = (typeof RELATIONS)[number]

/** The relations written in frontmatter (all but `mentions`). */
export const FRONTMATTER_RELATIONS = RELATIONS.filter(
  (r): r is Exclude<Relation, 'mentions'> => r !== 'mentions',
)

/** A note id: lowercase words joined by hyphens, unique in the vault (`maya-okafor`, `dec-0042`). */
export type NoteId = string

export interface Link {
  from: NoteId
  to: NoteId
  relation: Relation
}

export interface Note {
  id: NoteId
  type: NoteType
  /** The first heading, or the id when there is none. */
  title: string
  /** Other names the note answers to (a nickname, an acronym): the graph-only search starts here. */
  aliases: string[]
  /** ISO dates (YYYY-MM-DD). `updated` drives recency in every search variant. */
  created: string
  updated: string
  /** Lifecycle word from the frontmatter, such as `active` or `superseded`. */
  status: string
  /** Path inside the vault, with forward slashes (`people/maya-okafor.md`). */
  path: string
  /** Markdown body without the frontmatter. */
  body: string
  /** Outgoing links of this note, typed. */
  links: Link[]
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export const isNoteId = (value: unknown): value is NoteId => typeof value === 'string' && ID.test(value)
export const isNoteType = (value: unknown): value is NoteType =>
  (NOTE_TYPES as readonly unknown[]).includes(value)
export const isRelation = (value: unknown): value is Relation =>
  (RELATIONS as readonly unknown[]).includes(value)
/** A real calendar date in ISO form (2026-02-30 is not). */
export const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  DATE.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

export { danglingLinks, NoteError, parseNote, WIKILINK, wikilinkTargets } from './parse.js'
