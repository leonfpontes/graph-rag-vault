// Ask: a question and a cited answer, not a chat. The 50 evaluation questions answer at once from the
// recorded run; a question a person types is embedded here, in the browser (the model loads only for
// the first one), and searched with the same code the evaluation measures. The written answer to a new
// question needs a local run with the person's key. The right column keeps the graph in view, with
// the path the answer walked lit and each link's type written on it, and the same path as text.
import {
  ApiRequestError,
  LOCAL_ANSWER_COMMANDS,
  MAX_QUESTION_CHARS,
  paths,
  type AnswerOutcome,
  type Demo,
  type RecordedQuestion,
  type SearchOutcome,
} from '@graph-rag/client'
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_MODELS } from '@graph-rag/embeddings'
import { SEARCH_VARIANTS, type SearchVariant } from '@graph-rag/search'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Progress,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  cn,
} from '@leonfpontes/atlas-ui'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Info,
  KeyRound,
  List,
  LoaderCircle,
  OctagonX,
  RotateCcw,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import { AnswerText, Removed } from '../ask/Answer'
import { embedQuery, modelReady, type ModelProgress } from '../ask/embedder'
import { SourceList } from '../ask/Sources'
import { GraphCanvas } from '../graph/GraphCanvas'
import type { SceneOptions } from '../graph/scene'
import { answerPath, citationNumbers, pathHub, type AnswerPath } from '../lib/answer-path'
import { useDemo } from '../lib/demo'
import { duration, mb, thousands, usd } from '../lib/format'
import { VARIANT_NAME, VARIANT_SHORT } from '../lib/headline'
import { NARROW, PHONE, useMedia } from '../lib/media'
import { NOTE_TYPES, Shape, TypeTag } from '../lib/notes'
import { Link, useRouter, withParams } from '../lib/router'
import { CodeBlock } from '../shell/CodeBlock'
import { DemoError, DownloadStatus } from '../shell/states'
import { usePageTitle } from '../shell/title'

export const KIND_LABEL: Record<string, string> = {
  fact: 'Fact',
  'multi-hop': 'Multi-hop',
  temporal: 'Temporal',
  unanswerable: 'No answer',
}

const VARIANT_CAPTION: Record<SearchVariant, string> = {
  hybrid: 'hybrid: vectors + words + links, fused (RRF)',
  vector: 'vectors only (cosine)',
  graph: 'graph only: names and words, then 1 to 2 links',
}

const MODEL = EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL]

type Phase =
  | { name: 'idle' }
  | { name: 'model'; progress: ModelProgress }
  | { name: 'searching' }
  | { name: 'writing'; search?: SearchOutcome }
  | { name: 'done'; outcome: AnswerOutcome }
  | { name: 'model-error'; message: string; progress?: ModelProgress }
  | { name: 'error'; message: string }

const isVariant = (v: string | null): v is SearchVariant => SEARCH_VARIANTS.includes(v as SearchVariant)

/** The recorded questions the start state offers: two multi-hop, then one of each other kind. */
export function starterQuestions(questions: readonly RecordedQuestion[]): RecordedQuestion[] {
  const test = questions.filter((q) => q.split === 'test')
  const of = (kind: string, n = 1) => test.filter((q) => q.kind === kind).slice(0, n)
  return [
    ...of('multi-hop'),
    ...of('fact'),
    ...of('temporal'),
    ...of('multi-hop', 2).slice(1),
    ...of('unanswerable'),
  ]
}

export function Ask() {
  usePageTitle('Ask')
  const { state, retry } = useDemo()
  const { location, navigate } = useRouter()
  const q = location.search.get('q')?.trim() || undefined
  const asked = location.search.get('variant')
  const variant: SearchVariant = isVariant(asked) ? asked : 'hybrid'
  const draft = location.search.get('draft') ?? ''
  const demo = state.status === 'ready' ? state.demo : undefined
  const [text, setText] = useState(() => q ?? draft)
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const narrow = useMedia(NARROW)
  const phone = useMedia(PHONE)
  const recorded = q && demo ? demo.findQuestion(q) : undefined

  // The box shows the question asked (a recorded question's text when the address has its id).
  useEffect(() => {
    if (q) setText(recorded?.question ?? q)
    else setText(draft)
  }, [q, recorded, draft])

  useEffect(() => {
    if (!demo || !q) {
      setPhase({ name: 'idle' })
      return
    }
    const controller = new AbortController()
    const { signal } = controller
    const run = async () => {
      const known = demo.findQuestion(q)
      // A recorded question needs no model; in local mode the server embeds the question itself.
      if (known || demo.mode === 'local') {
        if (demo.mode === 'local' && !known) setPhase({ name: 'writing' })
        return demo.answer({ question: q, variant, signal })
      }
      let last: ModelProgress = { loaded: 0, total: MODEL.bytes }
      if (!modelReady()) setPhase({ name: 'model', progress: last })
      const vector = await embedQuery(q, {
        signal,
        onProgress: (p) => {
          last = { loaded: p.loaded, total: p.total ?? MODEL.bytes }
          setPhase({ name: 'model', progress: last })
        },
      }).catch((e: unknown) => {
        if (signal.aborted) throw e
        throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), {
          model: true,
          progress: last,
        })
      })
      setPhase({ name: 'searching' })
      return demo.answer({ question: q, variant, queryVector: vector, signal })
    }
    run().then(
      (outcome) => !signal.aborted && setPhase({ name: 'done', outcome }),
      (e: unknown) => {
        if (signal.aborted) return
        const err = e as Error & { model?: boolean; progress?: ModelProgress }
        if (err.model) setPhase({ name: 'model-error', message: err.message, progress: err.progress })
        else
          setPhase({
            name: 'error',
            message: e instanceof ApiRequestError || e instanceof Error ? e.message : String(e),
          })
      },
    )
    return () => controller.abort()
  }, [demo, q, variant, attempt])

  const submit = (question: string) => {
    const t = question.trim()
    if (!t) return
    navigate(withParams(location, { q: t, draft: null }))
  }
  const cancel = () => navigate(withParams(location, { q: null, draft: q ?? null }))

  const outcome = phase.name === 'done' ? phase.outcome : undefined
  const path = useMemo(() => (demo && outcome ? pathOf(demo, outcome) : undefined), [demo, outcome])
  const unknown =
    (outcome?.kind === 'recorded' || outcome?.kind === 'live') && outcome.answer.status === 'unknown'

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-4 pb-12 md:px-6 md:pt-6">
      <div className={cn('grid items-start gap-6', !narrow && 'grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]')}>
        <div className="min-w-0">
          <div className="mb-4">
            <h1 className="text-2xl font-semibold tracking-[-0.015em]">Ask the vault</h1>
            <p className="mt-1 max-w-[720px] text-sm text-muted-foreground">
              Answers use only the notes. Every sentence cites the note it came from; a sentence without a
              source is removed.
            </p>
          </div>
          <QuestionBox
            text={text}
            onText={setText}
            variant={variant}
            onVariant={(v) => navigate(withParams(location, { variant: v === 'hybrid' ? null : v }))}
            onSubmit={submit}
            busy={phase.name === 'model' || phase.name === 'searching' || phase.name === 'writing'}
          />
          <p className="mt-2.5 flex items-start gap-2 text-[13px] text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              The 50 evaluation questions answer at once from the recorded run. Your own question is searched
              here, in your browser;{' '}
              {demo?.mode === 'local' ? (
                'this local server writes the answer with your key.'
              ) : (
                <>
                  a generated answer needs a <a href="#local">local run with your key</a>.
                </>
              )}
            </span>
          </p>
          {demo && <RecordedQuestions key={q ? 'asked' : 'start'} demo={demo} open={!q} />}
          {state.status === 'loading' && (
            <div className="mt-5 rounded-lg border bg-card p-4">
              <DownloadStatus download={state.download} what="the search index" />
            </div>
          )}
          {state.status === 'error' && (
            <div className="mt-5 rounded-lg border bg-card p-4">
              <DemoError error={state.error} onRetry={retry} />
            </div>
          )}
          {demo && q && (
            <Turn
              demo={demo}
              recorded={recorded}
              phase={phase}
              onCancel={cancel}
              onRetry={() => setAttempt((n) => n + 1)}
            />
          )}
          {demo && q && demo.mode !== 'local' && (outcome?.kind === 'needs-key' || (outcome && !unknown)) && (
            <LocalRun />
          )}
        </div>
        {demo && (
          <PathColumn demo={demo} phase={phase} path={path} unknown={unknown} narrow={narrow} phone={phone} />
        )}
      </div>
    </div>
  )
}

function pathOf(demo: Demo, outcome: AnswerOutcome): AnswerPath {
  const hits = outcome.search.hits.slice(0, 5)
  const citations = outcome.kind === 'needs-key' ? [] : outcome.answer.sentences.flatMap((s) => s.citations)
  return answerPath(demo.index, hits, citations)
}

function QuestionBox({
  text,
  onText,
  variant,
  onVariant,
  onSubmit,
  busy,
}: {
  text: string
  onText: (t: string) => void
  variant: SearchVariant
  onVariant: (v: SearchVariant) => void
  onSubmit: (t: string) => void
  busy: boolean
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  // The box grows with the question.
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])
  const tooLong = text.trim().length > MAX_QUESTION_CHARS
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!tooLong) onSubmit(text)
      }}
      className="grid gap-2.5 rounded-lg border border-input bg-background p-3 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
    >
      <label htmlFor={`${id}-q`} className="sr-only">
        Your question
      </label>
      <textarea
        id={`${id}-q`}
        ref={area}
        rows={2}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (!tooLong) onSubmit(text)
          }
        }}
        aria-invalid={tooLong || undefined}
        aria-describedby={tooLong ? `${id}-long` : undefined}
        placeholder="Ask about Tarnwick Cycles: people, projects, decisions, customers"
        className="min-h-12 w-full resize-none border-0 bg-transparent px-0.5 text-base leading-normal text-foreground outline-none placeholder:text-text-subtle"
      />
      {tooLong && (
        <p id={`${id}-long`} className="text-[13px] text-destructive">
          Keep the question under {MAX_QUESTION_CHARS} characters ({text.trim().length} now).
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span id={`${id}-v`} className="text-[13px] font-medium text-muted-foreground">
          Search
        </span>
        <ToggleGroup
          type="single"
          value={variant}
          onValueChange={(v) => v && onVariant(v as SearchVariant)}
          aria-labelledby={`${id}-v`}
        >
          {(['hybrid', 'vector', 'graph'] as const).map((v) => (
            <ToggleGroupItem key={v} value={v}>
              {VARIANT_SHORT[v]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="flex-1" />
        <Button type="submit" disabled={!text.trim() || tooLong} aria-busy={busy || undefined}>
          <ArrowRight aria-hidden="true" />
          Ask
        </Button>
      </div>
    </form>
  )
}

function RecordedQuestions({ demo, open }: { demo: Demo; open: boolean }) {
  const starters = starterQuestions(demo.questions)
  return (
    <Collapsible defaultOpen={open} className="mt-2.5 rounded-lg border bg-card">
      <CollapsibleTrigger className="group flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-3.5 text-left text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <List aria-hidden="true" className="size-4" />
        Recorded questions{' '}
        <span className="font-normal text-muted-foreground">· {demo.questions.length} answer at once</span>
        <ChevronDown
          aria-hidden="true"
          className="ml-auto size-4 transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="m-0 grid list-none gap-1 px-3 pb-2">
          {starters.map((rq) => (
            <li key={rq.id}>
              <Link
                href={`${paths.ask(rq.id)}`}
                className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm text-foreground no-underline outline-none hover:border-input focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span>{rq.question}</span>
                <Badge variant="secondary">{KIND_LABEL[rq.kind]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href={`${paths.evaluation()}#questions`}
          className="mx-3.5 mb-2.5 inline-flex min-h-6 items-center text-sm pointer-coarse:min-h-11"
        >
          All {demo.questions.filter((x) => x.split === 'test').length} test questions in the evaluation
        </Link>
      </CollapsibleContent>
    </Collapsible>
  )
}

function TurnMeta({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
      {children}
    </div>
  )
}

function Turn({
  demo,
  recorded,
  phase,
  onCancel,
  onRetry,
}: {
  demo: Demo
  recorded?: RecordedQuestion
  phase: Phase
  onCancel: () => void
  onRetry: () => void
}) {
  const kind = recorded ? (
    <Badge variant="secondary">{KIND_LABEL[recorded.kind]}</Badge>
  ) : (
    <Badge variant="secondary">Your question</Badge>
  )
  const chunks = thousands(demo.index.chunks.length)
  return (
    <section aria-label="Answer" className="mt-5 grid gap-3.5 border-t pt-5">
      {phase.name === 'model' && (
        <>
          <TurnMeta>
            {kind}
            <span>search in your browser</span>
          </TurnMeta>
          <div role="status" className="grid gap-2 rounded-lg border bg-card px-4 py-3.5">
            <div className="flex items-center gap-2.5 text-sm">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              <strong className="font-medium">Loading the search model</strong>
              <span className="flex-1" />
              <span className="n text-[13px]">
                {mb(phase.progress.loaded, 0)} of {mb(phase.progress.total ?? MODEL.bytes, 0)} MB
              </span>
            </div>
            <Progress
              aria-label="Search model download"
              value={Math.min(
                100,
                Math.round((phase.progress.loaded / (phase.progress.total ?? MODEL.bytes)) * 100),
              )}
            />
            <p className="text-[13px] text-muted-foreground">
              Only for the first question you type: the browser keeps the model for the next ones. The{' '}
              {demo.questions.length} recorded questions do not need it.
            </p>
            <Button variant="outline" className="justify-self-start" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {(phase.name === 'searching' || phase.name === 'writing') && (
        <>
          <TurnMeta>
            {kind}
            <span>
              {phase.name === 'writing'
                ? 'answered on this machine, with your key'
                : 'search in your browser'}
            </span>
          </TurnMeta>
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-lg border bg-card px-4 py-3.5 text-sm"
          >
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            {phase.name === 'writing'
              ? 'Searching the notes and writing the answer'
              : `Searching ${chunks} chunks: vectors, words and links`}
          </div>
          <SkeletonSources />
        </>
      )}
      {phase.name === 'model-error' && (
        <>
          <TurnMeta>{kind}</TurnMeta>
          <Alert variant="destructive">
            <OctagonX aria-hidden="true" />
            <AlertTitle>The search model did not load</AlertTitle>
            <AlertDescription>
              <p>
                {phase.progress && phase.progress.loaded > 0
                  ? `The download stopped at ${mb(phase.progress.loaded, 0)} of ${mb(phase.progress.total ?? MODEL.bytes, 0)} MB (${phase.message}). `
                  : `${phase.message}. `}
                Try again, or pick a recorded question above: they need no model.
              </p>
            </AlertDescription>
          </Alert>
          <Button className="justify-self-start" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
        </>
      )}
      {phase.name === 'error' && (
        <>
          <TurnMeta>{kind}</TurnMeta>
          <Alert variant="destructive">
            <OctagonX aria-hidden="true" />
            <AlertTitle>The answer did not come</AlertTitle>
            <AlertDescription>
              <p>{phase.message}</p>
            </AlertDescription>
          </Alert>
          <Button className="justify-self-start" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
        </>
      )}
      {phase.name === 'done' && <Outcome demo={demo} outcome={phase.outcome} kind={kind} chunks={chunks} />}
    </section>
  )
}

function SkeletonSources() {
  return (
    <div className="mt-2 grid gap-3">
      <h2 className="text-base font-semibold">Sources</h2>
      <div aria-hidden="true" className="rounded-lg border bg-card">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid gap-2 border-b px-4 py-3.5 last:border-b-0">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-[90%]" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        ))}
      </div>
    </div>
  )
}

function Outcome({
  demo,
  outcome,
  kind,
  chunks,
}: {
  demo: Demo
  outcome: AnswerOutcome
  kind: ReactNode
  chunks: string
}) {
  const { location } = useRouter()
  const s = outcome.search
  const hits = s.hits.slice(0, 5)
  const rq = s.recorded
  const ran =
    s.ran !== s.variant ? ` · no embedding for this question, so ${VARIANT_NAME[s.ran].toLowerCase()}` : ''
  const caption = `${hits.length} of ${chunks} chunks · ${duration(s.ms)} · ${VARIANT_CAPTION[s.ran]}${ran}`
  if (outcome.kind === 'needs-key') {
    return (
      <>
        <TurnMeta>
          {kind}
          <span>
            {rq ? `${rq.id} · no recorded answer for ${VARIANT_NAME[s.variant].toLowerCase()} · ` : ''}
            searched in your browser
          </span>
        </TurnMeta>
        <Alert variant="info">
          <KeyRound aria-hidden="true" />
          <AlertTitle>The search ran; the answer needs your key</AlertTitle>
          <AlertDescription>
            <p>
              This page has no model key, so it shows what the search found.{' '}
              <a href="#local">Run it locally</a> to get the written answer with citations.
            </p>
          </AlertDescription>
        </Alert>
        <SourceList demo={demo} hits={hits} cites={{}} caption={caption} showNotCited={false} />
      </>
    )
  }
  const a = outcome.answer
  const cites = citationNumbers(
    hits,
    a.sentences.flatMap((x) => x.citations.map((c) => c.noteId)),
  )
  const meta =
    outcome.kind === 'recorded' ? (
      <>
        <span>
          {outcome.answer.questionId} · recorded answer
          {s.variant !== 'hybrid' ? ` · ${VARIANT_NAME[s.variant].toLowerCase()}` : ''}
        </span>
        <span className="n">
          {modelName(outcome.answer.answerModel)} · {duration(outcome.answer.latencyMs)} ·{' '}
          {usd(outcome.answer.answerMicros / 1e6, 4)}
        </span>
      </>
    ) : (
      <>
        <span>your question · answered on this machine</span>
        <span className="n">
          {modelName(outcome.answer.model)} · {duration(s.ms)} · {usd(outcome.answer.costMicros / 1e6, 4)}
        </span>
      </>
    )
  const missing =
    rq && s.variant !== 'hybrid' ? rq.expectedSources.filter((id) => !hits.some((h) => h.noteId === id)) : []
  return (
    <>
      <TurnMeta>
        {kind}
        {meta}
      </TurnMeta>
      {a.status === 'unknown' ? (
        <>
          <p className="text-base leading-[1.7]">
            <strong className="font-semibold">I don't know.</strong> No passage in the notes the search found
            answers this. The closest notes are below.
          </p>
          {rq &&
            (rq.kind === 'unanswerable' ? (
              <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                Expected for this question: the vault has no answer, so “I don't know” is the correct reply.
              </p>
            ) : (
              <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>
                  This question has an answer in the vault:{' '}
                  {rq.expectedSources.map((id, i) => (
                    <span key={id}>
                      {i > 0 && ', '}
                      <Link href={paths.note(id)}>{demo.note(id)?.note.title ?? id}</Link>
                    </span>
                  ))}
                  .
                </span>
              </p>
            ))}
        </>
      ) : (
        <>
          <AnswerText demo={demo} sentences={a.sentences} cites={cites} />
          <Removed removed={a.removed} />
        </>
      )}
      {missing.length > 0 && (
        <p className="flex gap-2 rounded-md border border-dashed px-3 py-2.5 text-sm">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            With {VARIANT_NAME[s.variant].toLowerCase()},{' '}
            {missing.length === 1 ? 'one expected note is' : `${missing.length} expected notes are`} not in
            the top 5:{' '}
            {missing.map((id, i) => (
              <span key={id}>
                {i > 0 && (i === missing.length - 1 ? ' and ' : ', ')}
                {demo.note(id)?.note.title ?? id}
              </span>
            ))}
            . <Link href={withParams(location, { variant: null })}>Compare with hybrid</Link>
          </span>
        </p>
      )}
      <SourceList
        demo={demo}
        hits={hits}
        cites={a.status === 'unknown' ? {} : cites}
        caption={a.status === 'unknown' ? `${caption} · none supports an answer` : caption}
        showNotCited={a.status !== 'unknown'}
      />
    </>
  )
}

const modelName = (id: string | null) =>
  !id
    ? 'no model'
    : id.startsWith('claude-haiku-5-5')
      ? 'Haiku 5.5'
      : id.startsWith('claude-haiku-4-5')
        ? 'Haiku 4.5'
        : id

function LocalRun() {
  return (
    <section id="local" aria-labelledby="local-h" className="mt-12 grid scroll-mt-20 gap-3">
      <h2 id="local-h" className="text-base font-semibold">
        Generated answers run on your machine
      </h2>
      <p className="max-w-[760px] text-sm text-muted-foreground">
        The page has no model key. Clone the repository and add your own Anthropic key; the answer model is
        Claude Haiku 5.5.
      </p>
      <CodeBlock lines={LOCAL_ANSWER_COMMANDS} />
    </section>
  )
}

function PathColumn({
  demo,
  phase,
  path,
  unknown,
  narrow,
  phone,
}: {
  demo: Demo
  phase: Phase
  path?: AnswerPath
  unknown: boolean
  narrow: boolean
  phone: boolean
}) {
  const graph = useMemo(() => demo.graph(), [demo])
  const outcome = phase.name === 'done' ? phase.outcome : undefined
  const lit = path && !unknown ? path : undefined
  const nearest = unknown && outcome ? outcome.search.hits[0]?.noteId : undefined
  const options = useMemo<SceneOptions>(
    () => ({
      mode: phone ? '2d' : '3d',
      path: lit,
      focus: nearest,
      clusterLabels: false,
      rotate: phase.name === 'idle',
      zoom: 1.5,
    }),
    [phone, lit, nearest, phase.name],
  )
  const legendText =
    phase.name === 'idle'
      ? 'The path of each answer lights up here.'
      : phase.name !== 'done'
        ? 'The path lights up when the search ends.'
        : unknown
          ? outcome?.search.recorded && outcome.search.recorded.kind !== 'unanswerable'
            ? 'No path: this answer said “I don’t know”.'
            : 'No path: nothing in the vault answers this.'
          : undefined
  const pathLabel = outcome?.kind === 'needs-key' ? 'Notes the search found' : 'Links the answer walked'
  return (
    <div className={cn('grid min-w-0 gap-3', !narrow && 'sticky top-[72px]')}>
      <section aria-label="Graph: the path the answer used" data-graph-area className="relative">
        <GraphCanvas
          graph={graph}
          options={options}
          label="Graph of the vault. The notes the answer cited are lit and numbered like the citations."
          className={narrow ? 'h-[420px]' : 'h-[min(620px,calc(100vh-260px))] min-h-[420px]'}
          zoomControls={phone ? 'reset' : 'full'}
        >
          <div className="pointer-events-none absolute inset-x-3 top-3 grid">
            <div
              data-graph-control
              className="pointer-events-auto flex max-w-full flex-wrap gap-x-3.5 gap-y-1.5 justify-self-start rounded-sm bg-(--canvas)/90 px-2 py-1.5 text-[13px]"
            >
              {legendText ? (
                <span className="text-muted-foreground">{legendText}</span>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <i aria-hidden="true" className="inline-block h-[3px] w-5 rounded-sm bg-evidence" />
                    {pathLabel}
                  </span>
                  {NOTE_TYPES.map((t) => (
                    <TypeTag key={t} type={t} className="font-normal" />
                  ))}
                </>
              )}
            </div>
          </div>
        </GraphCanvas>
      </section>
      {lit && lit.edges.length > 0 && <PathAsText demo={demo} path={lit} />}
    </div>
  )
}

function PathAsText({ demo, path }: { demo: Demo; path: AnswerPath }) {
  const title = (id: string) => demo.note(id)?.note.title ?? id
  const type = (id: string) => demo.note(id)?.note.type ?? 'document'
  const cite = (id: string) =>
    path.cites[id] ? (
      <span className="mx-1 rounded-sm border border-evidence/45 bg-evidence-subtle px-1.5 font-mono text-xs font-semibold text-evidence">
        <span className="sr-only">source </span>
        {path.cites[id]}
      </span>
    ) : null
  const rows = pathTree(path.edges)
  return (
    <section aria-labelledby="path-h" className="grid gap-2 rounded-lg border bg-card px-4 py-3">
      <h2 id="path-h" className="text-sm font-semibold">
        The path, as text
      </h2>
      <ol className="m-0 grid list-none gap-1.5 p-0 text-[13px]">
        {rows.map((r) => (
          <li
            key={r.key}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 leading-snug"
            style={{ paddingLeft: `${Math.min(r.depth, 4) * 18}px` }}
          >
            {r.relation && (
              <span className="font-mono text-xs font-medium text-evidence">
                {r.outward ? `${r.relation} →` : `← ${r.relation}`}
              </span>
            )}
            <Shape type={type(r.note)} />
            <span>
              <Link
                href={paths.note(r.note)}
                className={cn(
                  'text-foreground no-underline hover:underline',
                  r.depth === 0 && 'font-semibold',
                )}
              >
                {title(r.note)}
              </Link>
              {cite(r.note)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

interface PathRow {
  key: string
  note: string
  depth: number
  relation?: string
  /** The link goes from the row above (its parent) to this note. */
  outward?: boolean
}

/** The path as a tree from the note most links touch, so every note is written once. */
export function pathTree(edges: readonly { from: string; to: string; relation: string }[]): PathRow[] {
  const rows: PathRow[] = []
  const placed = new Set<string>()
  const used = new Set<number>()
  const visit = (note: string, depth: number) => {
    edges.forEach((e, i) => {
      if (used.has(i) || (e.from !== note && e.to !== note)) return
      const other = e.from === note ? e.to : e.from
      if (placed.has(other)) return
      used.add(i)
      placed.add(other)
      rows.push({
        key: `${i}`,
        note: other,
        depth: depth + 1,
        relation: e.relation,
        outward: e.from === note,
      })
      visit(other, depth + 1)
    })
  }
  let root = pathHub(edges)
  while (root) {
    placed.add(root)
    rows.push({ key: `root-${root}`, note: root, depth: 0 })
    visit(root, 0)
    const rest = edges.find((e, i) => !used.has(i) && (!placed.has(e.from) || !placed.has(e.to)))
    root = rest && (placed.has(rest.from) ? rest.to : rest.from)
  }
  return rows
}
