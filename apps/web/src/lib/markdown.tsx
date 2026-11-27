// The Markdown of a chunk as the vault wrote it: paragraphs, lists, **bold**, `code` and wikilinks
// ([[note-id]] or [[note-id|label]]), which open the linked note. Nothing else is needed: the
// vault's notes use only these.
import { paths } from '@graph-rag/client'
import type { ReactNode } from 'react'

import { Link } from './router'

export type TitleOf = (id: string) => string | undefined

function inline(text: string, titleOf: TitleOf, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\*\*([^*]+)\*\*|`([^`]+)`/g
  let last = 0
  let n = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${n++}`
    if (m[1]) {
      const id = m[1].trim()
      const label = m[2]?.trim() ?? titleOf(id) ?? id
      out.push(
        titleOf(id) ? (
          <Link
            key={k}
            href={paths.note(id)}
            className="border-b border-primary/40 text-primary no-underline hover:border-primary"
          >
            {label}
          </Link>
        ) : (
          <span key={k} title="Not in the vault">
            {label}
          </span>
        ),
      )
    } else if (m[3]) out.push(<strong key={k}>{m[3]}</strong>)
    else out.push(<code key={k}>{m[4]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text, titleOf }: { text: string; titleOf: TitleOf }) {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n')
        if (lines.every((l) => /^\s*[-*]\s+/.test(l)))
          return (
            <ul key={i} className="mt-3 list-disc pl-5 first:mt-0">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ''), titleOf, `${i}-${j}`)}</li>
              ))}
            </ul>
          )
        return (
          <p key={i} className="mt-3 first:mt-0">
            {inline(lines.join(' '), titleOf, `${i}`)}
          </p>
        )
      })}
    </>
  )
}
