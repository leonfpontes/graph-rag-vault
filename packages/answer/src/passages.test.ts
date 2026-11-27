import type { SearchHit } from '@graph-rag/search'
import { describe, expect, it } from 'vitest'

import { linkSentences, linksPassageId, passagesFromHits, passageText, passageTextById } from './index.js'

const note = (id: string, updated = '2026-01-01', status = 'active') => ({
  id,
  type: 'document',
  title: `Title of ${id}`,
  aliases: [],
  created: '2025-01-01',
  updated,
  status,
  path: `documents/${id}.md`,
})
const chunk = (noteId: string, ord: number, heading: string | null = null) => ({
  id: `${noteId}#${ord}`,
  noteId,
  ord,
  heading,
  text: `Markdown ${ord} of [[${noteId}]]`,
  embedText: `Title of ${noteId}${heading ? ` › ${heading}` : ''}\n\nPlain ${ord} of ${noteId}.\n\nSecond paragraph.`,
})
const INDEX = {
  notes: [note('a', '2026-03-01', 'superseded'), note('b'), note('c')],
  chunks: [chunk('a', 0), chunk('a', 1, 'Terms'), chunk('a', 2), chunk('b', 0), chunk('c', 0)],
  links: [] as { from: string; to: string; relation: string }[],
}
const hit = (noteId: string, chunkId?: string): SearchHit => ({ noteId, chunkId, score: 1, reasons: [] })

describe('passagesFromHits', () => {
  it('reads the chunks of the best notes, the matching chunk first, with the note fields', () => {
    const passages = passagesFromHits(INDEX, [hit('a', 'a#1'), hit('c')])
    expect(passages.map((p) => p.chunkId)).toEqual(['a#1', 'a#0', 'a#2', 'c#0'])
    expect(passages[0]).toEqual({
      chunkId: 'a#1',
      noteId: 'a',
      title: 'Title of a',
      heading: 'Terms',
      text: 'Plain 1 of a.\n\nSecond paragraph.',
      updated: '2026-03-01',
      status: 'superseded',
    })
  })

  it('stops at the note and passage limits', () => {
    expect(
      passagesFromHits(INDEX, [hit('a'), hit('b'), hit('c')], { notes: 2 }).map((p) => p.noteId),
    ).toEqual(['a', 'a', 'a', 'b'])
    expect(passagesFromHits(INDEX, [hit('a'), hit('b')], { max: 2 })).toHaveLength(2)
    expect(passagesFromHits(INDEX, [])).toEqual([])
  })

  it('adds a Links passage after the chunks of a note with typed links or aliases', () => {
    const index = {
      notes: [
        { ...note('per-nora'), title: 'Nora Pell', aliases: ['Nora'] },
        { ...note('per-kofi'), title: 'Kofi Mensah' },
        { ...note('doc-p'), title: 'Brake protocol' },
        { ...note('doc-new'), title: 'Protocol v2' },
      ],
      chunks: [chunk('per-nora', 0), chunk('doc-p', 0)],
      links: [
        { from: 'per-nora', to: 'per-kofi', relation: 'reports_to' },
        { from: 'doc-p', to: 'per-nora', relation: 'owner' },
        { from: 'doc-new', to: 'doc-p', relation: 'supersedes' },
        { from: 'doc-p', to: 'per-kofi', relation: 'mentions' },
      ],
    }
    const passages = passagesFromHits(index, [hit('doc-p'), hit('per-nora'), hit('per-kofi')])
    expect(passages.map((p) => p.chunkId)).toEqual(['doc-p#0', 'doc-p#links', 'per-nora#0', 'per-nora#links'])
    expect(passages[1]).toMatchObject({
      noteId: 'doc-p',
      heading: 'Links',
      text: 'The owner of Brake protocol is Nora Pell. Brake protocol was replaced by Protocol v2.',
    })
    expect(passages[3]!.text).toBe('Nora Pell is also called Nora. Nora Pell reports to Kofi Mensah.')
    expect(linksPassageId('x')).toBe('x#links')
    expect(passageTextById(index, 'per-nora#links')).toBe(passages[3]!.text)
    expect(passageTextById(index, 'doc-p#0')).toBe(passages[0]!.text)
    expect(passageTextById(index, 'per-kofi#links')).toBeUndefined()
    expect(passageTextById(index, 'nope#0')).toBeUndefined()
  })

  it('words every typed link but mentions, and names a missing note by its id', () => {
    const index = {
      notes: [{ ...note('m'), title: 'Kickoff' }],
      links: [
        { from: 'm', to: 'per-a', relation: 'attendees' },
        { from: 'm', to: 'cus-b', relation: 'customer' },
        { from: 'd', to: 'm', relation: 'decided_in' },
        { from: 'm', to: 'old', relation: 'supersedes' },
        { from: 'm', to: 'x', relation: 'mentions' },
      ],
    }
    expect(linkSentences(index, 'm')).toEqual([
      'per-a attended Kickoff.',
      'The customer of Kickoff is cus-b.',
      'Kickoff replaces old.',
    ])
    expect(linkSentences(index, 'd')).toEqual(['d was decided in Kickoff.'])
  })

  it('refuses a hit that is not in the index', () => {
    expect(() => passagesFromHits(INDEX, [hit('zz')])).toThrow(
      'The search returned zz, which is not in the index.',
    )
  })

  it('drops the title line of the embedded text, and keeps text that has none', () => {
    expect(passageText('Title › Part\n\nBody text.')).toBe('Body text.')
    expect(passageText('Only a title')).toBe('Only a title')
  })
})
