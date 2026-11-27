// The sources of an answer: rank, type, title, the excerpt with the matched words highlighted, and
// why the search brought each one (vector, words, a link from another result, recency, replaced).
// The fused score stays in the rank's tooltip: it is only comparable inside one list.
import type { Demo } from '@graph-rag/client'
import { paths } from '@graph-rag/client'
import type { Reason, SearchHit } from '@graph-rag/search'
import { Badge, Tooltip, TooltipContent, TooltipTrigger, cn } from '@leonfpontes/atlas-ui'
import { ArrowUpRight, Clock, Link2, Replace, TriangleAlert, Type } from 'lucide-react'
import type { ReactNode } from 'react'

import { shortDate } from '../lib/format'
import { Shape } from '../lib/notes'
import { Link } from '../lib/router'

/** Text with the given words marked (whole words, or words that start with a stem). */
export function highlight(text: string, words: readonly string[]): ReactNode[] {
  const terms = [...new Set(words.map((w) => w.trim()).filter((w) => w.length > 1))]
  if (!terms.length) return [text]
  const escaped = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
  const re = new RegExp(`\\b(${escaped.join('|')})[\\p{L}\\p{N}]*`, 'giu')
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<mark key={m.index}>{m[0]}</mark>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Up to `max` characters around the first highlighted word, cut at word boundaries. */
export function excerpt(text: string, words: readonly string[], max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const lower = flat.toLowerCase()
  const at = Math.min(...words.map((w) => lower.indexOf(w.toLowerCase())).filter((i) => i >= 0), flat.length)
  const start = at === flat.length || at < max / 2 ? 0 : flat.lastIndexOf(' ', at - max / 3) + 1
  const end = flat.lastIndexOf(' ', start + max)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end > start ? end : start + max)}…`
}

export const matchedWords = (hit: SearchHit) =>
  hit.reasons.flatMap((r) => (r.kind === 'keyword' ? r.terms : r.kind === 'title' ? [r.matched] : []))

export function ReasonChip({
  reason,
  rankOf,
  titleOf,
}: {
  reason: Reason
  rankOf: (id: string) => number | undefined
  titleOf: (id: string) => string
}) {
  const base =
    'inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs leading-[18px] font-medium text-foreground [&_svg]:size-3 [&_svg]:shrink-0'
  const from = (id: string) => {
    const r = rankOf(id)
    return r ? `#${r}` : titleOf(id)
  }
  switch (reason.kind) {
    case 'vector':
      return (
        <span className={base} title="Vector match: similarity to the question">
          <ArrowUpRight aria-hidden="true" />
          vector <b className="n font-medium">{reason.similarity.toFixed(2)}</b>
        </span>
      )
    case 'title':
      return (
        <span className={base} title="The question names this note">
          <Type aria-hidden="true" />
          name “{reason.matched}”
        </span>
      )
    case 'keyword':
      return (
        <span className={base} title="Keyword match (BM25)">
          <Type aria-hidden="true" />
          word “{reason.terms.join(' ')}”
        </span>
      )
    case 'link':
      return (
        <span className={base} title={`Linked from a result${reason.hops === 2 ? ', 2 links away' : ''}`}>
          <Link2 aria-hidden="true" />
          link{' '}
          <b className="n min-w-0 font-medium [overflow-wrap:anywhere]">
            {reason.relation} {reason.direction === 'out' ? '←' : '→'} {from(reason.from)}
            {reason.hops === 2 ? ' · 2 hops' : ''}
          </b>
        </span>
      )
    case 'supersedes':
      return (
        <span className={base} title="It replaces a note the search found">
          <Replace aria-hidden="true" />
          replaces {from(reason.older)}
        </span>
      )
    case 'recency':
      return (
        <span className={base} title="Recency boost">
          <Clock aria-hidden="true" />
          updated {shortDate(reason.updated, false)}
        </span>
      )
    case 'stale':
      return (
        <span
          className={cn(base, 'border-dashed border-warning bg-warning-subtle text-warning')}
          title={reason.by ? `Replaced by ${titleOf(reason.by)}` : `Status: ${reason.status}`}
        >
          <TriangleAlert aria-hidden="true" />
          {reason.status}
        </span>
      )
  }
}

export interface SourceListProps {
  demo: Demo
  hits: readonly SearchHit[]
  /** Citation number by note id; cited sources show [n], the others #n. */
  cites: Record<string, number>
  caption: ReactNode
  /** Mark sources not cited (when there is an answer to cite them). */
  showNotCited: boolean
}

export function SourceList({ demo, hits, cites, caption, showNotCited }: SourceListProps) {
  const rank = new Map(hits.map((h, i) => [h.noteId, i + 1]))
  const titleOf = (id: string) => demo.note(id)?.note.title ?? id
  return (
    <section className="mt-5 grid gap-3" aria-labelledby="sources-h">
      <h2 id="sources-h" className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold">
        Sources <span className="n text-[13px] font-normal text-muted-foreground">{caption}</span>
      </h2>
      <ol className="m-0 list-none rounded-lg border bg-card p-0">
        {hits.map((hit, i) => {
          const view = demo.note(hit.noteId)
          if (!view) return null
          const cited = cites[hit.noteId] !== undefined
          const words = matchedWords(hit)
          const chunk = hit.chunkId ?? view.chunks[0]?.id
          const text = (chunk && demo.passageText(chunk)) ?? ''
          return (
            <li
              key={hit.noteId}
              id={`src-${i + 1}`}
              className="grid scroll-mt-20 grid-cols-[22px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b px-4 py-3 last:border-b-0 md:grid-cols-[28px_minmax(0,1fr)]"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className={cn(
                      'n w-fit rounded-sm text-[13px] leading-[22px] font-semibold text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      cited && 'text-evidence',
                    )}
                    aria-label={`${cited ? `Source ${i + 1}, cited` : `Result ${i + 1}`}, fused score ${hit.score.toFixed(4)}`}
                  >
                    {cited ? `[${i + 1}]` : `#${i + 1}`}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Rank {i + 1} · fused score <span className="n">{hit.score.toFixed(4)}</span> (RRF)
                </TooltipContent>
              </Tooltip>
              <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <Shape type={view.note.type} />
                <Link
                  href={paths.note(hit.noteId)}
                  className="inline-flex min-h-6 items-center text-foreground no-underline hover:underline pointer-coarse:min-h-11"
                >
                  {view.note.title}
                </Link>
                {showNotCited && !cited && <Badge variant="outline">not cited</Badge>}
              </h3>
              {text && (
                <p className="col-start-2 text-[13px] leading-[1.55] text-muted-foreground">
                  {highlight(excerpt(text, words), words)}
                </p>
              )}
              <div className="col-start-2 flex flex-wrap gap-1.5">
                {hit.reasons.map((r, k) => (
                  <ReasonChip key={k} reason={r} rankOf={(id) => rank.get(id)} titleOf={titleOf} />
                ))}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
