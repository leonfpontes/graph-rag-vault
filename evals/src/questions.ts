// The question set: loading evals/questions.yaml and proving each question against the vault. A
// question is fair when its expected sources exist and its traps hold in the vault itself, so the set
// can't claim a difficulty the notes don't have.
import type { Link, Note } from '@graph-rag/vault'
import { parse as parseYaml } from 'yaml'

import { QUESTION_KINDS, SPLITS, type Question } from './types.js'

export type Trap =
  | { kind: 'bridge'; from: string; path: { relation: Link['relation']; to: string }[] }
  | { kind: 'supersedes'; newer: string; older: string; vocabulary: 'other' | 'same' }
  | { kind: 'alias'; note: string; alias: string }
  | { kind: 'neighbour'; near: string[]; absent: string[] }
  | { kind: 'newest'; newest: string; among: string[] }

export const TRAP_KINDS = ['bridge', 'supersedes', 'alias', 'neighbour', 'newest'] as const

/** Text that must be in an expected source: proof that the answer is in the notes. */
export interface Evidence {
  note: string
  /** A regular expression, matched case-insensitively against the note's title and body. */
  contains: string
}

export interface CaseQuestion extends Question {
  traps: Trap[]
  evidence: Evidence[]
}

const ID = /^q-\d{3}$/

/** Reads evals/questions.yaml. Shape errors throw; whether the traps hold is `checkQuestions`. */
export function loadQuestions(text: string): CaseQuestion[] {
  const raw = parseYaml(text) as { questions?: unknown }
  if (!Array.isArray(raw?.questions)) throw new Error('questions.yaml has no `questions` list.')
  return raw.questions.map((q: Record<string, unknown>, i: number) => {
    const at = `question ${i + 1} (${String(q.id)})`
    if (typeof q.id !== 'string' || !ID.test(q.id)) throw new Error(`${at}: id must look like q-001.`)
    if (!(QUESTION_KINDS as readonly unknown[]).includes(q.kind)) throw new Error(`${at}: unknown kind.`)
    if (!(SPLITS as readonly unknown[]).includes(q.split)) throw new Error(`${at}: unknown split.`)
    if (typeof q.question !== 'string' || !q.question.trim()) throw new Error(`${at}: no question.`)
    if (!Array.isArray(q.expectedSources)) throw new Error(`${at}: expectedSources must be a list.`)
    const traps = (q.traps ?? []) as Trap[]
    if (!Array.isArray(traps) || traps.some((t) => !(TRAP_KINDS as readonly unknown[]).includes(t?.kind)))
      throw new Error(`${at}: every trap needs a kind of ${TRAP_KINDS.join(', ')}.`)
    const evidence = (q.evidence ?? []) as Evidence[]
    if (
      !Array.isArray(evidence) ||
      evidence.some((e) => typeof e?.note !== 'string' || typeof e?.contains !== 'string')
    )
      throw new Error(`${at}: evidence is a list of { note, contains }.`)
    return {
      id: q.id,
      kind: q.kind,
      split: q.split,
      question: q.question.trim(),
      expectedSources: q.expectedSources as string[],
      traps,
      evidence,
    } as CaseQuestion
  })
}

/** Plain lowercase words, for "does the question name this note" checks. */
const norm = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `
const names = (text: string, name: string) => norm(text).includes(norm(name))

const STOP = new Set(
  'a an and are as at be by did do does for from get had has have how in is it its of on or the this to was were what when where which who whom why will with you your'.split(
    ' ',
  ),
)
/** Content words of a text, crudely stemmed, for the vocabulary-overlap check. */
const words = (text: string) =>
  new Set(
    norm(text)
      .trim()
      .split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => (w.length > 4 ? w.replace(/(ing|ed|s)$/, '') : w)),
  )
/** Share of the question's content words found in the note. */
export function overlap(question: string, note: Note): number {
  const q = words(question)
  const n = words(`${note.title} ${note.body}`)
  return q.size === 0 ? 0 : [...q].filter((w) => n.has(w)).length / q.size
}

/** Every reason a question is not a fair test of the vault; empty when it is. */
export function checkQuestion(q: CaseQuestion, notes: readonly Note[]): string[] {
  const problems: string[] = []
  const byId = new Map(notes.map((n) => [n.id, n]))
  const note = (id: string) => byId.get(id)
  const say = (text: string) => problems.push(`${q.id}: ${text}`)
  const linked = (a: string, relation: string, b: string) =>
    note(a)?.links.some((l) => l.relation === relation && l.to === b) ||
    note(b)?.links.some((l) => l.relation === relation && l.to === a)

  for (const id of q.expectedSources) if (!note(id)) say(`expected source ${id} is not a note`)
  if (new Set(q.expectedSources).size !== q.expectedSources.length) say('an expected source is listed twice')
  if (q.kind === 'unanswerable' ? q.expectedSources.length > 0 : q.expectedSources.length === 0)
    say(q.kind === 'unanswerable' ? 'an unanswerable question has no sources' : 'no expected sources')
  if (q.kind === 'multi-hop' && q.expectedSources.length < 2)
    say('a multi-hop question needs 2 or more sources')
  if (q.kind !== 'unanswerable' && q.evidence.length === 0) say('no evidence that the answer is in the notes')
  for (const e of q.evidence) {
    const n = note(e.note)
    if (!q.expectedSources.includes(e.note)) say(`evidence note ${e.note} is not an expected source`)
    else if (n && !new RegExp(e.contains, 'i').test(`${n.title}\n${n.body}`))
      say(`${e.note} does not contain /${e.contains}/`)
  }
  const needs: Partial<Record<Question['kind'], Trap['kind'][]>> = {
    'multi-hop': ['bridge'],
    temporal: ['supersedes', 'newest'],
    unanswerable: ['neighbour'],
  }
  const wanted = needs[q.kind]
  if (wanted && !q.traps.some((t) => wanted.includes(t.kind)))
    say(`${/^[aeiou]/.test(q.kind) ? 'an' : 'a'} ${q.kind} question needs a ${wanted.join(' or ')} trap`)

  for (const trap of q.traps) {
    switch (trap.kind) {
      case 'bridge': {
        if (!note(trap.from)) {
          say(`bridge starts at ${trap.from}, which is not a note`)
          break
        }
        let at = trap.from
        for (const step of trap.path) {
          if (!linked(at, step.relation, step.to))
            say(`no ${step.relation} link between ${at} and ${step.to}`)
          at = step.to
        }
        const reached = [trap.from, ...trap.path.map((s) => s.to)]
        if ([...reached].sort().join() !== [...q.expectedSources].sort().join())
          say(`the bridge reaches ${reached.join(', ')}, not the expected sources`)
        // The notes past the start (the bridge and the answer) must not be named by title or alias.
        for (const id of trap.path.map((s) => s.to)) {
          const n = note(id)
          for (const name of n ? [n.title, ...n.aliases] : [])
            if (names(q.question, name))
              say(`the question names ${id} ("${name}"), which the bridge should hide`)
        }
        break
      }
      case 'supersedes': {
        const [newer, older] = [note(trap.newer), note(trap.older)]
        if (!newer || !older) {
          say(`supersedes trap names a missing note`)
          break
        }
        if (!linked(trap.newer, 'supersedes', trap.older) || !newer.links.some((l) => l.to === trap.older))
          say(`${trap.newer} does not supersede ${trap.older}`)
        if (newer.updated <= older.updated) say(`${trap.newer} is not newer than ${trap.older}`)
        if (!q.expectedSources.includes(trap.newer))
          say(`the newer note ${trap.newer} is not an expected source`)
        if (q.expectedSources.includes(trap.older))
          say(`the replaced note ${trap.older} is an expected source`)
        if (trap.vocabulary === 'other' && overlap(q.question, newer) >= overlap(q.question, older))
          say(`${trap.newer} shares as many words with the question as ${trap.older}`)
        break
      }
      case 'alias': {
        const n = note(trap.note)
        if (!n) {
          say(`alias trap names ${trap.note}, which is not a note`)
          break
        }
        if (!n.aliases.includes(trap.alias)) say(`${trap.note} has no alias "${trap.alias}"`)
        if (!names(q.question, trap.alias)) say(`the question does not use the alias "${trap.alias}"`)
        if (names(q.question, n.title)) say(`the question names ${trap.note} by its title`)
        break
      }
      case 'newest': {
        const newest = note(trap.newest)
        const others = trap.among.map(note)
        if (!newest || others.some((o) => !o)) {
          say('newest trap names a missing note')
          break
        }
        if (!q.expectedSources.includes(trap.newest))
          say(`the newest note ${trap.newest} is not an expected source`)
        for (const o of others as Note[]) {
          if (o.updated >= newest.updated) say(`${o.id} is not older than ${trap.newest}`)
          if (q.expectedSources.includes(o.id)) say(`the older note ${o.id} is an expected source`)
        }
        break
      }
      case 'neighbour': {
        if (q.kind !== 'unanswerable') say('a neighbour trap belongs to an unanswerable question')
        for (const id of trap.near) if (!note(id)) say(`neighbour ${id} is not a note`)
        for (const pattern of trap.absent) {
          const re = new RegExp(pattern, 'i')
          const found = notes.find((n) => re.test(`${n.title}\n${n.body}`))
          if (found) say(`the vault has the fact after all: /${pattern}/ matches ${found.id}`)
        }
        break
      }
    }
  }
  return problems
}

/** Every problem of the set: duplicate ids, and each question against the vault. */
export function checkQuestions(questions: readonly CaseQuestion[], notes: readonly Note[]): string[] {
  const seen = new Set<string>()
  const problems: string[] = []
  for (const q of questions) {
    if (seen.has(q.id)) problems.push(`${q.id}: id used twice`)
    seen.add(q.id)
    problems.push(...checkQuestion(q, notes))
  }
  return problems
}
