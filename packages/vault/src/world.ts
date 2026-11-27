// The world file: the source of truth of the example vault. Every note of `examples/tarnwick/vault`
// is rendered from one entity of `world.yaml`, so the notes, their typed links and the expected
// sources of the evaluation questions all come from one place and can't drift apart.
import { parse as parseYaml } from 'yaml'

import {
  FRONTMATTER_RELATIONS,
  isIsoDate,
  isNoteId,
  NOTE_TYPES,
  type Link,
  type NoteId,
  type NoteType,
} from './index.js'
import { wikilinkTargets } from './parse.js'

type FrontmatterRelation = (typeof FRONTMATTER_RELATIONS)[number]

/** The frontmatter relations each note type may carry. */
export const RELATIONS_BY_TYPE: Record<NoteType, readonly FrontmatterRelation[]> = {
  person: ['reports_to'],
  project: ['owner', 'customer'],
  customer: ['owner'],
  meeting: ['attendees', 'customer'],
  decision: ['owner', 'decided_in', 'supersedes'],
  document: ['owner', 'customer', 'supersedes'],
}

/** The relations that hold a list of notes; the others hold one. */
const LIST_RELATIONS: ReadonlySet<FrontmatterRelation> = new Set(['attendees', 'supersedes'])

/** The folder of each note type inside the vault. */
export const FOLDERS: Record<NoteType, string> = {
  person: 'people',
  project: 'projects',
  customer: 'customers',
  meeting: 'meetings',
  decision: 'decisions',
  document: 'documents',
}

/** Extra frontmatter fields the app shows on a note (not relations, not embedded). */
export const EXTRA_FIELDS = ['role', 'segment', 'city'] as const

export interface WorldEntity {
  id: NoteId
  title: string
  aliases?: string[]
  created: string
  /** Defaults to `created`. */
  updated?: string
  status: string
  role?: string
  segment?: string
  city?: string
  owner?: NoteId
  customer?: NoteId
  reports_to?: NoteId
  decided_in?: NoteId
  attendees?: NoteId[]
  supersedes?: NoteId[]
  /** Markdown under the title, with `##` sections and `[[id|label]]` wikilinks. */
  body: string
}

export interface World {
  company: string
  /** The day the vault was "exported": no note is updated after it. */
  snapshot: string
  notes: Record<NoteType, WorldEntity[]>
}

/** The section of world.yaml that holds each type. */
const SECTIONS: Record<NoteType, string> = {
  person: 'people',
  project: 'projects',
  customer: 'customers',
  meeting: 'meetings',
  decision: 'decisions',
  document: 'documents',
}

const dateOf = (value: unknown): unknown => (value instanceof Date ? value.toISOString().slice(0, 10) : value)

/** Parses and checks world.yaml. Throws with every problem found. */
export function loadWorld(text: string): World {
  const raw = parseYaml(text) as Record<string, unknown>
  const problems: string[] = []
  const notes = {} as Record<NoteType, WorldEntity[]>
  for (const type of NOTE_TYPES) {
    const list = (raw[SECTIONS[type]] ?? []) as Record<string, unknown>[]
    notes[type] = list.map((e) => {
      const entity = { ...e } as unknown as WorldEntity
      entity.created = dateOf(e.created) as string
      if (e.updated !== undefined) entity.updated = dateOf(e.updated) as string
      return entity
    })
  }
  const world: World = { company: String(raw.company), snapshot: dateOf(raw.snapshot) as string, notes }
  problems.push(...checkWorld(world))
  if (problems.length > 0)
    throw new Error(`world.yaml has ${problems.length} problems:\n${problems.join('\n')}`)
  return world
}

export const entities = (world: World): (WorldEntity & { type: NoteType })[] =>
  NOTE_TYPES.flatMap((type) => world.notes[type].map((e) => ({ ...e, type })))

/** Every rule of the world: ids, dates, relations by type, targets that exist, time order. */
export function checkWorld(world: World): string[] {
  const problems: string[] = []
  const all = entities(world)
  const byId = new Map<string, WorldEntity & { type: NoteType }>()
  for (const e of all) {
    if (byId.has(e.id)) problems.push(`${e.id}: id used twice`)
    byId.set(e.id, e)
  }
  if (!isIsoDate(world.snapshot)) problems.push(`snapshot "${world.snapshot}" is not a date`)
  for (const e of all) {
    const at = `${e.type} ${e.id}`
    if (!isNoteId(e.id)) problems.push(`${at}: bad id`)
    if (typeof e.title !== 'string' || !e.title.trim()) problems.push(`${at}: no title`)
    if (typeof e.status !== 'string' || !e.status.trim()) problems.push(`${at}: no status`)
    if (typeof e.body !== 'string' || !e.body.trim()) problems.push(`${at}: no body`)
    const updated = e.updated ?? e.created
    if (!isIsoDate(e.created) || !isIsoDate(updated)) problems.push(`${at}: bad date`)
    else {
      if (updated < e.created) problems.push(`${at}: updated before created`)
      if (updated > world.snapshot) problems.push(`${at}: updated after the snapshot`)
    }
    for (const relation of FRONTMATTER_RELATIONS) {
      const value = e[relation]
      if (value === undefined) continue
      if (!RELATIONS_BY_TYPE[e.type].includes(relation))
        problems.push(`${at}: a ${e.type} has no ${relation}`)
      const targets = LIST_RELATIONS.has(relation) ? value : [value]
      if (!Array.isArray(targets)) {
        problems.push(`${at}: ${relation} must be a list`)
        continue
      }
      for (const t of targets as string[]) {
        const target = byId.get(t)
        if (!target) problems.push(`${at}: ${relation} → ${t}, which is not in the world`)
        else if (!fits(relation, target.type)) problems.push(`${at}: ${relation} → ${t}, a ${target.type}`)
        else if (relation === 'supersedes' && (target.updated ?? target.created) > e.created)
          problems.push(`${at}: supersedes ${t}, which is newer`)
      }
    }
    for (const t of wikilinkTargets(e.body))
      if (!byId.has(t)) problems.push(`${at}: body links to ${t}, which is not in the world`)
  }
  for (const e of world.notes.person) {
    const seen = new Set<string>([e.id])
    let boss = e.reports_to
    while (boss) {
      if (seen.has(boss)) {
        problems.push(`person ${e.id}: reports_to goes round in a circle`)
        break
      }
      seen.add(boss)
      boss = byId.get(boss)?.reports_to
    }
  }
  return problems
}

/** Which note types a relation may point at. */
function fits(relation: FrontmatterRelation, target: NoteType): boolean {
  switch (relation) {
    case 'owner':
    case 'attendees':
    case 'reports_to':
      return target === 'person'
    case 'customer':
      return target === 'customer'
    case 'decided_in':
      return target === 'meeting'
    case 'supersedes':
      return target === 'decision' || target === 'document'
  }
}

/** The typed links of the world, as the parser must read them back from the vault. */
export function worldLinks(world: World): Link[] {
  return entities(world).flatMap((e) => {
    const links: Link[] = []
    const seen = new Set<string>()
    const add = (to: string, relation: Link['relation']) => {
      if (to === e.id || seen.has(`${relation} ${to}`)) return
      seen.add(`${relation} ${to}`)
      links.push({ from: e.id, to, relation })
    }
    for (const relation of FRONTMATTER_RELATIONS) {
      const value = e[relation]
      if (value !== undefined) for (const to of Array.isArray(value) ? value : [value]) add(to, relation)
    }
    for (const to of wikilinkTargets(e.body)) add(to, 'mentions')
    return links
  })
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9 .,'&()/-]*$/
const scalar = (value: string): string =>
  SAFE.test(value) && !/^(yes|no|true|false|null|on|off)$/i.test(value) && !/: |#/.test(value)
    ? value
    : JSON.stringify(value)
const link = (id: string) => `"[[${id}]]"`

/** The Markdown of one note: frontmatter in a fixed field order, the title, then the body. */
export function renderNote(e: WorldEntity & { type: NoteType }): string {
  const lines = ['---', `id: ${e.id}`, `type: ${e.type}`]
  if (e.aliases?.length) lines.push(`aliases: [${e.aliases.map(scalar).join(', ')}]`)
  lines.push(`created: ${e.created}`, `updated: ${e.updated ?? e.created}`, `status: ${scalar(e.status)}`)
  for (const field of EXTRA_FIELDS) if (e[field]) lines.push(`${field}: ${scalar(e[field])}`)
  for (const relation of FRONTMATTER_RELATIONS) {
    const value = e[relation]
    if (value === undefined) continue
    if (Array.isArray(value)) {
      lines.push(`${relation}:`)
      for (const id of value) lines.push(`  - ${link(id)}`)
    } else lines.push(`${relation}: ${link(value)}`)
  }
  lines.push('---', '', `# ${e.title}`, '', e.body.trim(), '')
  return lines.join('\n')
}

/** The whole vault: vault path → file content, sorted by path. */
export function renderWorld(world: World): Map<string, string> {
  const files = entities(world)
    .map((e) => [`${FOLDERS[e.type]}/${e.id}.md`, renderNote(e)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return new Map(files)
}
