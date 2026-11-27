// Note types: each has its own shape, color and word, so the type never depends on color alone
// (docs/DESIGN.md, Note types). The same shapes are drawn on the graph canvas (graph/shapes.ts).
import { cn } from '@leonfpontes/atlas-ui'

export const NOTE_TYPES = ['person', 'project', 'decision', 'meeting', 'customer', 'document'] as const
export type NoteType = (typeof NOTE_TYPES)[number]

export const TYPE_LABEL: Record<NoteType, string> = {
  person: 'Person',
  project: 'Project',
  decision: 'Decision',
  meeting: 'Meeting',
  customer: 'Customer',
  document: 'Document',
}

/** Folder names, for the breadcrumb of a note. */
export const TYPE_PLURAL: Record<NoteType, string> = {
  person: 'People',
  project: 'Projects',
  decision: 'Decisions',
  meeting: 'Meetings',
  customer: 'Customers',
  document: 'Documents',
}

export const isNoteType = (value: string): value is NoteType =>
  (NOTE_TYPES as readonly string[]).includes(value)

/** The relations, in the order the filters list them (`mentions` last: it comes from the text). */
export const RELATIONS = [
  'owner',
  'attendees',
  'decided_in',
  'supersedes',
  'reports_to',
  'customer',
  'mentions',
]

const SHAPE_PATH: Record<NoteType, string> = {
  person: 'M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11z',
  project:
    'M4.25 2.75h7.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-7.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5z',
  decision: 'M8 1.5L14.5 8 8 14.5 1.5 8z',
  meeting: 'M8 2l6.5 11.5h-13z',
  customer: 'M8 1.75l5.4 3.125v6.25L8 14.25l-5.4-3.125v-6.25z',
  document: 'M4 1.75h5.5L12.5 4.75v9.5H4z',
}

/** The shape of a note type, in its color. Decorative: the word next to it names the type. */
export function Shape({ type, size = 14, className }: { type: string; size?: number; className?: string }) {
  const t = isNoteType(type) ? type : 'document'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn('shrink-0', className)}
      style={{ color: `var(--t-${t})` }}
      data-shape={t}
    >
      <path d={SHAPE_PATH[t]} fill="currentColor" />
    </svg>
  )
}

/** Shape + word: "◆ Decision", or the shape with another label (a note title). */
export function TypeTag({
  type,
  children,
  className,
}: {
  type: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap', className)}
    >
      <Shape type={type} />
      {children ?? (isNoteType(type) ? TYPE_LABEL[type] : type)}
    </span>
  )
}
