// Note: one note as the search cut it. The body comes in its chunks, each with the recorded questions
// whose answers cite it (cited chunks carry the evidence bar); the frontmatter folds into a table; the
// side shows its neighbors one link away, the links by type and direction, and the evaluation
// questions that expect this note.
import type { Demo, NoteView, RecordedQuestion } from '@graph-rag/client'
import { paths } from '@graph-rag/client'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
} from '@leonfpontes/atlas-ui'
import { ChevronDown, FileText, MessageCircleQuestionMark, TriangleAlert, Waypoints } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { GraphCanvas } from '../graph/GraphCanvas'
import { layout } from '../graph/layout'
import type { SceneOptions } from '../graph/scene'
import { useDemo } from '../lib/demo'
import { plural, shortDate } from '../lib/format'
import { Markdown } from '../lib/markdown'
import { PHONE, useMedia } from '../lib/media'
import { isNoteType, Shape, TYPE_PLURAL, TypeTag } from '../lib/notes'
import { Link, useRouter } from '../lib/router'
import { DemoError, DownloadStatus } from '../shell/states'
import { usePageTitle } from '../shell/title'
import { askAbout } from './Explore'

/** Which recorded questions cite each chunk (round 1 of the hybrid answers, the ones the demo shows). */
export function useCitedBy(demo: Demo | undefined): Map<string, string[]> | undefined {
  const [cited, setCited] = useState<Map<string, string[]>>()
  useEffect(() => {
    if (!demo) return
    let live = true
    Promise.all(demo.questions.map((q) => demo.recordedAnswer(q.id, 'hybrid'))).then(
      (answers) => {
        const map = new Map<string, string[]>()
        for (const a of answers) {
          if (!a) continue
          const chunks = new Set(a.sentences.flatMap((s) => s.citations.map((c) => c.chunkId)))
          for (const c of chunks) map.set(c, [...(map.get(c) ?? []), a.questionId])
        }
        if (live) setCited(map)
      },
      () => live && setCited(new Map()),
    )
    return () => {
      live = false
    }
  }, [demo])
  return cited
}

export function Note({ id }: { id: string }) {
  const { state, retry } = useDemo()
  const demo = state.status === 'ready' ? state.demo : undefined
  const view = demo?.note(id)
  usePageTitle(view?.note.title ?? (demo ? 'Note not found' : 'Note'))
  const file = view?.note.path.split('/').pop() ?? `${id}.md`
  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-4 pb-12 md:px-6 md:pt-6">
      <Breadcrumb className="mb-2">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={paths.explore()}>Explore</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          {view && isNoteType(view.note.type) && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>{TYPE_PLURAL[view.note.type]}</BreadcrumbItem>
            </>
          )}
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="n">{file}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {state.status === 'loading' && <DownloadStatus download={state.download} what="the vault" />}
      {state.status === 'error' && <DemoError error={state.error} onRetry={retry} />}
      {demo && !view && <Missing id={id} />}
      {demo && view && <NoteBody demo={demo} view={view} />}
    </div>
  )
}

function Missing({ id }: { id: string }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-xl border border-dashed px-6 py-10">
      <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
      <h1 className="text-lg font-semibold">No note called “{id}”</h1>
      <p className="max-w-[520px] text-sm text-muted-foreground">
        It may have been renamed or removed from the vault. Links in other notes that point to it show up as
        broken links in the index report.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={paths.explore()}>Back to Explore</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={paths.ask()}>Ask the vault</Link>
        </Button>
      </div>
    </div>
  )
}

function NoteBody({ demo, view }: { demo: Demo; view: NoteView }) {
  const { note, chunks, links, replacedBy } = view
  const phone = useMedia(PHONE)
  const { navigate } = useRouter()
  const citedBy = useCitedBy(demo)
  const graph = useMemo(() => demo.graph(), [demo])
  const L = layout(graph, '2d')
  const seed = L.community[L.index.get(note.id) ?? -1] ?? -1
  const project = seed >= 0 ? L.nodes[seed] : undefined
  const titleOf = (x: string) => demo.note(x)?.note.title
  const expectedBy = demo.questions.filter((q) => q.expectedSources.includes(note.id))
  const options = useMemo<SceneOptions>(
    () => ({ mode: '2d', focus: note.id, zoom: 2.2, clusterLabels: false }),
    [note.id],
  )
  const out = links.filter((l) => l.direction === 'out')
  const groups = new Map<string, NoteView['links']>()
  for (const l of links) {
    const key = l.direction === 'out' ? `${l.relation} →` : `← ${l.relation}`
    groups.set(key, [...(groups.get(key) ?? []), l])
  }
  return (
    <div className="grid items-start gap-8 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
      <article className="min-w-0">
        <header className="mb-5 grid gap-2">
          <TypeTag type={note.type} />
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em] md:text-[28px]">
            {note.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
            <span className="n">updated {note.updated}</span>
            <span className="n">{plural(links.length, 'link')}</span>
            <span className="n">{plural(chunks.length, 'chunk')}</span>
            {project && (
              <Link
                href={`${paths.explore()}?cluster=${project.id}`}
                className="inline-flex min-h-6 items-center gap-1.5 text-muted-foreground pointer-coarse:min-h-11"
              >
                <Shape type="project" />
                {project.title} constellation
              </Link>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <Button asChild variant="outline" className="max-md:flex-auto">
              <Link href={paths.explore(note.id)}>
                <Waypoints aria-hidden="true" />
                Show in graph
              </Link>
            </Button>
            <Button asChild className="max-md:flex-auto">
              <Link href={askAbout(note.title)}>
                <MessageCircleQuestionMark aria-hidden="true" />
                Ask about this note
              </Link>
            </Button>
          </div>
        </header>
        {(note.status === 'superseded' || replacedBy) && (
          <Alert variant="warning" className="mb-5">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>
              {replacedBy ? `Superseded on ${shortDate(replacedBy.created)}` : 'Superseded'}
            </AlertTitle>
            <AlertDescription>
              <p>
                {replacedBy ? (
                  <>
                    The newer note <Link href={paths.note(replacedBy.id)}>{replacedBy.title}</Link> replaces
                    this one.
                  </>
                ) : (
                  'A newer note replaces this one.'
                )}{' '}
                Search ranks this note lower, and answers prefer the newer note.
              </p>
            </AlertDescription>
          </Alert>
        )}
        <Collapsible defaultOpen={!phone} className="rounded-lg border bg-card px-4 py-3">
          <CollapsibleTrigger className="group flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11">
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform group-data-[state=closed]:-rotate-90"
            />
            Properties (frontmatter)
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className="m-0 mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
              <Prop k="type">{note.type}</Prop>
              <Prop k="id">{note.id}</Prop>
              <Prop k="aliases">{note.aliases.join(', ') || '—'}</Prop>
              <Prop k="created">{note.created}</Prop>
              <Prop k="updated">{note.updated}</Prop>
              <Prop k="status">{note.status || '—'}</Prop>
              {out
                .filter((l) => l.relation !== 'mentions')
                .map((l) => (
                  <Prop key={`${l.relation}-${l.note.id}`} k={l.relation} sans>
                    <Link
                      href={paths.note(l.note.id)}
                      className="border-b border-primary/40 text-primary no-underline"
                    >
                      {l.note.title}
                    </Link>
                  </Prop>
                ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
        <div className="mt-5 max-w-[72ch] text-base leading-[1.7]">
          {chunks.length === 0 && (
            <p className="text-muted-foreground">This note has no body: only its properties.</p>
          )}
          {chunks.map((c, i) => {
            const by = citedBy?.get(c.id) ?? []
            return (
              <section
                key={c.id}
                aria-label={`Chunk ${i + 1} of ${chunks.length}`}
                className={cn(
                  'border-l-2 py-2 pl-4 not-first:mt-1',
                  by.length ? 'border-evidence' : 'border-border',
                )}
              >
                <p className="mb-1 flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                  <b className={cn('font-medium', by.length > 0 && 'text-evidence')}>
                    chunk {i + 1} of {chunks.length}
                  </b>
                  <span aria-hidden="true">·</span>
                  {citedBy === undefined ? (
                    <span>reading the recorded answers…</span>
                  ) : by.length ? (
                    <span>
                      cited by{' '}
                      {by.map((q, k) => (
                        <span key={q}>
                          {k > 0 && ', '}
                          <Link
                            href={paths.ask(q)}
                            className="inline-flex min-h-6 items-center pointer-coarse:min-h-11"
                          >
                            {q}
                          </Link>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span>not cited by a recorded answer</span>
                  )}
                </p>
                {c.heading && <h2 className="mt-1 mb-2 text-lg font-semibold">{c.heading}</h2>}
                <Markdown text={c.text} titleOf={titleOf} />
              </section>
            )
          })}
        </div>
      </article>
      <aside className="grid min-w-0 gap-4 min-[1100px]:sticky min-[1100px]:top-[72px]">
        <section aria-label={`Neighbors of this note, 1 link away`} data-graph-area>
          <GraphCanvas
            graph={graph}
            options={options}
            label={`${note.title} and its ${plural(links.length, 'linked note')}.`}
            className="h-[260px]"
            zoomControls="reset"
            onSelect={(next) => navigate(paths.note(next))}
          />
        </section>
        <Panel
          title="Links"
          lead={
            <>
              Typed links from the frontmatter; <span className="font-mono">mentions</span> come from
              wikilinks in the text.
            </>
          }
        >
          {groups.size === 0 && <p className="text-sm text-muted-foreground">No links.</p>}
          {[...groups.entries()].map(([k, ls]) => (
            <div key={k} className="grid gap-1">
              <h3 className="font-mono text-xs font-medium text-muted-foreground">{k}</h3>
              <ul className="m-0 grid list-none gap-0.5 p-0">
                {ls.map((l) => (
                  <li key={l.note.id}>
                    <Link
                      href={paths.note(l.note.id)}
                      className="-mx-2 grid min-h-10 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 text-sm leading-snug text-foreground no-underline outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
                    >
                      <Shape type={l.note.type} />
                      <span>{l.note.title}</span>
                      <span className="n text-xs text-muted-foreground">{l.note.updated.slice(5)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Panel>
        <Panel title="Used in evaluation questions">
          {expectedBy.length ? (
            <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
              {expectedBy.map((q) => (
                <QuestionLink key={q.id} q={q} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Not an expected source of any question.</p>
          )}
        </Panel>
      </aside>
    </div>
  )
}

function QuestionLink({ q }: { q: RecordedQuestion }) {
  return (
    <li>
      <Link href={paths.ask(q.id)} className="inline-flex min-h-6 items-center pointer-coarse:min-h-11">
        <span>
          <span className="n">{q.id}</span> · {q.question}
        </span>
      </Link>
    </li>
  )
}

function Prop({ k, children, sans = false }: { k: string; children: ReactNode; sans?: boolean }) {
  return (
    <>
      <dt className="font-mono text-muted-foreground">{k}</dt>
      <dd className={cn('m-0 min-w-0 [overflow-wrap:anywhere]', !sans && 'font-mono')}>{children}</dd>
    </>
  )
}

function Panel({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="grid gap-1 border-b px-4 py-3.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {lead && <p className="text-[13px] text-muted-foreground">{lead}</p>}
      </div>
      <div className="grid gap-4 px-4 py-3.5">{children}</div>
    </section>
  )
}
