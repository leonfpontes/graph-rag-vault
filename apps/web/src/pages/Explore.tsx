// Explore: filters (note and link types, with counts) | the graph | the selected note. Phones open on a
// map with one bubble per constellation (tapping one opens it in 2D), the search above the canvas and
// the filters in a sheet; 3D is not offered there. The List view gives keyboards and screen readers
// the same constellations. Every state has an address: ?focus=<note>, ?cluster=<project>, ?view=.
import type { Demo, GraphView, NoteView } from '@graph-rag/client'
import { paths } from '@graph-rag/client'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@leonfpontes/atlas-ui'
import { ChevronDown, Filter, MessageCircleQuestionMark, Search, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import { GraphCanvas } from '../graph/GraphCanvas'
import { constellations, layout } from '../graph/layout'
import type { SceneOptions } from '../graph/scene'
import { useDemo } from '../lib/demo'
import { plural, shortDate, thousands } from '../lib/format'
import { NARROW, PHONE, useMedia } from '../lib/media'
import { NOTE_TYPES, RELATIONS, Shape, TYPE_LABEL, TypeTag } from '../lib/notes'
import { Link, useRouter, withParams } from '../lib/router'
import { DemoError, DownloadStatus } from '../shell/states'
import { usePageTitle } from '../shell/title'

type ViewName = '3d' | '2d' | 'list' | 'map'

/** The question Ask opens with, from a note: in the box, not asked yet. */
export const askAbout = (title: string) =>
  `${paths.ask()}?draft=${encodeURIComponent(`What do the notes say about ${title}?`)}`

export function Explore() {
  usePageTitle('Explore')
  const { state, retry } = useDemo()
  const { location, navigate } = useRouter()
  const phone = useMedia(PHONE)
  const narrow = useMedia(NARROW)
  const focus = location.search.get('focus') ?? undefined
  const cluster = location.search.get('cluster') ?? undefined
  const asked = location.search.get('view') as ViewName | null
  const fallback: ViewName = phone ? (focus || cluster ? '2d' : 'map') : '3d'
  const view: ViewName = asked && (phone ? asked !== '3d' : asked !== 'map') ? asked : fallback
  const [types, setTypes] = useState<ReadonlySet<string>>(() => new Set(NOTE_TYPES))
  const [relations, setRelations] = useState<ReadonlySet<string>>(() => new Set(RELATIONS))
  const [query, setQuery] = useState('')
  const demo = state.status === 'ready' ? state.demo : undefined
  const graph = useMemo(() => demo?.graph(), [demo])
  const noFocus = (focus && demo && !demo.note(focus)) || undefined
  const matches = useMemo(() => (graph ? findNotes(graph, query) : []), [graph, query])
  const empty = (query.trim() !== '' && matches.length === 0) || types.size === 0

  const go = (changes: Record<string, string | null>) => navigate(withParams(location, changes))
  const setView = (v: string) => go({ view: v === fallback ? null : v })
  const select = (id: string) => go({ focus: id, cluster: null })
  const openCluster = (id: string) => go({ cluster: id, focus: null, view: phone ? '2d' : null })
  const clear = () => {
    setQuery('')
    setTypes(new Set(NOTE_TYPES))
    setRelations(new Set(RELATIONS))
  }

  const options = useMemo<SceneOptions>(
    () => ({
      mode: view === '3d' ? '3d' : '2d',
      summary: view === 'map',
      focus: noFocus ? undefined : focus,
      cluster,
      types,
      relations,
      rotate: !focus && !cluster,
      zoom: focus ? 1.6 : 1,
    }),
    [view, focus, noFocus, cluster, types, relations],
  )

  const filters = graph ? (
    <FilterLists
      graph={graph}
      types={types}
      relations={relations}
      onTypes={setTypes}
      onRelations={setRelations}
    />
  ) : null
  const preview =
    demo && graph ? (
      <Preview demo={demo} graph={graph} focus={noFocus ? undefined : focus} cluster={cluster} />
    ) : null

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-4 pb-12 md:px-6 md:pt-6">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Explore</h1>
        {graph && (
          <span className="n w-full text-[13px] text-muted-foreground md:w-auto">
            {thousands(graph.nodes.length)} notes · {thousands(graph.links.length)} links
          </span>
        )}
        {phone && graph && (
          <div className="flex w-full gap-2">
            <NoteSearch graph={graph} query={query} onQuery={setQuery} matches={matches} onPick={select} />
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Filter note types (${types.size} of ${NOTE_TYPES.length} shown)`}
                >
                  <Filter aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85vh]">
                <SheetHeader>
                  <SheetTitle>Filters</SheetTitle>
                  <SheetDescription>Note types and link types on the graph.</SheetDescription>
                </SheetHeader>
                <ScrollArea className="min-h-0 flex-1 px-4 pb-4">{filters}</ScrollArea>
              </SheetContent>
            </Sheet>
          </div>
        )}
      </div>
      <div
        className={cn(
          'grid gap-4',
          phone
            ? 'grid-cols-1'
            : narrow
              ? 'h-[calc(100vh-56px-24px-44px-48px)] min-h-[560px] grid-cols-[220px_minmax(0,1fr)]'
              : 'h-[calc(100vh-56px-24px-44px-48px)] min-h-[560px] grid-cols-[248px_minmax(0,1fr)_320px]',
        )}
      >
        {!phone && (
          <aside
            aria-labelledby="filters-h"
            className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card"
          >
            <div className="border-b px-4 py-3.5">
              <h2 id="filters-h" className="text-sm font-semibold">
                Note types
              </h2>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-4 py-3.5">{filters}</div>
            </ScrollArea>
          </aside>
        )}
        <section
          aria-label="Graph of the Tarnwick Cycles vault"
          data-graph-area
          className={cn('relative min-h-0 min-w-0', phone && 'h-[440px]')}
        >
          {state.status === 'loading' && (
            <CanvasState>
              <DownloadStatus download={state.download} />
            </CanvasState>
          )}
          {state.status === 'error' && (
            <CanvasState>
              <DemoError error={state.error} onRetry={retry} />
            </CanvasState>
          )}
          {graph && (
            <Tabs value={view} onValueChange={setView} className="absolute inset-0 block">
              {[phone ? 'map' : '3d', '2d', 'list'].map((v) => (
                <TabsContent key={v} value={v} className="absolute inset-0 rounded-lg">
                  {v !== view ? null : v === 'list' ? (
                    <ListView graph={graph} phone={phone} />
                  ) : (
                    <GraphCanvas
                      graph={graph}
                      options={options}
                      label={graphLabel(graph, demo!, focus, cluster)}
                      zoomControls={view === 'map' ? false : phone ? 'reset' : 'full'}
                      className="absolute inset-0"
                      onSelect={select}
                      onCluster={openCluster}
                    />
                  )}
                </TabsContent>
              ))}
              {!phone && (
                <div
                  data-graph-control
                  className="absolute top-3 left-3 z-10 w-[min(320px,calc(100%-200px))]"
                >
                  <NoteSearch
                    graph={graph}
                    query={query}
                    onQuery={setQuery}
                    matches={matches}
                    onPick={select}
                    shortcut
                  />
                </div>
              )}
              <TabsList
                data-graph-control
                aria-label="View"
                className={cn('absolute top-3 z-10 bg-background', phone ? 'left-3' : 'right-3')}
              >
                <TabsTrigger value={phone ? 'map' : '3d'}>{phone ? 'Map' : '3D'}</TabsTrigger>
                <TabsTrigger value="2d">2D</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
              </TabsList>
              {view !== 'list' && !phone && (
                <p
                  data-graph-control
                  className="n absolute bottom-3 left-3 rounded-sm border bg-background/90 px-2 py-1 text-xs text-muted-foreground"
                >
                  {view === '3d'
                    ? 'Drag to orbit · scroll to zoom · click a note'
                    : 'Drag to pan · scroll to zoom · click a note'}
                </p>
              )}
              {empty && view !== 'list' && (
                <CanvasState>
                  <div className="grid max-w-[380px] justify-items-start gap-3">
                    <Search aria-hidden="true" className="size-4 text-muted-foreground" />
                    <h2 className="text-base font-semibold">
                      {types.size === 0 ? 'Every note type is hidden' : `No note matches “${query.trim()}”`}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {types.size === 0
                        ? 'Turn a note type back on to see its notes.'
                        : 'The search looks at titles and aliases. Try a shorter word, or turn the hidden types back on.'}
                    </p>
                    <Button variant="outline" onClick={clear}>
                      Clear search and filters
                    </Button>
                  </div>
                </CanvasState>
              )}
            </Tabs>
          )}
        </section>
        {!narrow && (
          <aside
            aria-label="Selected note"
            className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card"
          >
            {preview}
          </aside>
        )}
      </div>
      {narrow && preview && (
        <aside aria-label="Selected note" className="mt-3 overflow-hidden rounded-lg border bg-card">
          {preview}
        </aside>
      )}
    </div>
  )
}

function CanvasState({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center rounded-lg border bg-(--canvas) p-6">
      {children}
    </div>
  )
}

function graphLabel(graph: GraphView, demo: Demo, focus?: string, cluster?: string) {
  const f = focus ? demo.note(focus) : undefined
  const c = cluster ? demo.note(cluster) : undefined
  const projects = graph.nodes.filter((n) => n.type === 'project').length
  return `Graph of ${graph.nodes.length} notes in ${projects} constellations, one per project.${f ? ` Selected: ${f.note.title}.` : ''}${c ? ` Showing the ${c.note.title} constellation.` : ''} Use the List view to browse with a keyboard or screen reader.`
}

/** Notes whose title or alias contains the words, titles first. */
export function findNotes(graph: GraphView, query: string, aliases?: Map<string, string[]>) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return graph.nodes
    .map((n) => {
      const t = n.title.toLowerCase()
      const a = aliases?.get(n.id) ?? []
      const rank = t.startsWith(q)
        ? 0
        : t.includes(q)
          ? 1
          : a.some((x) => x.toLowerCase().includes(q))
            ? 2
            : -1
      return { n, rank }
    })
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.n.title.localeCompare(b.n.title))
    .map((x) => x.n)
}

function NoteSearch({
  graph,
  query,
  onQuery,
  matches,
  onPick,
  shortcut = false,
}: {
  graph: GraphView
  query: string
  onQuery: (q: string) => void
  matches: GraphView['nodes']
  onPick: (id: string) => void
  shortcut?: boolean
}) {
  const { state } = useDemo()
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  // Aliases come from the index (the graph view has titles only).
  const aliasMatches = useMemo(() => {
    if (state.status !== 'ready' || !query.trim()) return matches
    const aliases = new Map(state.demo.index.notes.map((n) => [n.id, n.aliases]))
    return findNotes(graph, query, aliases)
  }, [state, graph, query, matches])
  const shown = aliasMatches.slice(0, 8)
  useEffect(() => {
    if (!shortcut) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key !== '/' || t.closest('input, textarea, [contenteditable]')) return
      e.preventDefault()
      input.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shortcut])
  const pick = (id: string) => {
    onPick(id)
    setOpen(false)
  }
  const expanded = open && shown.length > 0
  return (
    <div className="relative min-w-0 flex-1">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={input}
        role="combobox"
        aria-label="Find a note"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        placeholder="Find a note by title or alias"
        value={query}
        onChange={(e) => {
          onQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(a + 1, shown.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && shown[active]) {
            e.preventDefault()
            pick(shown[active]!.id)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-9 text-sm text-foreground outline-none placeholder:text-text-subtle focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 md:text-sm"
      />
      {shortcut && (
        <kbd
          aria-hidden="true"
          className="n pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-sm border px-1.5 text-xs text-muted-foreground"
        >
          /
        </kbd>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label="Notes"
        hidden={!expanded}
        className="absolute top-[calc(100%+4px)] right-0 left-0 z-30 m-0 grid list-none gap-0.5 rounded-md border bg-popover p-1 shadow-overlay"
      >
        {shown.map((n, i) => (
          <li
            key={n.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault()
              pick(n.id)
            }}
            onMouseEnter={() => setActive(i)}
            className={cn(
              'flex min-h-10 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm pointer-coarse:min-h-11',
              i === active && 'bg-accent',
            )}
          >
            <Shape type={n.type} />
            <span className="min-w-0 flex-1 truncate">{n.title}</span>
            <span className="text-xs text-muted-foreground">
              {TYPE_LABEL[n.type as keyof typeof TYPE_LABEL] ?? n.type}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FilterLists({
  graph,
  types,
  relations,
  onTypes,
  onRelations,
}: {
  graph: GraphView
  types: ReadonlySet<string>
  relations: ReadonlySet<string>
  onTypes: (s: ReadonlySet<string>) => void
  onRelations: (s: ReadonlySet<string>) => void
}) {
  const typeCount = (t: string) => graph.nodes.filter((n) => n.type === t).length
  const relCount = (r: string) => graph.links.filter((l) => l.relation === r).length
  const flip = (set: ReadonlySet<string>, key: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(key)
    else next.delete(key)
    return next
  }
  return (
    <div className="grid gap-4">
      <ul className="m-0 grid list-none gap-0.5 p-0" aria-label="Note types">
        {NOTE_TYPES.map((t) => (
          <FilterRow
            key={t}
            checked={types.has(t)}
            onChange={(on) => onTypes(flip(types, t, on))}
            count={typeCount(t)}
          >
            <Shape type={t} />
            <span>{TYPE_LABEL[t]}</span>
          </FilterRow>
        ))}
      </ul>
      <div className="grid gap-2">
        <h2 className="text-sm font-semibold">Links</h2>
        <ul className="m-0 grid list-none gap-0.5 p-0" aria-label="Link types">
          {RELATIONS.map((r) => (
            <FilterRow
              key={r}
              checked={relations.has(r)}
              onChange={(on) => onRelations(flip(relations, r, on))}
              count={relCount(r)}
            >
              <span className="w-3.5" aria-hidden="true" />
              <span className="font-mono text-[13px]">{r}</span>
            </FilterRow>
          ))}
        </ul>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Shape tells the type; color only helps. A note with more links draws bigger.
      </p>
    </div>
  )
}

function FilterRow({
  checked,
  onChange,
  count,
  children,
}: {
  checked: boolean
  onChange: (on: boolean) => void
  count: number
  children: ReactNode
}) {
  return (
    <li>
      <label className="-mx-2 grid min-h-10 cursor-pointer grid-cols-[16px_14px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2 text-sm hover:bg-accent pointer-coarse:min-h-11">
        <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
        {children}
        <span className="n text-[13px] text-muted-foreground">{count}</span>
      </label>
    </li>
  )
}

function ListView({ graph, phone }: { graph: GraphView; phone: boolean }) {
  const L = layout(graph, '2d')
  const groups = constellations(L)
  const loose = L.nodes.flatMap((_, i) => (L.community[i] === -1 ? [i] : []))
  const order = (a: number, b: number) =>
    NOTE_TYPES.indexOf(L.nodes[a]!.type as never) - NOTE_TYPES.indexOf(L.nodes[b]!.type as never) ||
    L.nodes[a]!.title.localeCompare(L.nodes[b]!.title)
  return (
    <ScrollArea aria-label="Notes by constellation" className="absolute inset-0 rounded-lg border bg-card">
      <ul className="m-0 list-none p-0 pt-16">
        {groups.map(({ seed, members }, k) => (
          <ConstellationBlock
            key={seed}
            title={L.nodes[seed]!.title}
            count={members.length}
            projectId={L.nodes[seed]!.id}
            defaultOpen={k === 0}
            phone={phone}
          >
            {members.sort(order).map((i) => (
              <NoteRow key={i} node={L.nodes[i]!} />
            ))}
          </ConstellationBlock>
        ))}
        {loose.length > 0 && (
          <ConstellationBlock
            title="Not linked to a project"
            count={loose.length}
            defaultOpen={false}
            phone={phone}
          >
            {loose.sort(order).map((i) => (
              <NoteRow key={i} node={L.nodes[i]!} />
            ))}
          </ConstellationBlock>
        )}
      </ul>
    </ScrollArea>
  )
}

function ConstellationBlock({
  title,
  count,
  projectId,
  defaultOpen,
  phone,
  children,
}: {
  title: string
  count: number
  projectId?: string
  defaultOpen: boolean
  phone: boolean
  children: ReactNode
}) {
  const { location } = useRouter()
  return (
    <li>
      <Collapsible defaultOpen={defaultOpen}>
        <div className="flex min-h-14 items-center gap-2.5 border-b px-4 py-1.5">
          <CollapsibleTrigger className="group flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90"
            />
            {projectId && <Shape type="project" />}
            <span className="min-w-0">
              <strong className="font-semibold">{title}</strong>{' '}
              <span className="n text-muted-foreground">{plural(count, 'note')}</span>
            </span>
          </CollapsibleTrigger>
          {projectId && (
            <Button asChild variant="outline">
              <Link
                href={withParams(location, { cluster: projectId, focus: null, view: phone ? '2d' : null })}
                aria-label={`Show ${title} in the graph`}
              >
                Show in graph
              </Link>
            </Button>
          )}
        </div>
        <CollapsibleContent>
          <ul className="m-0 list-none p-0">{children}</ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function NoteRow({ node }: { node: GraphView['nodes'][number] }) {
  return (
    <li>
      <Link
        href={paths.note(node.id)}
        className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b py-0 pr-4 pl-11 text-sm text-foreground no-underline outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span className="inline-flex min-w-0 items-start gap-1.5 py-2 text-[13px] leading-snug font-medium">
          <Shape type={node.type} className="mt-0.5" />
          <span>{node.title}</span>
        </span>
        <span className="n text-[13px] text-muted-foreground">{node.updated}</span>
      </Link>
    </li>
  )
}

function Preview({
  demo,
  graph,
  focus,
  cluster,
}: {
  demo: Demo
  graph: GraphView
  focus?: string
  cluster?: string
}) {
  const view = focus ? demo.note(focus) : undefined
  if (view) return <NotePreview view={view} />
  const L = layout(graph, '2d')
  const c = cluster === undefined ? undefined : L.index.get(cluster)
  if (c !== undefined && L.nodes[c]!.type === 'project') {
    const members = L.nodes.flatMap((n, i) => (L.community[i] === c ? [n] : []))
    return (
      <>
        <div className="grid gap-1 border-b px-4 py-3.5">
          <span className="text-[13px] text-muted-foreground">Constellation</span>
          <h2 className="text-lg leading-snug font-semibold">{L.nodes[c]!.title}</h2>
          <p className="n text-[13px] text-muted-foreground">
            {members.length} notes closest to this project
          </p>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-4 px-4 py-3.5">
            <ul className="m-0 grid list-none gap-0.5 p-0">
              {NOTE_TYPES.map((t) => [t, members.filter((n) => n.type === t).length] as const)
                .filter(([, n]) => n > 0)
                .map(([t, n]) => (
                  <li
                    key={t}
                    className="grid min-h-8 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 text-sm"
                  >
                    <Shape type={t} />
                    <span>{TYPE_LABEL[t]}</span>
                    <span className="n text-xs text-muted-foreground">{n}</span>
                  </li>
                ))}
            </ul>
            <div className="grid gap-2">
              <Button asChild>
                <Link href={paths.note(L.nodes[c]!.id)}>Open project note</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={paths.explore()}>Show all constellations</Link>
              </Button>
            </div>
          </div>
        </ScrollArea>
      </>
    )
  }
  const groups = constellations(L)
  return (
    <>
      <div className="grid gap-1 border-b px-4 py-3.5">
        <h2 className="text-sm font-semibold">
          {graph.nodes.length} notes, {L.seeds.length} projects
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Each constellation gathers the people, meetings, decisions and documents closest to one project.
          Click a note to see its neighbors.
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-3 px-4 py-3.5">
          <h3 className="text-[13px] font-medium text-muted-foreground">Biggest constellations</h3>
          <ol className="m-0 grid list-none gap-0.5 p-0">
            {groups.slice(0, 6).map(({ seed, members }) => (
              <li key={seed}>
                <Link
                  href={`${paths.explore()}?cluster=${L.nodes[seed]!.id}`}
                  aria-label={`Show the ${L.nodes[seed]!.title} constellation`}
                  className="-mx-2 grid min-h-10 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-sm text-foreground no-underline outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
                >
                  <Shape type="project" />
                  <span className="truncate">{L.nodes[seed]!.title}</span>
                  <span className="n text-xs text-muted-foreground">{plural(members.length, 'note')}</span>
                </Link>
              </li>
            ))}
          </ol>
          <Alert>
            <MessageCircleQuestionMark aria-hidden="true" />
            <AlertTitle>Ask a question</AlertTitle>
            <AlertDescription>
              <p>
                The path of the answer lights up in this graph. <Link href={paths.ask()}>Open Ask</Link>
              </p>
            </AlertDescription>
          </Alert>
        </div>
      </ScrollArea>
    </>
  )
}

function NotePreview({ view }: { view: NoteView }) {
  const { note, links, replacedBy } = view
  const out = links.filter((l) => l.direction === 'out').length
  return (
    <>
      <div className="grid gap-1.5 border-b px-4 py-3.5">
        <TypeTag type={note.type} />
        <h2 className="text-lg leading-snug font-semibold">{note.title}</h2>
        <p className="n text-[13px] text-muted-foreground">
          {/* Breaks only after a "/" (or at a hyphen), never inside a word. */}
          {note.path.split('/').map((part, i, all) => (
            <span key={i}>
              {part}
              {i < all.length - 1 && (
                <>
                  /<wbr />
                </>
              )}
            </span>
          ))}
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-4 px-4 py-3.5">
          {note.status === 'superseded' && (
            <Alert variant="warning">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>Superseded</AlertTitle>
              <AlertDescription>
                <p>
                  {replacedBy ? (
                    <>
                      <Link href={paths.note(replacedBy.id)}>{replacedBy.title}</Link> replaces this note.
                    </>
                  ) : (
                    'A newer note replaces this one.'
                  )}{' '}
                  Answers prefer the newer note.
                </p>
              </AlertDescription>
            </Alert>
          )}
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-muted-foreground">Updated</dt>
            <dd className="n m-0">{shortDate(note.updated)}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="m-0">{note.status}</dd>
            {note.aliases.length > 0 && (
              <>
                <dt className="text-muted-foreground">Aliases</dt>
                <dd className="m-0 [overflow-wrap:anywhere]">{note.aliases.join(', ')}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Links</dt>
            <dd className="n m-0">
              {out} out · {links.length - out} in
            </dd>
          </dl>
          {links.length > 0 && (
            <div className="grid gap-1.5">
              <h3 className="text-[13px] font-medium text-muted-foreground">Neighbors</h3>
              <ul className="m-0 grid list-none gap-0.5 p-0">
                {links.slice(0, 8).map((l) => (
                  <li key={`${l.relation}-${l.direction}-${l.note.id}`}>
                    <Link
                      href={paths.note(l.note.id)}
                      className="-mx-2 grid min-h-10 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 text-sm leading-snug text-foreground no-underline outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
                    >
                      <Shape type={l.note.type} />
                      <span>{l.note.title}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {l.direction === 'out' ? `→ ${l.relation}` : `← ${l.relation}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-2">
            <Button asChild>
              <Link href={paths.note(note.id)}>Open note</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={askAbout(note.title)}>
                <MessageCircleQuestionMark aria-hidden="true" />
                Ask about this note
              </Link>
            </Button>
          </div>
        </div>
      </ScrollArea>
    </>
  )
}
