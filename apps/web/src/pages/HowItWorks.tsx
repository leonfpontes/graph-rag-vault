// The landing page (How it works): the scoreboard sentence as the H1, the share composition as the
// hero (a recorded question, its cited answer and the links it walked), then the four steps: notes
// become a typed graph, hybrid search with a reason for every result, answers that cite every
// sentence, and how it is measured; the quickstart; the footer. Every number comes from the demo's
// files (latest.json, questions.json, answers.json and the index), never typed here.
import { paths, QUICKSTART_COMMANDS, type Demo, type Scoreboard } from '@graph-rag/client'
import { DEFAULT_WEIGHTS, EMBEDDING_DIMS, type Reason } from '@graph-rag/search'
import { Button, Skeleton } from '@leonfpontes/atlas-ui'
import { CircleAlert, Info, Link2, ListOrdered, Spline, TriangleAlert, Type } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { AnswerText } from '../ask/Answer'
import { ReasonChip } from '../ask/Sources'
import { useDemo } from '../lib/demo'
import { pct } from '../lib/format'
import { ANSWERABLE_KINDS, headline, kindLine } from '../lib/headline'
import { GithubIcon } from '../lib/icons'
import { RELATIONS, TypeTag } from '../lib/notes'
import { Link } from '../lib/router'
import { featured, type Featured } from '../lib/share'
import { REPOSITORY_URL } from '../shell/AppShell'
import { CodeBlock } from '../shell/CodeBlock'
import { SiteFooter, SiteHeader, WRAP } from '../shell/Site'
import { DemoError } from '../shell/states'
import { usePageTitle } from '../shell/title'
import { PathFigure, pathText } from '../share/PathFigure'
import { KindCard, modelLabel } from './Evaluation'

/** The note section 1 shows: a decision with an owner, the meeting it was taken in, and the one it replaces. */
export const SAMPLE_NOTE = 'dec-switch-battery-voltaro'

const NAV = [
  { href: '#search', label: 'How it works' },
  { href: '#eval', label: 'Evaluation' },
  { href: '#quickstart', label: 'Quickstart' },
]

const TEXT_LINK =
  'text-primary underline decoration-1 underline-offset-4 outline-none hover:decoration-2 focus-visible:rounded-xs focus-visible:ring-[3px] focus-visible:ring-ring/50'
const PLAIN_LINK =
  'text-foreground no-underline outline-none hover:underline focus-visible:rounded-xs focus-visible:ring-[3px] focus-visible:ring-ring/50'

export function HowItWorks() {
  usePageTitle(undefined)
  const { state, retry } = useDemo()
  const demo = state.status === 'ready' ? state.demo : undefined
  const [f, setF] = useState<Featured>()
  useEffect(() => {
    if (demo) void featured(demo).then(setF)
  }, [demo])
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-3 focus:py-2 focus:ring-[3px] focus:ring-ring/50"
      >
        Skip to content
      </a>
      <SiteHeader nav={NAV} />
      <main id="main" tabIndex={-1} className={`${WRAP} outline-none`}>
        <Hero demo={demo} featured={f} />
        {state.status === 'error' && (
          <div className="mb-10 rounded-lg border bg-card p-4">
            <DemoError error={state.error} onRetry={retry} />
          </div>
        )}
        <GraphSection demo={demo} />
        <SearchSection demo={demo} featured={f} />
        <AnswersSection sb={demo?.scoreboard} />
        <MeasureSection demo={demo} />
        <Block id="quickstart" title="Quickstart" lead={<Quickstart demo={demo} />}>
          <CodeBlock lines={QUICKSTART_COMMANDS} className="max-w-[720px]" />
        </Block>
      </main>
      <SiteFooter />
    </div>
  )
}

function Hero({ demo, featured: f }: { demo?: Demo; featured?: Featured }) {
  const sb = demo?.scoreboard
  const h = sb && headline(sb)
  return (
    <section
      aria-labelledby="hero-title"
      className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-12 pt-12 pb-14 max-[1000px]:grid-cols-1 max-[760px]:gap-8 max-[760px]:py-9"
    >
      <div className="min-w-0">
        {sb?.rehearsal && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-warning/50 bg-warning-subtle px-2 py-0.5 text-xs font-medium text-warning">
            <Info aria-hidden="true" className="size-3" />
            Example numbers until the evaluation runs
          </span>
        )}
        <h1
          id="hero-title"
          className="mt-4 text-[44px] leading-[1.1] font-semibold tracking-[-0.03em] max-[760px]:text-[32px]"
        >
          {h ? h.short : 'Graph RAG over a Markdown vault'}
        </h1>
        {!sb && <Skeleton className="mt-3 h-7 w-3/4" />}
        {h?.sub && <p className="mt-3 max-w-[560px] text-lg font-medium">{h.sub}</p>}
        <p className="mt-[18px] max-w-[560px] text-lg leading-[1.6] text-muted-foreground">
          graph-rag-vault turns a folder of Markdown notes into a typed graph and answers questions with
          hybrid search: vectors, words and links. Every sentence of the answer cites the note it came from,
          and an evaluation measures what the graph adds.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href={paths.explore()}>Open the demo</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={REPOSITORY_URL}>
              <GithubIcon />
              Read the code
            </a>
          </Button>
        </div>
        <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
          <span>No key, no server: search runs in your browser</span>
          <span>MIT</span>
        </p>
      </div>
      <HeroCard demo={demo} featured={f} />
    </section>
  )
}

function HeroCard({ demo, featured: f }: { demo?: Demo; featured?: Featured }) {
  if (!demo || !f)
    return (
      <div className="grid gap-3 rounded-xl border bg-card p-6" aria-busy="true">
        <span className="sr-only">Loading a recorded answer</span>
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="aspect-[600/380] w-full" />
      </div>
    )
  return (
    <figure
      className="m-0 grid min-w-0 overflow-hidden rounded-xl border bg-card"
      aria-label="A recorded answer from the demo, with its sources and the path in the graph"
    >
      <p className="grid gap-1.5 px-6 pt-5 text-lg leading-[1.45] font-semibold max-[600px]:px-4">
        <small className="font-mono text-xs font-normal text-muted-foreground">
          {f.question.id} · {f.question.kind} · recorded answer
        </small>
        <Link href={paths.ask(f.question.id)} className={PLAIN_LINK}>
          {f.question.question}
        </Link>
      </p>
      <AnswerText
        demo={demo}
        sentences={f.sentences}
        cites={f.cites}
        sourceHref={(n) => `${paths.ask(f.question.id)}#src-${n}`}
        className="px-6 pt-3 pb-5 text-[17px] leading-[1.7] max-[600px]:px-4"
      />
      <div className="border-t bg-canvas px-3 pt-2">
        <PathFigure nodes={f.nodes} edges={f.edges} className="mx-auto max-w-[470px]" />
      </div>
      <figcaption className="bg-canvas px-6 pb-3.5 text-sm text-muted-foreground max-[600px]:px-4">
        The links the answer walked. Numbers match the citations.
        <span className="sr-only"> The path, as text: {pathText(f.nodes, f.edges).join('; ')}.</span>
      </figcaption>
    </figure>
  )
}

function Block({
  id,
  title,
  lead,
  children,
}: {
  id: string
  title: string
  lead: ReactNode
  children?: ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-4 gap-6 border-t py-14 max-[760px]:py-10"
    >
      <header className="grid max-w-[760px] gap-2">
        <h2 id={`${id}-title`} className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">
          {title}
        </h2>
        <p className="text-base leading-[1.6] text-muted-foreground">{lead}</p>
      </header>
      {children}
    </section>
  )
}

/** The note's frontmatter as the index read it: its fields, then its typed links (wikilinks by id). */
export function frontmatterLines(demo: Demo, id: string): string[] {
  const view = demo.note(id)
  if (!view) return []
  const n = view.note
  const out = view.links.filter((l) => l.direction === 'out' && l.relation !== 'mentions')
  const lines = [
    '---',
    `id: ${n.id}`,
    `type: ${n.type}`,
    `created: ${n.created}`,
    `updated: ${n.updated}`,
    `status: ${n.status}`,
  ]
  for (const rel of RELATIONS) {
    const targets = out.filter((l) => l.relation === rel).map((l) => `"[[${l.note.id}]]"`)
    if (targets.length === 1) lines.push(`${rel}: ${targets[0]}`)
    else if (targets.length) lines.push(`${rel}:`, ...targets.map((t) => `  - ${t}`))
  }
  lines.push('---', '', `# ${n.title}`)
  return lines
}

function GraphSection({ demo }: { demo?: Demo }) {
  const view = demo?.note(SAMPLE_NOTE)
  const out = view?.links.filter((l) => l.direction === 'out') ?? []
  return (
    <Block
      id="graph"
      title="1 · Notes become a typed graph"
      lead={
        <>
          Each note has a type and typed links in its frontmatter. Wikilinks in the text become{' '}
          <code className="font-mono text-[0.9em]">mentions</code>. The index keeps notes, links, chunks and
          embeddings in one SQLite file, and rebuilds only what changed.
        </>
      }
    >
      {!demo || !view ? (
        <Skeleton className="h-56 w-full" />
      ) : (
        <div className="grid grid-cols-2 items-start gap-6 max-[1000px]:grid-cols-1">
          <div className="min-w-0 overflow-hidden rounded-lg bg-code-bg text-code-fg">
            <div className="border-b border-white/10 px-3.5 py-2.5 font-mono text-xs text-code-dim">
              {view.note.path}
            </div>
            <pre
              className="m-0 overflow-x-auto px-3.5 py-3 font-mono text-[13px] leading-[1.7] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              tabIndex={0}
              aria-label={`Frontmatter of ${view.note.path}`}
            >
              {frontmatterLines(demo, SAMPLE_NOTE).join('\n')}
            </pre>
          </div>
          <div
            role="region"
            aria-labelledby="links-caption"
            tabIndex={0}
            className="min-w-0 overflow-x-auto rounded-lg border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <table className="w-max min-w-full text-sm">
              <caption id="links-caption" className="sr-only">
                Links the ingestion extracts from this note
              </caption>
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    From
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Link
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    To
                  </th>
                </tr>
              </thead>
              <tbody>
                {out.map((l) => (
                  <tr key={`${l.relation}|${l.note.id}`} className="border-t">
                    <td className="px-3 py-2">this note</td>
                    <td className="n px-3 py-2">{l.relation}</td>
                    <td className="px-3 py-2">
                      <Link href={paths.note(l.note.id)} className={PLAIN_LINK}>
                        <TypeTag type={l.note.type}>{l.note.title}</TypeTag>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Block>
  )
}

/** One reason of each kind from the featured question's results: what a result says about itself. */
export function sampleReasons(demo: Demo, f: Featured): Reason[] {
  const hits = demo.search({ question: f.question.id, variant: 'hybrid' }).hits.slice(0, 5)
  const seen = new Set<string>()
  const out: Reason[] = []
  for (const h of hits)
    for (const r of h.reasons) {
      if (seen.has(r.kind)) continue
      seen.add(r.kind)
      out.push(r)
    }
  return out
}

function SearchSection({ demo, featured: f }: { demo?: Demo; featured?: Featured }) {
  const steps: { step: string; icon: ReactNode; title: string; text: string }[] = [
    {
      step: '1 · in parallel',
      icon: <Spline aria-hidden="true" />,
      title: 'Vectors',
      text: `${EMBEDDING_DIMS}-dimension embeddings of each chunk, cosine top ${DEFAULT_WEIGHTS.listDepth}. The same open model runs in Node and in your browser.`,
    },
    {
      step: '1 · in parallel',
      icon: <Type aria-hidden="true" />,
      title: 'Words and titles',
      text: 'Titles, aliases and full-text search (BM25), so a question that names a note by an alias still finds it.',
    },
    {
      step: '2',
      icon: <Link2 aria-hidden="true" />,
      title: 'Graph, 1 to 2 hops',
      text: 'From the candidates, follow typed links, weighted by link type; a superseded note ranks lower and the newer note gains.',
    },
    {
      step: '3',
      icon: <ListOrdered aria-hidden="true" />,
      title: 'Fusion',
      text: 'Reciprocal rank fusion (RRF) of the lists; no model call. The top 5 go to the answer.',
    },
  ]
  const hits = demo && f ? demo.search({ question: f.question.id, variant: 'hybrid' }).hits.slice(0, 5) : []
  const rank = new Map(hits.map((h, i) => [h.noteId, i + 1]))
  return (
    <Block
      id="search"
      title="2 · Hybrid search, with a reason for every result"
      lead="Three signals find candidates; one fusion step ranks them. Each result says why it is there, so a wrong answer can be traced to the search."
    >
      <ol className="m-0 grid list-none grid-cols-4 rounded-lg border bg-card p-0 max-[1000px]:grid-cols-2 max-[760px]:grid-cols-1">
        {steps.map((s, i) => (
          <li
            key={s.title}
            data-step={i + 1}
            className="grid content-start gap-2 border-r p-4 last:border-r-0 max-[1000px]:nth-2:border-r-0 max-[1000px]:nth-[-n+2]:border-b max-[760px]:border-r-0 max-[760px]:border-b max-[760px]:last:border-b-0"
          >
            <span className="font-mono text-xs font-medium text-muted-foreground">{s.step}</span>
            <h3 className="flex items-center gap-2 text-[15px] font-semibold [&_svg]:size-4">
              {s.icon}
              {s.title}
            </h3>
            <p className="text-sm leading-[1.55] text-muted-foreground">{s.text}</p>
          </li>
        ))}
      </ol>
      {demo && f && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            What the results of “{f.question.question}” say about themselves:
          </p>
          <ul aria-label="Reasons a result shows" className="m-0 flex list-none flex-wrap gap-2 p-0">
            {sampleReasons(demo, f).map((r) => (
              <li key={r.kind} className="max-w-full">
                <ReasonChip
                  reason={r}
                  rankOf={(id) => rank.get(id)}
                  titleOf={(id) => demo.note(id)?.note.title ?? id}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Block>
  )
}

function AnswersSection({ sb }: { sb?: Scoreboard }) {
  const rules: { icon: ReactNode; text: string }[] = [
    {
      icon: <ListOrdered aria-hidden="true" />,
      text: 'Each sentence ends with the number of its source; the number opens the exact chunk.',
    },
    {
      icon: <TriangleAlert aria-hidden="true" />,
      text: 'A sentence with no source is removed, and the page says what was removed.',
    },
    {
      icon: <CircleAlert aria-hidden="true" />,
      text: 'When no note answers the question, the reply is “I don’t know”, with the closest notes.',
    },
  ]
  return (
    <Block
      id="answers"
      title="3 · Answers cite every sentence"
      lead={
        sb
          ? `The model, ${modelLabel(sb.models.answer)}, answers only from the top 5 chunks.`
          : 'The model answers only from the top 5 chunks.'
      }
    >
      <ul className="m-0 grid list-none gap-3 p-0">
        {rules.map((r) => (
          <li
            key={r.text}
            className="grid grid-cols-[24px_minmax(0,1fr)] gap-2 text-[15px] leading-[1.55] [&_svg]:mt-[3px] [&_svg]:size-4"
          >
            {r.icon}
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
    </Block>
  )
}

/** The person's check and the second judge, in one clause (the Evaluation page has the full card). */
export function judgeClause(sb: Scoreboard): string {
  const hu = sb.human
  const sj = sb.secondJudge
  const parts: string[] = []
  if (hu) {
    const blind = hu.blindPart
    const agreedAll = Math.round(hu.observed * hu.items)
    if (hu.blind === false) {
      const reviewed = hu.items - (blind?.items ?? 0)
      parts.push(
        `the person agreed on ${agreedAll - (blind?.agreed ?? 0)} of ${reviewed} sentences reviewed not blind${blind ? ` and on ${blind.agreed} of ${blind.items} labelled blind` : ''}`,
      )
    } else parts.push(`the person agreed on ${agreedAll} of ${hu.items} sentences, labelled blind`)
  }
  if (sj) parts.push(`the second judge agreed on ${pct(sj.observed)}`)
  return parts.length ? `${parts.join('; ')}.` : ''
}

function MeasureSection({ demo }: { demo?: Demo }) {
  const sb = demo?.scoreboard
  const questions = demo?.questions ?? []
  const kinds = new Set(questions.map((q) => q.kind)).size
  const tuned = questions.filter((q) => q.split !== 'test').length
  const kl = sb && kindLine(sb)
  return (
    <Block
      id="eval"
      title="4 · How we measure"
      lead={
        sb
          ? `${questions.length} questions with the notes that should answer them, in ${kinds} kinds: fact, multi-hop, temporal and no answer. ${tuned} of them tuned the weights; the scoreboard uses the other ${sb.questions.total}, in 3 variants: vectors only, graph only and hybrid.`
          : 'Questions with the notes that should answer them, in 3 variants: vectors only, graph only and hybrid.'
      }
    >
      {!sb ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {kl && <p className="max-w-[760px] text-lg font-medium">{kl.text}</p>}
          <div className="grid grid-cols-3 gap-4 max-[900px]:grid-cols-1">
            {ANSWERABLE_KINDS.map((k) => (
              <KindCard key={k} sb={sb} kind={k} />
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Recall@5: the share of the expected notes in the top 5. Faithfulness is judged sentence by
            sentence by {modelLabel(sb.models.judge)}, reviewed by a person and by a second, blind judge:{' '}
            {judgeClause(sb)}{' '}
            <Link href={paths.evaluation()} className={TEXT_LINK}>
              Full scoreboard
            </Link>
          </p>
        </>
      )}
    </Block>
  )
}

function Quickstart({ demo }: { demo?: Demo }) {
  return demo
    ? `Three commands, no key. The demo opens the Tarnwick Cycles vault, ${demo.index.notes.length} fictional notes.`
    : 'Three commands, no key. The demo opens the Tarnwick Cycles vault of fictional notes.'
}
