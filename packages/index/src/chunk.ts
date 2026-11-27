// Splits a note into the chunks that get embedded and searched. Sections follow the headings;
// paragraphs are packed up to a token budget, with no overlap. The embedded text starts with the
// note title and the heading, so a chunk carries its context ("Gravel frame › Decision").
/**
 * Budget per chunk, prefix included. The smallest candidate model (all-MiniLM-L6-v2) reads 256
 * word pieces; 200 approximate tokens leave room for the estimate being off.
 */
export const CHUNK_TOKENS = 200

export interface Chunk {
  /** `<noteId>#<ord>`. */
  id: string
  noteId: string
  /** Position in the note, from 0. */
  ord: number
  /** The nearest heading above the chunk; null before the first one. */
  heading: string | null
  /** The Markdown as written (wikilinks kept): what the app shows. */
  text: string
  /** Title › heading, a blank line, then the text with wikilinks as words: what gets embedded. */
  embedText: string
  /** Tokens of `embedText` by the counter used. */
  tokens: number
}

export interface ChunkOptions {
  maxTokens?: number
  /** Token counter; the default estimates 1.3 tokens per word. The embedder can pass its tokenizer. */
  countTokens?: (text: string) => number
  /** Title of a linked note, for `[[id]]` without a label; default: the id with spaces. */
  titleOf?: (id: string) => string | undefined
}

export const estimateTokens = (text: string): number => {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.ceil(words * 1.3)
}

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g

/** Markdown to plain words: wikilinks become their label (or the linked title), emphasis and code marks go. */
export function plainText(markdown: string, titleOf: ChunkOptions['titleOf'] = () => undefined): string {
  return markdown
    .replace(
      WIKILINK,
      (_, id: string, label?: string) => label ?? titleOf(id.trim()) ?? id.trim().replace(/-/g, ' '),
    )
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/^\s{0,3}(?:[-+*]|\d+\.)\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .trim()
}

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/

/** Sections of the body: the heading above and its paragraphs (blank-line separated). */
function sections(body: string, title: string): { heading: string | null; paragraphs: string[] }[] {
  const out: { heading: string | null; paragraphs: string[] }[] = [{ heading: null, paragraphs: [] }]
  let lines: string[] = []
  const flush = () => {
    const paragraph = lines.join('\n').trim()
    if (paragraph) out.at(-1)!.paragraphs.push(paragraph)
    lines = []
  }
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      const text = plainText(heading[1]!)
      // The first heading that repeats the title is the title, not a section.
      if (!(out.length === 1 && out[0]!.paragraphs.length === 0 && text === title))
        out.push({ heading: text, paragraphs: [] })
    } else if (line.trim() === '') flush()
    else lines.push(line)
  }
  flush()
  return out.filter((s) => s.paragraphs.length > 0)
}

/** Pieces of a paragraph that fit `budget`: by sentence, then by word when a sentence is too long. */
function fit(paragraph: string, budget: number, count: (t: string) => number): string[] {
  if (count(paragraph) <= budget) return [paragraph]
  const pieces: string[] = []
  let current = ''
  const units = paragraph.split(/(?<=[.!?])\s+/).flatMap((sentence) => {
    if (count(sentence) <= budget) return [sentence]
    const words = sentence.split(/\s+/)
    const parts: string[] = []
    let part = ''
    for (const word of words) {
      const next = part ? `${part} ${word}` : word
      if (part && count(next) > budget) {
        parts.push(part)
        part = word
      } else part = next
    }
    if (part) parts.push(part)
    return parts
  })
  for (const unit of units) {
    const next = current ? `${current} ${unit}` : unit
    if (current && count(next) > budget) {
      pieces.push(current)
      current = unit
    } else current = next
  }
  if (current) pieces.push(current)
  return pieces
}

/**
 * The chunks of a note, in order. A note with no body has none: it is still found through its
 * title, aliases and links.
 */
/** The fields of a vault `Note` the chunker reads (structural, so the index needs no dependency). */
export type ChunkableNote = { id: string; title: string; body: string }

export function chunkNote(note: ChunkableNote, options: ChunkOptions = {}): Chunk[] {
  const { maxTokens = CHUNK_TOKENS, countTokens = estimateTokens, titleOf } = options
  const chunks: Chunk[] = []
  for (const { heading, paragraphs } of sections(note.body, note.title)) {
    const prefix = heading ? `${note.title} › ${heading}` : note.title
    const budget = maxTokens - countTokens(prefix)
    if (budget < 20) throw new Error(`The title and heading of ${note.id} leave under 20 tokens for text.`)
    const embed = (text: string) => `${prefix}\n\n${plainText(text, titleOf)}`
    let current: string[] = []
    const push = () => {
      if (current.length === 0) return
      const text = current.join('\n\n')
      const embedText = embed(text)
      chunks.push({
        id: `${note.id}#${chunks.length}`,
        noteId: note.id,
        ord: chunks.length,
        heading,
        text,
        embedText,
        tokens: countTokens(embedText),
      })
      current = []
    }
    for (const paragraph of paragraphs)
      for (const piece of fit(paragraph, budget, (t) => countTokens(plainText(t, titleOf)))) {
        if (current.length > 0 && countTokens(embed([...current, piece].join('\n\n'))) > maxTokens) push()
        current.push(piece)
      }
    push()
  }
  return chunks
}
