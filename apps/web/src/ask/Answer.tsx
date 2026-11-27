// The written answer: every sentence ends with the numbers of the sources it cites. Resting on a
// number (hover or focus) shows the exact passage the answer read, with the quoted words marked; a
// click jumps to the source in the list. Phones get a bottom sheet with Close instead. A sentence the
// check removed is shown struck through, in a neutral box (amber stays for example data and
// superseded notes).
import type { Demo } from '@graph-rag/client'
import { paths } from '@graph-rag/client'
import type { Citation, RemovedSentence, Sentence } from '@graph-rag/answer/passages'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
} from '@leonfpontes/atlas-ui'
import { X } from 'lucide-react'
import { useState } from 'react'

import { shortDate } from '../lib/format'
import { PHONE, useMedia } from '../lib/media'
import { TypeTag } from '../lib/notes'
import { Link, LINK_CLASS, useRouter } from '../lib/router'

const CHIP =
  'relative mx-px inline rounded-sm border border-evidence/45 bg-evidence-subtle px-1.5 align-[1px] font-mono text-xs leading-none font-semibold whitespace-nowrap text-evidence no-underline outline-none hover:bg-evidence hover:text-evidence-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-expanded:bg-evidence aria-expanded:text-evidence-foreground data-[state=open]:bg-evidence data-[state=open]:text-evidence-foreground pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1.5 pointer-coarse:after:-inset-y-3'

/** The passage behind a citation, as the answer read it, with the quote marked. */
function Passage({ demo, citation }: { demo: Demo; citation: Citation }) {
  const view = demo.note(citation.noteId)
  const text = demo.passageText(citation.chunkId) ?? citation.quote
  const at = text.indexOf(citation.quote)
  const chunk = view?.chunks.findIndex((c) => c.id === citation.chunkId) ?? -1
  const where = citation.chunkId.endsWith('#links')
    ? 'its links and aliases'
    : chunk >= 0
      ? `chunk ${chunk + 1} of ${view!.chunks.length}`
      : 'chunk'
  return (
    <>
      {view && <TypeTag type={view.note.type} />}
      <strong className="font-semibold">{view?.note.title ?? citation.noteId}</strong>
      {view && (
        <span className="n text-[13px] text-muted-foreground">
          {view.note.path.split('/').pop()} · {where} · updated {shortDate(view.note.updated)}
        </span>
      )}
      <blockquote className="m-0 border-l-[3px] border-evidence pl-3 leading-[1.55]">
        {at >= 0 ? (
          <>
            {text.slice(0, at)}
            <mark>{citation.quote}</mark>
            {text.slice(at + citation.quote.length)}
          </>
        ) : (
          text
        )}
      </blockquote>
      <Link
        href={paths.note(citation.noteId)}
        className={cn('inline-flex min-h-6 w-fit items-center pointer-coarse:min-h-11', LINK_CLASS)}
      >
        Open the note
      </Link>
    </>
  )
}

function Chip({
  demo,
  n,
  citation,
  href,
}: {
  demo: Demo
  n: number
  citation: Citation
  /** Where a click goes (default: the source in the list on this page). */
  href?: string
}) {
  const { navigate } = useRouter()
  const phone = useMedia(PHONE)
  const [open, setOpen] = useState(false)
  const title = demo.note(citation.noteId)?.note.title ?? citation.noteId
  const label = `Source ${n}: ${title}`
  if (phone)
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        {/* The button is the 44 px target (negative margins keep the line height); the chip is drawn inside. */}
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="group relative -mx-3 -my-3.5 inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center align-middle outline-none"
        >
          <span
            aria-hidden="true"
            className={cn(
              CHIP,
              'group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50',
              open && 'bg-evidence text-evidence-foreground',
            )}
          >
            {n}
          </span>
        </button>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="gap-2 rounded-t-xl px-4 pt-4 pb-5 text-sm"
        >
          <SheetHeader className="sr-only p-0">
            <SheetTitle>Source {n}</SheetTitle>
            <SheetDescription>The passage the answer read for this sentence.</SheetDescription>
          </SheetHeader>
          <Passage demo={demo} citation={citation} />
          <button
            type="button"
            aria-label="Close source preview"
            onClick={() => setOpen(false)}
            className="absolute top-2 right-2 grid size-11 cursor-pointer place-items-center rounded-md outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </SheetContent>
      </Sheet>
    )
  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger
        href={href ?? `#src-${n}`}
        aria-label={label}
        className={CHIP}
        onClick={(e) => {
          if (!href || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          navigate(href)
        }}
      >
        {n}
      </HoverCardTrigger>
      <HoverCardContent className="w-[380px]">
        <Passage demo={demo} citation={citation} />
      </HoverCardContent>
    </HoverCard>
  )
}

export function AnswerText({
  demo,
  sentences,
  cites,
  sourceHref,
  className,
}: {
  demo: Demo
  sentences: readonly Sentence[]
  cites: Record<string, number>
  /** Where a citation leads (default: its source in the list on the same page). */
  sourceHref?: (n: number) => string
  className?: string
}) {
  return (
    <p className={cn('max-w-[70ch] text-base leading-[1.75]', className)}>
      {sentences.map((s, i) => {
        // One number per source note, in the order the sentence cites them.
        const seen = new Set<string>()
        const chips = s.citations.filter((c) => !seen.has(c.noteId) && seen.add(c.noteId) && cites[c.noteId])
        return (
          <span key={i}>
            {i > 0 && ' '}
            {s.text}
            {chips.map((c) => (
              <Chip
                key={c.noteId}
                demo={demo}
                n={cites[c.noteId]!}
                citation={c}
                href={sourceHref?.(cites[c.noteId]!)}
              />
            ))}
          </span>
        )
      })}
    </p>
  )
}

const REMOVED: Record<RemovedSentence['reason'], string> = {
  'no-source': 'no source',
  'quote-not-found': 'its quote is not in the source',
  'unknown-passage': 'it cites a passage the answer was not given',
}

export function Removed({ removed }: { removed: readonly RemovedSentence[] }) {
  if (!removed.length) return null
  const all = removed.every((r) => r.reason === 'no-source')
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md border bg-muted px-3 py-2 text-[13px] text-muted-foreground">
      <X aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="grid gap-1">
        <strong className="font-medium text-foreground">
          Removed {removed.length} {removed.length === 1 ? 'sentence' : 'sentences'}
          {all ? ' with no source' : ''}:
        </strong>
        {removed.map((r, i) => (
          <span key={i}>
            <s>“{r.text}”</s>
            {!all && <span> ({REMOVED[r.reason]})</span>}
          </span>
        ))}
      </div>
    </div>
  )
}
