// The note and the graph as the screens show them, from the index file alone (no server).
import type { IndexedChunk, IndexedNote, SearchIndex } from '@graph-rag/search'

export interface NoteLink {
  relation: string
  /** `out`: this note links to `note` (`this.owner = note`); `in`: `note` links to this one. */
  direction: 'out' | 'in'
  note: IndexedNote
}

export interface NoteView {
  note: IndexedNote
  /** The body as the search cut it, in order: `text` is the Markdown as written. */
  chunks: IndexedChunk[]
  /** Typed links both ways, `mentions` included, sorted by relation, direction, then title. */
  links: NoteLink[]
  /** The note that replaces this one (`supersedes`), if any. */
  replacedBy?: IndexedNote
}

export interface GraphView {
  nodes: { id: string; type: string; title: string; status: string; updated: string; degree: number }[]
  links: { from: string; to: string; relation: string }[]
}

type VaultIndex = Pick<SearchIndex, 'notes' | 'links' | 'chunks'>

/** Builds the note lookups once; `note(id)` is undefined for an id the index doesn't have. */
export function createVault(index: VaultIndex) {
  const notes = new Map(index.notes.map((n) => [n.id, n]))
  const chunks = new Map<string, IndexedChunk[]>()
  for (const c of index.chunks) {
    if (!chunks.has(c.noteId)) chunks.set(c.noteId, [])
    chunks.get(c.noteId)!.push(c)
  }
  for (const list of chunks.values()) list.sort((a, b) => a.ord - b.ord)
  const degree = new Map<string, number>()
  for (const l of index.links) {
    degree.set(l.from, (degree.get(l.from) ?? 0) + 1)
    degree.set(l.to, (degree.get(l.to) ?? 0) + 1)
  }

  return {
    note(id: string): NoteView | undefined {
      const note = notes.get(id)
      if (!note) return undefined
      const links: NoteLink[] = []
      let replacedBy: IndexedNote | undefined
      for (const l of index.links) {
        if (l.from === id && notes.has(l.to))
          links.push({ relation: l.relation, direction: 'out', note: notes.get(l.to)! })
        if (l.to === id && notes.has(l.from)) {
          links.push({ relation: l.relation, direction: 'in', note: notes.get(l.from)! })
          if (l.relation === 'supersedes') replacedBy = notes.get(l.from)
        }
      }
      links.sort(
        (a, b) =>
          a.relation.localeCompare(b.relation) ||
          a.direction.localeCompare(b.direction) ||
          a.note.title.localeCompare(b.note.title),
      )
      return { note, chunks: chunks.get(id) ?? [], links, ...(replacedBy ? { replacedBy } : {}) }
    },
    graph(): GraphView {
      return {
        nodes: index.notes.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          status: n.status,
          updated: n.updated,
          degree: degree.get(n.id) ?? 0,
        })),
        links: index.links.map((l) => ({ from: l.from, to: l.to, relation: l.relation })),
      }
    },
  }
}
