// The example vault against its world: every note is what world.yaml renders, the parser reads back
// exactly the links the world has, and the world keeps its own rules.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { NOTE_TYPES } from './index.js'
import {
  checkWorld,
  entities,
  FOLDERS,
  loadWorld,
  readVault,
  renderNote,
  renderWorld,
  vaultFiles,
  worldLinks,
  type World,
  type WorldEntity,
} from './node.js'

// The repository root is three folders up (packages/vault/src).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const example = path.join(root, 'examples', 'tarnwick')
const vaultDir = path.join(example, 'vault')
const world = loadWorld(readFileSync(path.join(example, 'world.yaml'), 'utf8'))
const vault = readVault(vaultDir)

const key = (l: { from: string; to: string; relation: string }) => `${l.from} ${l.relation} ${l.to}`

describe('the Tarnwick vault', () => {
  it('is exactly what world.yaml renders (run pnpm --filter @graph-rag/vault generate when this fails)', () => {
    const files = renderWorld(world)
    expect(vaultFiles(vaultDir)).toEqual([...files.keys()])
    for (const [file, text] of files) expect(readFileSync(path.join(vaultDir, file), 'utf8'), file).toBe(text)
  })

  it('reads with no problems: about 200 notes of all six types, no broken links', () => {
    expect(vault.problems).toEqual([])
    expect(vault.notes.length).toBeGreaterThanOrEqual(180)
    expect(vault.notes.length).toBeLessThanOrEqual(220)
    const count = (type: string) => vault.notes.filter((n) => n.type === type).length
    for (const type of NOTE_TYPES) expect(count(type), type).toBeGreaterThanOrEqual(15)
  })

  it('reads back every note as the world has it: type, title, aliases, dates, status and links', () => {
    const byId = new Map(vault.notes.map((n) => [n.id, n]))
    for (const e of entities(world)) {
      const note = byId.get(e.id)!
      expect(note, e.id).toMatchObject({
        type: e.type,
        title: e.title,
        aliases: e.aliases ?? [],
        created: e.created,
        updated: e.updated ?? e.created,
        status: e.status,
        path: `${FOLDERS[e.type]}/${e.id}.md`,
      })
    }
    expect(
      vault.notes
        .flatMap((n) => n.links)
        .map(key)
        .sort(),
    ).toEqual(worldLinks(world).map(key).sort())
  })

  it('has every relation, and old notes that newer ones replace', () => {
    const relations = new Set(worldLinks(world).map((l) => l.relation))
    expect([...relations].sort()).toEqual(
      ['attendees', 'customer', 'decided_in', 'mentions', 'owner', 'reports_to', 'supersedes'].sort(),
    )
    const superseded = worldLinks(world).filter((l) => l.relation === 'supersedes')
    expect(superseded.length).toBeGreaterThanOrEqual(6)
    // Some replaced notes still say "current": recency has to come from the dates, not the status.
    const stale = superseded.filter((l) => vault.notes.find((n) => n.id === l.to)!.status === 'current')
    expect(stale.length).toBeGreaterThanOrEqual(2)
  })

  it('names no real-looking contact detail: no e-mail addresses, phone numbers or web addresses', () => {
    for (const n of vault.notes) {
      expect(n.body, n.id).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i)
      expect(n.body, n.id).not.toMatch(/\+?\d[\d ()-]{8,}\d/)
      expect(n.body, n.id).not.toMatch(/https?:\/\/|www\./i)
    }
  })
})

describe('world rules', () => {
  const base = (): World => ({
    company: 'Test',
    snapshot: '2026-11-20',
    notes: {
      person: [
        { id: 'per-a', title: 'A', created: '2026-01-01', status: 'active', body: 'A.' },
        { id: 'per-b', title: 'B', created: '2026-01-01', status: 'active', reports_to: 'per-a', body: 'B.' },
      ],
      project: [],
      customer: [],
      meeting: [{ id: 'mtg-1', title: 'M', created: '2026-03-01', status: 'held', body: 'M.' }],
      decision: [
        {
          id: 'dec-old',
          title: 'Old',
          created: '2026-03-01',
          status: 'current',
          owner: 'per-a',
          body: 'Old.',
        },
        {
          id: 'dec-new',
          title: 'New',
          created: '2026-05-01',
          status: 'current',
          decided_in: 'mtg-1',
          supersedes: ['dec-old'],
          body: 'See [[per-b|B]].',
        },
      ],
      document: [],
    },
  })
  const edit = (change: (w: World) => void) => {
    const w = base()
    change(w)
    return checkWorld(w)
  }
  const decision = (w: World, id: string) => w.notes.decision.find((d) => d.id === id)! as WorldEntity

  it('accepts a consistent world', () => {
    expect(checkWorld(base())).toEqual([])
  })

  it('finds every kind of mistake', () => {
    expect(edit((w) => (decision(w, 'dec-new').owner = 'per-ghost'))).toEqual([
      'decision dec-new: owner → per-ghost, which is not in the world',
    ])
    expect(edit((w) => (decision(w, 'dec-new').owner = 'mtg-1'))).toEqual([
      'decision dec-new: owner → mtg-1, a meeting',
    ])
    expect(edit((w) => (w.notes.person[0]!.decided_in = 'mtg-1'))).toEqual([
      'person per-a: a person has no decided_in',
    ])
    expect(edit((w) => (decision(w, 'dec-old').created = '2026-06-01'))).toEqual([
      'decision dec-new: supersedes dec-old, which is newer',
    ])
    expect(edit((w) => (w.notes.person[0]!.reports_to = 'per-b'))).toEqual([
      'person per-a: reports_to goes round in a circle',
      'person per-b: reports_to goes round in a circle',
    ])
    expect(edit((w) => (decision(w, 'dec-new').updated = '2026-12-01'))).toEqual([
      'decision dec-new: updated after the snapshot',
    ])
    expect(edit((w) => (decision(w, 'dec-new').updated = '2026-04-01'))).toEqual([
      'decision dec-new: updated before created',
    ])
    expect(edit((w) => (decision(w, 'dec-new').body = 'See [[per-c]].'))).toEqual([
      'decision dec-new: body links to per-c, which is not in the world',
    ])
    expect(edit((w) => (decision(w, 'dec-new').supersedes = 'dec-old' as unknown as string[]))).toEqual([
      'decision dec-new: supersedes must be a list',
    ])
    expect(edit((w) => w.notes.person.push({ ...w.notes.person[0]! }))).toContain('per-a: id used twice')
    expect(
      edit((w) => {
        Object.assign(w.notes.person[0]!, { id: 'Per A', title: ' ', status: '', body: '', created: 'soon' })
      }),
    ).toEqual(
      expect.arrayContaining([
        'person Per A: bad id',
        'person Per A: no title',
        'person Per A: no status',
        'person Per A: no body',
        'person Per A: bad date',
      ]),
    )
  })

  it('loadWorld refuses a world with problems, listing them', () => {
    expect(() =>
      loadWorld(
        'company: X\nsnapshot: 2026-11-20\npeople:\n  - {id: per-a, title: A, created: 2026-01-01, status: a, body: b, reports_to: per-z}\n',
      ),
    ).toThrow(/1 problems:\nperson per-a: reports_to → per-z/)
  })

  it('renders quoted values only when YAML needs them', () => {
    const text = renderNote({
      type: 'meeting',
      id: 'mtg-x',
      title: 'Review · 1 Mar',
      aliases: ['yes', 'R&D', 'A: B'],
      created: '2026-03-01',
      status: 'held',
      attendees: ['per-a', 'per-b'],
      body: '## Notes\nText.',
    })
    expect(text).toContain('aliases: ["yes", R&D, "A: B"]')
    expect(text).toContain('attendees:\n  - "[[per-a]]"\n  - "[[per-b]]"')
    expect(text).toContain('---\n\n# Review · 1 Mar\n\n## Notes\nText.\n')
  })
})

describe('readVault', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'graph-rag-vault-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reports bad notes, duplicate ids and broken links instead of throwing', () => {
    writeFileSync(
      path.join(dir, 'a.md'),
      '---\nid: a\ntype: person\ncreated: 2026-01-01\nstatus: s\n---\n[[ghost]]\n',
    )
    writeFileSync(path.join(dir, 'b.md'), 'no frontmatter')
    mkdirSync(path.join(dir, 'sub'))
    writeFileSync(
      path.join(dir, 'sub/a.md'),
      '---\nid: a\ntype: person\ncreated: 2026-01-01\nstatus: s\n---\n',
    )
    writeFileSync(path.join(dir, 'notes.txt'), 'not a note')
    const read = readVault(dir)
    expect(read.notes.map((n) => n.id)).toEqual(['a'])
    expect(read.problems).toEqual([
      'b.md: no frontmatter between --- lines at the top',
      'sub/a.md: id "a" is also used by a.md',
      'broken link a → ghost (mentions)',
    ])
  })
})
