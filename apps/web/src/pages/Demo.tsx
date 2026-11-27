// The stage the README GIF and the video are recorded from, frame by frame (not a page for people:
// only with ?record, else the 404). Every scene is a pure function of the clock
// (window.__setTime(ms)), so two recordings give the same frames. /demo?record plays the video's 60 s;
// &mode=gif the GIF's 20 s. Every word and number on it comes from the demo's files.
import { QUICKSTART_COMMANDS, type Demo as DemoData } from '@graph-rag/client'
import type { Citation } from '@graph-rag/answer/passages'
import type { SearchHit } from '@graph-rag/search'
import { cn } from '@leonfpontes/atlas-ui'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { ReasonChip } from '../ask/Sources'
import { useDemo } from '../lib/demo'
import {
  captions,
  GIF_MS,
  GIF_SCENES,
  progress,
  REPO,
  sceneAt,
  shown,
  VIDEO_MS,
  VIDEO_SCENES,
  type Caption,
  type Scene,
} from '../lib/demo-script'
import { ANSWERABLE_KINDS, headline } from '../lib/headline'
import { Mark } from '../lib/icons'
import { TypeTag } from '../lib/notes'
import { useRouter } from '../lib/router'
import { featured, sentenceCites, type Featured } from '../lib/share'
import { CodeBlock } from '../shell/CodeBlock'
import { PathFigure } from '../share/PathFigure'
import { KindCard } from './Evaluation'

declare global {
  interface Window {
    __setTime?: (ms: number) => void
    __demoReady?: boolean
    __demoCaptions?: { video: Caption[]; gif: Caption[] }
  }
}

const TITLE: Record<Scene['name'], string> = {
  ask: 'Ask',
  sources: 'Ask · sources',
  answer: 'Ask · answer',
  citation: 'Ask · citation',
  evaluation: 'Evaluation',
  end: 'How it works',
}

const CHIP =
  'mx-px inline rounded-sm border border-evidence/45 bg-evidence-subtle px-1.5 align-[1px] font-mono text-[13px] leading-none font-semibold whitespace-nowrap text-evidence'
const CHIP_ON = 'bg-evidence text-evidence-foreground'

export function Demo() {
  const { state } = useDemo()
  const { location } = useRouter()
  const gif = location.search.get('mode') === 'gif'
  const demo = state.status === 'ready' ? state.demo : undefined
  const [f, setF] = useState<Featured>()
  const [t, setT] = useState(0)
  useEffect(() => {
    if (demo) void featured(demo).then(setF)
  }, [demo])
  const hits = useMemo(
    () => (demo && f ? demo.search({ question: f.question.id, variant: 'hybrid' }).hits.slice(0, 5) : []),
    [demo, f],
  )
  useEffect(() => {
    window.__setTime = setT
    if (!demo || !f) return
    window.__demoCaptions = {
      video: captions(VIDEO_SCENES, f, demo.scoreboard, hits.length),
      gif: captions(GIF_SCENES, f, demo.scoreboard, hits.length),
    }
    window.__demoReady = true
  }, [demo, f, hits.length])
  if (!demo || !f) return <p className="p-6 text-sm text-muted-foreground">Loading the demo…</p>
  const scenes = gif ? GIF_SCENES : VIDEO_SCENES
  const scene = sceneAt(scenes, Math.min(t, (gif ? GIF_MS : VIDEO_MS) - 1))
  const caption = captions(scenes, f, demo.scoreboard, hits.length).find((c) => t >= c.from && t < c.to)
  return (
    <div className="grid min-h-screen place-items-start bg-muted p-6">
      <div
        id="stage"
        data-scene={scene.name}
        className="grid h-[720px] w-[1280px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-background"
      >
        <div className="flex h-14 items-center gap-3 border-b px-6 text-[16px] font-semibold">
          <Mark size={22} />
          graph-rag-vault
          <span className="text-text-subtle">/</span>
          <span className="font-normal text-muted-foreground">{TITLE[scene.name]}</span>
          <span className="ml-auto font-mono text-[13px] font-normal text-muted-foreground">
            {f.question.id} · recorded answer
          </span>
        </div>
        <div className="min-h-0 px-10 py-8">
          <SceneView scene={scene} t={t} demo={demo} f={f} hits={hits} gif={gif} />
        </div>
        <p className="flex h-[76px] items-center bg-[#11151c] px-10 text-[22px] leading-snug font-medium text-white">
          {caption?.text}
        </p>
      </div>
    </div>
  )
}

function SceneView({
  scene,
  t,
  demo,
  f,
  hits,
  gif,
}: {
  scene: Scene
  t: number
  demo: DemoData
  f: Featured
  hits: SearchHit[]
  gif: boolean
}) {
  switch (scene.name) {
    case 'ask':
      return <AskScene scene={scene} t={t} f={f} />
    case 'sources':
      return (
        <Sources
          demo={demo}
          hits={hits}
          count={shown(scene, t, hits.length, gif ? 300 : 600, gif ? 600 : 1400)}
        />
      )
    case 'answer': {
      const step = gif ? 1800 : 3200
      return (
        <AnswerScene
          f={f}
          sentences={shown(scene, t, f.sentences.length, 300, step)}
          lit={shown(scene, t, f.edges.length, 900, step)}
        />
      )
    }
    case 'citation':
      return <CitationScene demo={demo} f={f} />
    case 'evaluation':
      return <EvaluationScene demo={demo} />
    case 'end':
      return <EndScene />
  }
}

function Panel({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border bg-card p-6', className)}>
      {title && <p className="mb-3 text-[13px] font-medium text-muted-foreground">{title}</p>}
      {children}
    </div>
  )
}

function AskScene({ scene, t, f }: { scene: Scene; t: number; f: Featured }) {
  const text = f.question.question
  // Typing over the first 60% of the scene, then the button.
  const typed = text.slice(0, Math.round(text.length * Math.min(1, progress(scene, t) / 0.6)))
  const done = typed.length === text.length
  return (
    <div className="mx-auto grid max-w-[900px] gap-4 pt-16">
      <h1 className="text-[32px] font-semibold tracking-[-0.02em]">Ask the vault</h1>
      <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
        <p className="min-h-8 flex-1 text-[22px]">
          {typed}
          {!done && <span className="ml-px inline-block h-7 w-0.5 translate-y-1 bg-foreground" />}
        </p>
        <span
          className={cn(
            'rounded-md px-5 py-2.5 text-[16px] font-medium',
            done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          Ask
        </span>
      </div>
      <p className="font-mono text-[14px] text-muted-foreground">
        {f.question.id} · {f.question.kind} · hybrid search
      </p>
    </div>
  )
}

function Sources({ demo, hits, count }: { demo: DemoData; hits: SearchHit[]; count: number }) {
  const rank = new Map(hits.map((h, i) => [h.noteId, i + 1]))
  return (
    <Panel title="Sources · the top 5 go to the answer">
      <ol className="m-0 grid list-none gap-3 p-0">
        {hits.map((h, i) => {
          const note = demo.note(h.noteId)?.note
          return (
            <li
              key={h.noteId}
              className={cn(
                'grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-t pt-3 first:border-t-0 first:pt-0',
                i >= count && 'invisible',
              )}
            >
              <span className="n text-[15px] font-semibold text-muted-foreground">#{i + 1}</span>
              <div className="grid gap-2">
                <p className="flex items-baseline gap-3 text-[17px] font-semibold">
                  <TypeTag type={note?.type ?? 'document'} className="text-[15px]">
                    {note?.title ?? h.noteId}
                  </TypeTag>
                  <span className="n text-[13px] font-normal text-muted-foreground">{note?.path}</span>
                </p>
                <p className="flex flex-wrap gap-2">
                  {h.reasons.map((r, j) => (
                    <ReasonChip
                      key={j}
                      reason={r}
                      rankOf={(id) => rank.get(id)}
                      titleOf={(id) => demo.note(id)?.note.title ?? id}
                    />
                  ))}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

function Answer({ f, sentences, on }: { f: Featured; sentences: number; on?: number }) {
  return (
    <p className="text-[21px] leading-[1.7]">
      {f.sentences.map((s, i) => (
        <span key={i} className={cn(i >= sentences && 'invisible')}>
          {i > 0 && ' '}
          {s.text}
          {sentenceCites(s, f.cites).map((n) => (
            <span key={n} className={cn(CHIP, on === n && CHIP_ON)}>
              {n}
            </span>
          ))}
        </span>
      ))}
    </p>
  )
}

function AnswerScene({ f, sentences, lit }: { f: Featured; sentences: number; lit: number }) {
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_600px] items-start gap-8">
      <Panel title="Answer · every sentence cites its source">
        <p className="mb-3 text-[19px] font-semibold">{f.question.question}</p>
        <Answer f={f} sentences={sentences} />
      </Panel>
      <div className="rounded-xl border bg-canvas p-3">
        <p className="px-2 pb-1 text-[13px] font-medium text-muted-foreground">The path the answer walked</p>
        <PathFigure nodes={f.nodes} edges={f.edges} lit={lit} />
      </div>
    </div>
  )
}

/** The passage behind the first citation, with the quote marked. */
function firstCitation(f: Featured): { n: number; citation: Citation } | undefined {
  for (const s of f.sentences)
    for (const c of s.citations) if (f.cites[c.noteId]) return { n: f.cites[c.noteId]!, citation: c }
}

function CitationScene({ demo, f }: { demo: DemoData; f: Featured }) {
  const first = firstCitation(f)
  const text = first ? (demo.passageText(first.citation.chunkId) ?? '') : ''
  const quote = first?.citation.quote ?? ''
  const at = text.indexOf(quote)
  const note = first && demo.note(first.citation.noteId)?.note
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_520px] items-start gap-8">
      <Panel title="Answer">
        <p className="mb-3 text-[19px] font-semibold">{f.question.question}</p>
        <Answer f={f} sentences={f.sentences.length} on={first?.n} />
      </Panel>
      {first && note && (
        <Panel title={`Source ${first.n} · the passage the answer read`} className="shadow-overlay">
          <p className="mb-2 text-[17px] font-semibold">
            <TypeTag type={note.type}>{note.title}</TypeTag>
          </p>
          <p className="n mb-3 text-[13px] text-muted-foreground">{note.path}</p>
          <p className="border-l-[3px] border-evidence pl-3 text-[17px] leading-[1.6] whitespace-pre-line">
            {at < 0 ? (
              text
            ) : (
              <>
                {text.slice(0, at)}
                <mark>{quote}</mark>
                {text.slice(at + quote.length)}
              </>
            )}
          </p>
        </Panel>
      )}
    </div>
  )
}

function EvaluationScene({ demo }: { demo: DemoData }) {
  const sb = demo.scoreboard
  const h = headline(sb)
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <p className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">{h?.long}</p>
        {h?.sub && <p className="text-[19px] font-medium text-muted-foreground">{h.sub}</p>}
      </div>
      <div className="grid grid-cols-3 gap-5">
        {ANSWERABLE_KINDS.map((k) => (
          <KindCard key={k} sb={sb} kind={k} />
        ))}
      </div>
    </div>
  )
}

function EndScene() {
  return (
    <div className="grid h-full content-center justify-items-center gap-6">
      <p className="flex items-center gap-4 text-[40px] font-semibold">
        <Mark size={48} />
        graph-rag-vault
      </p>
      <CodeBlock lines={QUICKSTART_COMMANDS} className="w-[880px] [&_pre]:text-[16px]" />
      <p className="font-mono text-[18px] text-muted-foreground">{REPO}</p>
    </div>
  )
}
