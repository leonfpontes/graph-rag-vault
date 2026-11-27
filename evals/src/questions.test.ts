// The question set against the vault: every expected source exists and every trap holds in the notes,
// so the difficulty the set claims is real. The probe covers the four kinds of trap.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Note } from '@graph-rag/vault'
import { parseNote } from '@graph-rag/vault'
import { readVault } from '@graph-rag/vault/node'
import { describe, expect, it } from 'vitest'

import { checkQuestion, checkQuestions, loadQuestions, overlap, type CaseQuestion } from './questions.js'

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
    const kinds = new Set<string>(probe.flatMap((q) => q.traps.map((t) => t.kind)))
    for (const kind of ['bridge', 'supersedes', 'alias', 'neighbour'])
      expect(kinds.has(kind), kind).toBe(true)
  })

  it('has 50 questions in the planned mix: 10 to tune (the probe among them) and 40 for the scoreboard', () => {
    expect(questions).toHaveLength(50)
    expect(questions.map((q) => q.id)).toEqual(questions.map((_, i) => `q-${String(i + 1).padStart(3, '0')}`))
    const mix = (splits: string[]) =>
      Object.fromEntries(
        ['fact', 'multi-hop', 'temporal', 'unanswerable'].map((kind) => [
          kind,
          questions.filter((q) => splits.includes(q.split) && q.kind === kind).length,
        ]),
      )
    expect(mix(['probe', 'dev'])).toEqual({ fact: 2, 'multi-hop': 4, temporal: 3, unanswerable: 1 })
    expect(mix(['test'])).toEqual({ fact: 8, 'multi-hop': 14, temporal: 11, unanswerable: 7 })
  })

  it('leans on two-hop questions, where the hybrid search is weakest', () => {
    const test = questions.filter((q) => q.split === 'test' && q.kind === 'multi-hop')
    const twoHop = test.filter((q) => q.traps.some((t) => t.kind === 'bridge' && t.path.length === 2))
    expect(twoHop.length).toBeGreaterThanOrEqual(12)
  })

  it('never repeats a tuning question in the scoreboard', () => {
    const norm = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    const tuning = new Set(questions.filter((q) => q.split !== 'test').map((q) => norm(q.question)))
    for (const q of questions.filter((x) => x.split === 'test'))
      expect(tuning.has(norm(q.question)), q.id).toBe(false)
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
/** A question to check; evidence defaults to its first expected source, so each test shows one problem. */
const q = (extra: Partial<CaseQuestion>): CaseQuestion => {
  const question: CaseQuestion = {
    id: 'q-900',
    kind: 'fact',
    split: 'dev',
    question: 'How long is the bike warranty?',
    expectedSources: ['dec-new'],
    traps: [],
    evidence: [],
    ...extra,
  }
  if (!('evidence' in extra))
    question.evidence = question.expectedSources.slice(0, 1).map((note) => ({ note, contains: '.' }))
  return question
}

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
      'q-900: an unanswerable question needs a neighbour trap',
    ])
    expect(checkQuestion(q({ expectedSources: [] }), NOTES)).toEqual([
      'q-900: no expected sources',
      'q-900: no evidence that the answer is in the notes',
    ])
    expect(checkQuestion(q({ kind: 'multi-hop' }), NOTES)).toEqual([
      'q-900: a multi-hop question needs 2 or more sources',
      'q-900: a multi-hop question needs a bridge trap',
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
      checkQuestion(
        q({ kind: 'fact', traps: [{ kind: 'alias', note: 'cus-shop', alias: 'Shopco' }] }),
        NOTES,
      ),
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

  it('checks the evidence and the newest note', () => {
    expect(checkQuestion(q({ evidence: [] }), NOTES)).toEqual([
      'q-900: no evidence that the answer is in the notes',
    ])
    expect(
      checkQuestion(
        q({
          evidence: [
            { note: 'dec-old', contains: 'five years' },
            { note: 'dec-new', contains: 'ten years' },
          ],
        }),
        NOTES,
      ),
    ).toEqual([
      'q-900: evidence note dec-old is not an expected source',
      'q-900: dec-new does not contain /ten years/',
    ])
    expect(checkQuestion(q({ kind: 'temporal' }), NOTES)).toEqual([
      'q-900: a temporal question needs a supersedes or newest trap',
    ])
    expect(
      checkQuestion(
        q({
          expectedSources: ['dec-old'],
          evidence: [],
          traps: [{ kind: 'newest', newest: 'dec-new', among: ['dec-old'] }],
        }),
        NOTES,
      ),
    ).toEqual([
      'q-900: no evidence that the answer is in the notes',
      'q-900: the newest note dec-new is not an expected source',
      'q-900: the older note dec-old is an expected source',
    ])
    expect(
      checkQuestion(q({ traps: [{ kind: 'newest', newest: 'dec-old', among: ['dec-new'] }] }), NOTES),
    ).toEqual([
      'q-900: the newest note dec-old is not an expected source',
      'q-900: dec-new is not older than dec-old',
      'q-900: the older note dec-new is an expected source',
    ])
    expect(
      checkQuestion(q({ traps: [{ kind: 'newest', newest: 'dec-new', among: ['dec-gone'] }] }), NOTES),
    ).toEqual(['q-900: newest trap names a missing note'])
    expect(() =>
      loadQuestions(
        'questions:\n  - { id: q-001, kind: fact, split: dev, question: Q, expectedSources: [], evidence: [x] }\n',
      ),
    ).toThrow(/evidence is a list/)
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
