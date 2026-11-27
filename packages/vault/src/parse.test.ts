import { describe, expect, it } from 'vitest'

import { danglingLinks, NoteError, parseNote, wikilinkTargets } from './index.js'

const NOTE = `---
id: dec-switch-cells
type: decision
aliases: [Cell switch]
created: 2026-10-02
updated: 2026-10-03
status: current
role: ignored by the parser
owner: "[[per-priya-raman]]"
decided_in: "[[mtg-supply-review]]"
supersedes:
  - "[[dec-keep-cells]]"
---

# Switch the cells

## Decision
Agreed with [[per-tomas-lindqvist|Tomás]] and [[per-priya-raman]]; see [[doc-spec#Pack|the spec]].
`

const errorsOf = (path: string, text: string): string[] => {
  try {
    parseNote(path, text)
  } catch (e) {
    if (e instanceof NoteError) return e.problems
    throw e
  }
  return []
}

describe('parseNote', () => {
  it('reads the frontmatter, the title and every link, typed or from the body', () => {
    const note = parseNote('decisions/dec-switch-cells.md', NOTE)
    expect(note).toMatchObject({
      id: 'dec-switch-cells',
      type: 'decision',
      title: 'Switch the cells',
      aliases: ['Cell switch'],
      created: '2026-10-02',
      updated: '2026-10-03',
      status: 'current',
      path: 'decisions/dec-switch-cells.md',
    })
    expect(note.body.startsWith('# Switch the cells')).toBe(true)
    expect(note.links).toEqual([
      { from: 'dec-switch-cells', to: 'per-priya-raman', relation: 'owner' },
      { from: 'dec-switch-cells', to: 'mtg-supply-review', relation: 'decided_in' },
      { from: 'dec-switch-cells', to: 'dec-keep-cells', relation: 'supersedes' },
      { from: 'dec-switch-cells', to: 'per-tomas-lindqvist', relation: 'mentions' },
      { from: 'dec-switch-cells', to: 'per-priya-raman', relation: 'mentions' },
      { from: 'dec-switch-cells', to: 'doc-spec', relation: 'mentions' },
    ])
  })

  it('defaults: id from the file name, updated from created, no aliases, title from the id', () => {
    const note = parseNote(
      'people/per-ana.md',
      '---\ntype: person\ncreated: 2026-01-02\nstatus: active\nreports_to: per-elena\n---\nNo heading here.\n',
    )
    expect(note).toMatchObject({ id: 'per-ana', updated: '2026-01-02', aliases: [], title: 'per-ana' })
    expect(note.links).toEqual([{ from: 'per-ana', to: 'per-elena', relation: 'reports_to' }])
  })

  it('takes dates written as YAML timestamps too', () => {
    const note = parseNote(
      'x.md',
      '---\nid: x\ntype: person\ncreated: !!timestamp 2026-01-02\nupdated: !!timestamp 2026-02-03\nstatus: a\n---\n# X\n',
    )
    expect([note.created, note.updated]).toEqual(['2026-01-02', '2026-02-03'])
  })

  it('lists every problem of a bad note at once', () => {
    expect(errorsOf('people/Bad_Id.md', 'no frontmatter')).toEqual([
      'no frontmatter between --- lines at the top',
    ])
    expect(errorsOf('a.md', '---\n: : bad\n  - [\n---\n')).toEqual([
      expect.stringMatching(/^frontmatter is not valid YAML/),
    ])
    expect(errorsOf('a.md', '---\n- a list\n---\n')).toEqual(['frontmatter is not a mapping of fields'])
    expect(
      errorsOf(
        'people/per-ana.md',
        `---
id: per-anna
type: company
created: 2026-13-01
updated: someday
aliases: Ana
owner: "Maya Okafor"
supersedes: ["[[dec-a]] and [[dec-b]]"]
---
Talks to [[Maya Okafor]].
`,
      ),
    ).toEqual([
      'id "per-anna" differs from the file name "per-ana"',
      'type "company" is not one of the six note types',
      'created "2026-13-01" is not a YYYY-MM-DD date',
      'updated "someday" is not a YYYY-MM-DD date',
      'status is missing',
      'aliases is not a list of names',
      'owner "Maya Okafor" is not a wikilink to a note id',
      'supersedes "[[dec-a]] and [[dec-b]]" is not a wikilink to a note id',
      'body links to "Maya Okafor", which is not a note id',
    ])
    expect(
      errorsOf('Bad_Id.md', '---\ntype: person\ncreated: 2026-02-01\nupdated: 2026-01-01\nstatus: a\n---\n'),
    ).toEqual([
      'id "Bad_Id" is not lowercase words joined by hyphens',
      'updated 2026-01-01 is before created 2026-02-01',
    ])
  })

  it('drops a link to the note itself and repeats of the same link', () => {
    const note = parseNote(
      'a.md',
      '---\nid: a\ntype: person\ncreated: 2026-01-01\nstatus: s\n---\nSee [[a]], [[b]] and [[b|B]].\n',
    )
    expect(note.links).toEqual([{ from: 'a', to: 'b', relation: 'mentions' }])
  })
})

describe('wikilinks', () => {
  it('finds the target of every form', () => {
    expect(wikilinkTargets('[[a]] [[b|B]] [[c#Part]] [[ d #x|D ]] [x](y)')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reports links to notes that are not in the vault', () => {
    const a = parseNote(
      'a.md',
      '---\nid: a\ntype: person\ncreated: 2026-01-01\nstatus: s\n---\n[[b]] [[ghost]]\n',
    )
    const b = parseNote('b.md', '---\nid: b\ntype: person\ncreated: 2026-01-01\nstatus: s\n---\n')
    expect(danglingLinks([a, b])).toEqual(['a → ghost (mentions)'])
  })
})
