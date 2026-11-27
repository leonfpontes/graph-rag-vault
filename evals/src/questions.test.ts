// The question set against the vault: every expected source exists and every trap holds in the notes,
// so the difficulty the set claims is real. The probe covers the four kinds of trap.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Note } from '@graph-rag/vault'
import { parseNote } from '@graph-rag/vault'
import { readVault } from '@graph-rag/vault/node'
import { describe, expect, it } from 'vitest'

import {
  checkQuestion,
  checkQuestions,
  loadQuestions,
  overlap,
  TRAP_KINDS,
  type CaseQuestion,
} from './questions.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const questions = loadQuestions(readFileSync(path.join(root, 'evals', 'questions.yaml'), 'utf8'))
const vault = readVault(path.join(root, 'examples', 'tarnwick', 'vault'))

describe('the question set', () => {
  it('is a fair test of the vault: sources exist and every trap holds', () => {
    expect(vault.problems).toEqual([])
    expect(checkQuestions(questions, vault.notes)).toEqual([])
  })

  it('has a probe of 5 questions: multi-hop, temporal and unanswerable, with all four traps', () => {
    const probe = questions.filter((q) => q.split === 'probe')
    expect(probe).toHaveLength(5)
    expect(probe.filter((q) => q.kind === 'multi-hop')).toHaveLength(2)
    expect(probe.filter((q) => q.kind === 'temporal')).toHaveLength(2)
    expect(probe.filter((q) => q.kind === 'unanswerable')).toHaveLength(1)
    expect([...new Set(probe.flatMap((q) => q.traps.map((t) => t.kind)))].sort()).toEqual(
      [...TRAP_KINDS].sort(),
    )
  })

  it('hides the bridge: the newer note of a vocabulary trap shares fewer words than the note it replaces', () => {
    const q = questions.find((x) => x.id === 'q-003')!
    const note = (id: string) => vault.notes.find((n) => n.id === id)!
    expect(overlap(q.question, note('dec-lifetime-frame-cover'))).toBeLessThan(
      overlap(q.question, note('doc-warranty-terms')),
    )
  })
})

const n = (id: string, fm: string, body = '') =>
  parseNote(`${id}.md`, `---\nid: ${id}\n${fm}\nstatus: current\n---\n# ${id.toUpperCase()}\n\n${body}\n`)
const NOTES: Note[] = [
  n('dec-old', 'type: decision\ncreated: 2026-01-01', 'The bike warranty lasts five years.'),
  n(
    'dec-new',
    'type: decision\ncreated: 2026-06-01\nsupersedes: ["[[dec-old]]"]\ndecided_in: "[[mtg-a]]"',
    'Cover for life.',
  ),
  n('mtg-a', 'type: meeting\ncreated: 2026-06-01\ncustomer: "[[cus-shop]]"'),
  n('cus-shop', 'type: customer\ncreated: 2025-01-01\naliases: [Shopco]', 'A dealer.'),
  n('doc-price', 'type: document\ncreated: 2026-01-01', 'Prices in GBP.'),
]
const q = (extra: Partial<CaseQuestion>): CaseQuestion => ({
  id: 'q-900',
  kind: 'temporal',
  split: 'dev',
  question: 'How long is the bike warranty?',
  expectedSources: ['dec-new'],
  traps: [],
  ...extra,
})

describe('checkQuestion', () => {
  it('accepts a question whose traps hold', () => {
    expect(
      checkQuestion(
        q({ traps: [{ kind: 'supersedes', newer: 'dec-new', older: 'dec-old', vocabulary: 'other' }] }),
        NOTES,
      ),
    ).toEqual([])
    expect(
      checkQuestion(
        q({
          kind: 'multi-hop',
          question: 'Which dealer was at the meeting of the newer decision?',
          expectedSources: ['dec-new', 'mtg-a', 'cus-shop'],
          traps: [
            {
              kind: 'bridge',
              from: 'dec-new',
              path: [
                { relation: 'decided_in', to: 'mtg-a' },
                { relation: 'customer', to: 'cus-shop' },
              ],
            },
          ],
        }),
        NOTES,
      ),
    ).toEqual([])
  })

  it('finds every kind of unfair question', () => {
    expect(checkQuestion(q({ expectedSources: ['dec-gone', 'dec-new', 'dec-new'] }), NOTES)).toEqual([
      'q-900: expected source dec-gone is not a note',
      'q-900: an expected source is listed twice',
    ])
    expect(checkQuestion(q({ kind: 'unanswerable' }), NOTES)).toEqual([
      'q-900: an unanswerable question has no sources',
    ])
    expect(checkQuestion(q({ expectedSources: [] }), NOTES)).toEqual(['q-900: no expected sources'])
    expect(checkQuestion(q({ kind: 'multi-hop' }), NOTES)).toEqual([
      'q-900: a multi-hop question needs 2 or more sources',
    ])
    expect(
      checkQuestion(
        q({
          question: 'Was Shopco at the MTG-A meeting?',
          expectedSources: ['dec-old', 'cus-shop'],
          traps: [{ kind: 'bridge', from: 'dec-old', path: [{ relation: 'customer', to: 'cus-shop' }] }],
        }),
        NOTES,
      ),
    ).toEqual([
      'q-900: no customer link between dec-old and cus-shop',
      'q-900: the question names cus-shop ("Shopco"), which the bridge should hide',
    ])
    expect(checkQuestion(q({ traps: [{ kind: 'bridge', from: 'dec-gone', path: [] }] }), NOTES)).toEqual([
      'q-900: bridge starts at dec-gone, which is not a note',
    ])
    expect(
      checkQuestion(
        q({ traps: [{ kind: 'bridge', from: 'dec-new', path: [{ relation: 'decided_in', to: 'mtg-a' }] }] }),
        NOTES,
      ),
    ).toEqual(['q-900: the bridge reaches dec-new, mtg-a, not the expected sources'])
    expect(
      checkQuestion(
        q({
          expectedSources: ['dec-old'],
          traps: [{ kind: 'supersedes', newer: 'dec-old', older: 'dec-new', vocabulary: 'same' }],
        }),
        NOTES,
      ),
    ).toEqual(['q-900: dec-old does not supersede dec-new', 'q-900: dec-old is not newer than dec-new'])
    expect(
      checkQuestion(
        q({
          question: 'How long is the cover for life?',
          expectedSources: ['dec-old'],
          traps: [{ kind: 'supersedes', newer: 'dec-new', older: 'dec-old', vocabulary: 'other' }],
        }),
        NOTES,
      ),
    ).toEqual([
      'q-900: the newer note dec-new is not an expected source',
      'q-900: the replaced note dec-old is an expected source',
      'q-900: dec-new shares as many words with the question as dec-old',
    ])
    expect(
      checkQuestion(
        q({ traps: [{ kind: 'supersedes', newer: 'dec-gone', older: 'dec-old', vocabulary: 'same' }] }),
        NOTES,
      ),
    ).toEqual(['q-900: supersedes trap names a missing note'])
  })

  it('checks aliases and the missing fact of a neighbour question', () => {
    expect(
      checkQuestion(q({ traps: [{ kind: 'alias', note: 'cus-shop', alias: 'Shopco' }] }), NOTES),
    ).toEqual(['q-900: the question does not use the alias "Shopco"'])
    expect(
      checkQuestion(
        q({
          question: 'Is CUS-SHOP the one called Shopz?',
          traps: [{ kind: 'alias', note: 'cus-shop', alias: 'Shopz' }],
        }),
        NOTES,
      ),
    ).toEqual(['q-900: cus-shop has no alias "Shopz"', 'q-900: the question names cus-shop by its title'])
    expect(checkQuestion(q({ traps: [{ kind: 'alias', note: 'cus-gone', alias: 'X' }] }), NOTES)).toEqual([
      'q-900: alias trap names cus-gone, which is not a note',
    ])
    const unanswerable = (absent: string[]) =>
      q({
        kind: 'unanswerable',
        question: 'What does the bike cost in Norway?',
        expectedSources: [],
        traps: [{ kind: 'neighbour', near: ['doc-price', 'doc-gone'], absent }],
      })
    expect(checkQuestion(unanswerable(['\\bNOK\\b']), NOTES)).toEqual([
      'q-900: neighbour doc-gone is not a note',
    ])
    expect(checkQuestion(unanswerable(['GBP']), NOTES)).toEqual([
      'q-900: neighbour doc-gone is not a note',
      'q-900: the vault has the fact after all: /GBP/ matches doc-price',
    ])
    expect(checkQuestion(q({ traps: [{ kind: 'neighbour', near: [], absent: [] }] }), NOTES)).toEqual([
      'q-900: a neighbour trap belongs to an unanswerable question',
    ])
  })

  it('finds a duplicate id in the set', () => {
    expect(checkQuestions([q({}), q({})], NOTES)).toEqual(['q-900: id used twice'])
  })
})

describe('loadQuestions', () => {
  it('refuses a malformed file', () => {
    const one = (yaml: string) => () => loadQuestions(`questions:\n  - ${yaml}\n`)
    expect(() => loadQuestions('nothing: here')).toThrow(/no `questions` list/)
    expect(one('{ id: Q1 }')).toThrow(/id must look like q-001/)
    expect(one('{ id: q-001, kind: trivia }')).toThrow(/unknown kind/)
    expect(one('{ id: q-001, kind: fact, split: train }')).toThrow(/unknown split/)
    expect(one('{ id: q-001, kind: fact, split: dev, question: " " }')).toThrow(/no question/)
    expect(one('{ id: q-001, kind: fact, split: dev, question: Q, expectedSources: a }')).toThrow(
      /must be a list/,
    )
    expect(
      one(
        '{ id: q-001, kind: fact, split: dev, question: Q, expectedSources: [], traps: [{ kind: trick }] }',
      ),
    ).toThrow(/every trap needs a kind/)
  })
})
