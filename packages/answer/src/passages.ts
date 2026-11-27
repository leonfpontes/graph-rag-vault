// From search results to the passages an answer reads: for each of the best notes, its chunks (the
// chunk that matched first) and one "Links" passage that states the note's typed links in words
// ("Nora Pell reports to Kofi Mensah.") and its aliases. Both live in the frontmatter, not in the body, so
// without that passage an answer could find the right notes and still not see how they connect.
// The evaluation and the local API build passages the same way, so a recorded answer is the answer
// the app would give.
import type { SearchHit, SearchIndex } from '@graph-rag/search'

import { MAX_PASSAGES, type Passage } from './answer.js'

/** Notes of the result list whose passages the answer reads (the evaluation reports recall@5). */
export const ANSWER_NOTES = 5

/** The embedded text without its first line ("Title › Section"): what the quotes are checked against. */
export const passageText = (embedText: string) => {
  const cut = embedText.indexOf('\n\n')
  return (cut === -1 ? embedText : embedText.slice(cut + 2)).trim()
}

/** A typed link in words; `from` and `to` are note titles. `mentions` is in the body already. */
const PHRASES: Record<string, (from: string, to: string) => string> = {
  owner: (from, to) => `The owner of ${from} is ${to}.`,
  attendees: (from, to) => `${to} attended ${from}.`,
  decided_in: (from, to) => `${from} was decided in ${to}.`,
  customer: (from, to) => `The customer of ${from} is ${to}.`,
  supersedes: (from, to) => `${from} replaces ${to}.`,
  reports_to: (from, to) => `${from} reports to ${to}.`,
}

/** The id of a note's links passage. */
export const linksPassageId = (noteId: string) => `${noteId}#links`

/**
 * The note's aliases, its outgoing typed links and the notes that replace it, as sentences. Empty
 * when the note has none.
 */
export function linkSentences(index: Pick<SearchIndex, 'notes' | 'links'>, noteId: string): string[] {
  const title = new Map(index.notes.map((n) => [n.id, n.title]))
  const name = (id: string) => title.get(id) ?? id
  const out: string[] = []
  // Aliases live in the frontmatter too: a question may name the note only by one of them.
  const aliases = index.notes.find((n) => n.id === noteId)?.aliases ?? []
  if (aliases.length) out.push(`${name(noteId)} is also called ${aliases.join(', ')}.`)
  for (const l of index.links) {
    const phrase = PHRASES[l.relation]
    if (!phrase) continue
    if (l.from === noteId) out.push(phrase(name(l.from), name(l.to)))
    else if (l.to === noteId && l.relation === 'supersedes')
      out.push(`${name(l.to)} was replaced by ${name(l.from)}.`)
  }
  return out
}

/** The text of any passage the answer may cite, by id: a chunk, or a note's Links passage. */
export function passageTextById(
  index: Pick<SearchIndex, 'notes' | 'chunks' | 'links'>,
  id: string,
): string | undefined {
  if (id.endsWith('#links')) {
    const sentences = linkSentences(index, id.slice(0, -'#links'.length))
    return sentences.length ? sentences.join(' ') : undefined
  }
  const chunk = index.chunks.find((c) => c.id === id)
  return chunk ? passageText(chunk.embedText) : undefined
}

export function passagesFromHits(
  index: Pick<SearchIndex, 'notes' | 'chunks' | 'links'>,
  hits: readonly SearchHit[],
  { notes = ANSWER_NOTES, max = MAX_PASSAGES }: { notes?: number; max?: number } = {},
): Passage[] {
  const byNote = new Map(index.notes.map((n) => [n.id, n]))
  const chunksOf = new Map<string, SearchIndex['chunks']>()
  for (const c of index.chunks) {
    if (!chunksOf.has(c.noteId)) chunksOf.set(c.noteId, [])
    chunksOf.get(c.noteId)!.push(c)
  }
  const passages: Passage[] = []
  for (const hit of hits.slice(0, notes)) {
    const note = byNote.get(hit.noteId)
    if (!note) throw new Error(`The search returned ${hit.noteId}, which is not in the index.`)
    const base = { noteId: note.id, title: note.title, updated: note.updated, status: note.status }
    const chunks = [...(chunksOf.get(hit.noteId) ?? [])].sort(
      (a, b) => Number(b.id === hit.chunkId) - Number(a.id === hit.chunkId) || a.ord - b.ord,
    )
    for (const c of chunks) {
      if (passages.length >= max) return passages
      passages.push({ ...base, chunkId: c.id, heading: c.heading, text: passageText(c.embedText) })
    }
    const links = linkSentences(index, note.id)
    if (links.length === 0) continue
    if (passages.length >= max) return passages
    passages.push({ ...base, chunkId: linksPassageId(note.id), heading: 'Links', text: links.join(' ') })
  }
  return passages
}
