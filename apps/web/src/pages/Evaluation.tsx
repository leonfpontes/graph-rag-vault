// Evaluation: the scoreboard sentence (written from the verdict), recall@5 by question kind, the
// scoreboard table, the faithfulness judge and how it was checked, every test question with the rank
// of its first expected note in each variant, the run's own notes, and how to run it. Every number
// comes from latest.json (demo.scoreboard) or from the same search the evaluation ran.
import type { Demo, Scoreboard, Spread } from '@graph-rag/client'
import { paths } from '@graph-rag/client'
import type { SearchVariant } from '@graph-rag/search'
import {
  Badge,
  Button,
  Card,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@leonfpontes/atlas-ui'
import { ChartColumn, Check, ChevronDown, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { useDemo } from '../lib/demo'
import { duration, pct, pctSd, pp, signed, usd } from '../lib/format'
import { ANSWERABLE_KINDS, headline, kindLine, VARIANT_NAME } from '../lib/headline'
import { Link } from '../lib/router'
import { CodeBlock } from '../shell/CodeBlock'
import { DemoError, DownloadStatus } from '../shell/states'
import { usePageTitle } from '../shell/title'
import { KIND_LABEL } from './Ask'

const VARIANTS: SearchVariant[] = ['vector', 'graph', 'hybrid']

const KIND_TEXT: Record<string, string> = {
  fact: 'one note has the answer',
  'multi-hop': 'needs 2 or more linked notes',
  temporal: 'the newest note wins',
}

export const modelLabel = (id: string) =>
  id.startsWith('claude-haiku-5-5')
    ? 'Claude Haiku 5.5'
    : id.startsWith('claude-opus-5-5')
      ? 'Claude Opus 5.5'
      : id.startsWith('claude-haiku-4-5')
        ? 'Claude Haiku 4.5'
        : id

export function VariantKey({ variant, className }: { variant: SearchVariant; className?: string }) {
  return (
    <i
      aria-hidden="true"
      className={cn(
        'inline-block h-2.5 w-3.5 shrink-0 rounded-xs',
        variant === 'vector' && 'bg-key-vector',
        variant === 'graph' && 'key-graph',
        variant === 'hybrid' && 'bg-foreground',
        className,
      )}
    />
  )
}

export function Evaluation() {
  usePageTitle('Evaluation')
  const { state, retry } = useDemo()
  const demo = state.status === 'ready' ? state.demo : undefined
  const sb = demo?.scoreboard
  const scored = sb && !sb.rehearsal && sb.splits.includes('test')
  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-4 pb-12 md:px-6 md:pt-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">Evaluation</h1>
        {demo && sb && scored && (
          <p className="mt-1 max-w-[720px] text-sm text-muted-foreground">
            <span className="n">{sb.questions.total}</span> held-out questions,{' '}
            <span className="n">{VARIANTS.length}</span> search variants, answers by{' '}
            {modelLabel(sb.models.answer)}. The search weights were tuned on{' '}
            <span className="n">{demo.questions.filter((q) => q.split !== 'test').length}</span> other
            questions, never on these.
          </p>
        )}
      </div>
      {state.status === 'loading' && <DownloadStatus download={state.download} what="the scoreboard" />}
      {state.status === 'error' && <DemoError error={state.error} onRetry={retry} />}
      {demo && sb && !scored && <NoResults />}
      {demo && sb && scored && <Results demo={demo} sb={sb} />}
    </div>
  )
}

function NoResults() {
  return (
    <div className="grid justify-items-start gap-3 rounded-xl border border-dashed px-6 py-10">
      <ChartColumn aria-hidden="true" className="size-4 text-muted-foreground" />
      <h2 className="text-lg font-semibold">No results yet</h2>
      <p className="max-w-[520px] text-sm text-muted-foreground">
        The scoreboard appears after the first run on the test questions. Retrieval metrics cost nothing;
        answer metrics call Claude Haiku 5.5 and stop at the $5 budget.
      </p>
      <CodeBlock className="w-full max-w-[520px]" lines={['pnpm eval --rounds 3 --budget 5']} />
    </div>
  )
}

function Section({
  id,
  title,
  children,
  className,
}: {
  id?: string
  title: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-h` : undefined}
      className={cn('mt-8 grid min-w-0 scroll-mt-20 gap-3', className)}
    >
      <h2
        id={id ? `${id}-h` : undefined}
        className="flex flex-wrap items-baseline gap-2 text-base font-semibold"
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

const Rule = ({ children }: { children: ReactNode }) => (
  <p className="max-w-[760px] text-[13px] text-muted-foreground">{children}</p>
)

function Results({ demo, sb }: { demo: Demo; sb: Scoreboard }) {
  const h = headline(sb)
  const kl = kindLine(sb)
  const unanswerable = sb.questions.byKind.unanswerable ?? 0
  return (
    <>
      <section className="grid gap-1">
        {h && (
          <p className="max-w-[860px] text-[19px] leading-[1.35] font-semibold tracking-[-0.01em] md:text-[22px]">
            {h.long}
          </p>
        )}
        {h?.sub && <p className="max-w-[760px] text-base font-medium">{h.sub}</p>}
        <Rule>
          Rule for this sentence: hybrid search is compared with the best other variant; under 5 points of
          recall@5 it is a tie. The same function writes the landing title and the share images.
        </Rule>
      </section>

      <Section id="kinds" title={kl.title}>
        <p className="max-w-[760px] text-base font-medium">{kl.text}</p>
        <p className="max-w-[760px] text-sm text-muted-foreground">
          pp = percentage points, hybrid minus vectors only. The {unanswerable} no-answer questions have no
          expected note; they count in “Correct I don't know” below.
        </p>
        <div className="grid gap-4 min-[900px]:grid-cols-3">
          {ANSWERABLE_KINDS.map((k) => (
            <KindCard key={k} sb={sb} kind={k} />
          ))}
        </div>
      </Section>

      <Section id="scoreboard" title="Scoreboard">
        <ScoreTable sb={sb} />
        <Rule>
          ✓ marks the best value in each row. ± is one standard deviation over {sb.rounds} runs; retrieval is
          deterministic, so it runs once.
        </Rule>
      </Section>

      <Section id="judge" title="Faithfulness judge">
        <JudgeCard sb={sb} demoAnswers={demo.questions.filter((q) => q.split !== 'test').length} />
      </Section>

      <Section id="questions" title="Questions">
        <QuestionMatrix demo={demo} />
      </Section>

      {sb.notes.length > 0 && (
        <Section id="notes" title="Notes on this run">
          <ul className="m-0 grid max-w-[860px] list-disc gap-2 pl-5 text-sm">
            {sb.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="run" title="Run it yourself">
        <p className="max-w-[760px] text-sm text-muted-foreground">
          Retrieval metrics are free and run offline. Answer metrics call {modelLabel(sb.models.answer)}: this
          run spent <span className="n">{usd(sb.cost.spentUsd)}</span> of the{' '}
          <span className="n">{usd(sb.cost.capUsd)}</span> budget, and the script stops at the budget.
        </p>
        <CodeBlock
          lines={[
            'pnpm retrieval --split test',
            `pnpm eval --rounds ${sb.rounds} --budget ${sb.cost.capUsd}`,
          ]}
          notes={[
            'writes evals/results/latest.json: this page, the README table and the share images read it',
          ]}
        />
      </Section>
    </>
  )
}

function Bar({ variant, value }: { variant: SearchVariant; value: number | undefined }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)_44px] items-center gap-3 text-sm max-[600px]:grid-cols-[84px_minmax(0,1fr)_44px] max-[600px]:gap-2">
      <span className="flex items-center gap-1.5">
        <VariantKey variant={variant} />
        {VARIANT_NAME[variant].replace(' only', '')}
      </span>
      <span className="relative h-3.5 rounded-[3px] bg-track">
        <span
          className={cn(
            'absolute inset-y-0 left-0 rounded-[3px]',
            variant === 'vector' && 'bg-key-vector',
            variant === 'graph' && 'key-graph',
            variant === 'hybrid' && 'bg-foreground',
          )}
          style={{ width: `${(value ?? 0) * 100}%` }}
        />
      </span>
      <span className="n text-right text-[13px]">{pct(value)}</span>
    </div>
  )
}

function KindCard({ sb, kind }: { sb: Scoreboard; kind: string }) {
  const r = (v: SearchVariant) => sb.retrieval[v][kind]?.recall5
  return (
    <div className="grid content-start gap-3 rounded-lg border bg-card p-4">
      <h3 className="flex flex-wrap items-baseline justify-between gap-2 text-[15px] font-semibold">
        <span>
          {KIND_LABEL[kind]}{' '}
          <small className="text-[13px] font-normal text-muted-foreground">
            {sb.questions.byKind[kind]} questions · {KIND_TEXT[kind]}
          </small>
        </span>
        <span className="n rounded-sm border px-1.5 py-0.5 text-[13px] font-semibold whitespace-nowrap">
          <span className="sr-only">Hybrid minus vectors only: </span>
          {pp(r('hybrid'), r('vector'))}
        </span>
      </h3>
      <div
        className="grid gap-2.5"
        role="img"
        aria-label={`Recall@5 on ${kind} questions: ${VARIANTS.map((v) => `${VARIANT_NAME[v]} ${pct(r(v))}`).join(', ')}.`}
      >
        {VARIANTS.map((v) => (
          <Bar key={v} variant={v} value={r(v)} />
        ))}
      </div>
    </div>
  )
}

interface Row {
  title: string
  note: string
  value: (v: SearchVariant) => number | undefined
  show: (v: SearchVariant) => string
  /** The value as it reads for a tie (the mean without its ±); default: what is shown. */
  tie?: (v: SearchVariant) => string
  diff: string
  lowerIsBetter?: boolean
}

function ScoreTable({ sb }: { sb: Scoreboard }) {
  const g = (v: SearchVariant) => sb.generation[v]
  const spread = (
    key: 'faithfulness' | 'citationPrecision' | 'correctUnknown' | 'answered' | 'sourceRecall',
  ) => ({
    value: (v: SearchVariant) => (g(v)[key] as Spread).mean,
    show: (v: SearchVariant) => pctSd((g(v)[key] as Spread).mean, (g(v)[key] as Spread).sd),
    tie: (v: SearchVariant) => pct((g(v)[key] as Spread).mean),
    diff: pp(g('hybrid')[key].mean, g('vector')[key].mean),
  })
  const rounds = `${sb.rounds} runs`
  const mrr = (v: SearchVariant) => sb.retrieval[v].all?.mrr
  const cost = (v: SearchVariant) => g(v).costPerAnswerUsd
  const ms = (v: SearchVariant) => g(v).medianLatencyMs
  const dCost =
    cost('hybrid') !== undefined && cost('vector') !== undefined
      ? cost('hybrid')! - cost('vector')!
      : undefined
  const dMs =
    ms('hybrid') !== undefined && ms('vector') !== undefined ? ms('hybrid')! - ms('vector')! : undefined
  const rows: Row[] = [
    {
      title: 'Recall@5',
      note: 'share of the expected notes in the top 5 · 1 run',
      value: (v) => sb.retrieval[v].all?.recall5,
      show: (v) => pct(sb.retrieval[v].all?.recall5),
      diff: pp(sb.retrieval.hybrid.all?.recall5, sb.retrieval.vector.all?.recall5),
    },
    {
      title: 'MRR',
      note: 'reciprocal rank of the first expected note · 1 run',
      value: mrr,
      show: (v) => mrr(v)?.toFixed(2) ?? '—',
      diff:
        mrr('hybrid') !== undefined && mrr('vector') !== undefined
          ? signed(mrr('hybrid')! - mrr('vector')!, 2)
          : '—',
    },
    { title: 'Answered', note: `answerable questions with an answer · ${rounds}`, ...spread('answered') },
    {
      title: 'Expected notes cited',
      note: `share of the expected notes the answer cites · ${rounds}`,
      ...spread('sourceRecall'),
    },
    {
      title: 'Faithfulness',
      note: `claims supported by the cited passage · ${rounds}`,
      ...spread('faithfulness'),
    },
    {
      title: 'Citation precision',
      note: `citations kept by the quote check · ${rounds}`,
      ...spread('citationPrecision'),
    },
    {
      title: "Correct “I don't know”",
      note: `${sb.questions.byKind.unanswerable ?? 0} questions with no answer in the vault · ${rounds}`,
      ...spread('correctUnknown'),
    },
    {
      title: 'Cost per answer',
      note: `${modelLabel(sb.models.answer)}, mean`,
      value: cost,
      show: (v) => usd(cost(v), 4),
      diff: dCost === undefined ? '—' : `${dCost >= 0 ? '+' : '−'}${usd(Math.abs(dCost), 4)}`,
      lowerIsBetter: true,
    },
    {
      title: 'Answer latency',
      note: 'median, one answer',
      value: ms,
      show: (v) => (ms(v) === undefined ? '—' : duration(ms(v)!)),
      diff: dMs === undefined ? '—' : `${dMs >= 0 ? '+' : '−'}${duration(Math.abs(dMs))}`,
      lowerIsBetter: true,
    },
  ]
  return (
    <div
      role="region"
      aria-label="Scoreboard table"
      tabIndex={0}
      className="overflow-x-auto rounded-lg border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Table className="w-max min-w-full">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Metric</TableHead>
            {VARIANTS.map((v) => (
              <TableHead key={v} scope="col" className="text-right">
                <span className="inline-flex items-center gap-1.5">
                  <VariantKey variant={v} />
                  {VARIANT_NAME[v]}
                </span>
              </TableHead>
            ))}
            <TableHead scope="col" className="text-right">
              Hybrid − vectors
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const vals = VARIANTS.map((v) => r.value(v))
            const known = vals.filter((x): x is number => x !== undefined)
            const bestValue = known.length
              ? r.lowerIsBetter
                ? Math.min(...known)
                : Math.max(...known)
              : undefined
            // Every variant whose value, as shown, ties with the best gets the ✓.
            const bestShown = VARIANTS.find((_, i) => vals[i] === bestValue)
            const isBest = VARIANTS.map(
              (v, i) =>
                vals[i] !== undefined &&
                bestShown !== undefined &&
                (r.tie ?? r.show)(v) === (r.tie ?? r.show)(bestShown),
            )
            return (
              <TableRow key={r.title}>
                <TableCell>
                  <div className="grid py-2">
                    <span>{r.title}</span>
                    <span className="text-xs text-muted-foreground">{r.note}</span>
                  </div>
                </TableCell>
                {VARIANTS.map((v, i) => (
                  <TableCell key={v} className={cn('n text-right text-[13px]', isBest[i] && 'font-semibold')}>
                    {r.show(v)}
                    {isBest[i] && (
                      <span className="font-sans">
                        {' '}
                        ✓<span className="sr-only"> best</span>
                      </span>
                    )}
                  </TableCell>
                ))}
                <TableCell className="n text-right text-[13px]">{r.diff}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

const ORDINAL = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
]

/**
 * The judge check in words, from latest.json (the same sentences as the README). `demoAnswers`: the
 * recorded answers beyond the scoreboard's (one per tuning question, for the demo).
 */
export function judgeLines(sb: Scoreboard, demoAnswers = 0): string[] {
  const hu = sb.human
  const sj = sb.secondJudge
  const lines: string[] = []
  if (hu) {
    const blind = hu.blindPart
    const agreedAll = Math.round(hu.observed * hu.items)
    const reviewed = hu.items - (blind?.items ?? 0)
    const reviewedAgreed = agreedAll - (blind?.agreed ?? 0)
    const sample = `on a stratified sample of ${hu.sampleAnswers ?? hu.answers} answers (half from those with a sentence the judge did not fully support)`
    if (hu.blind === false) {
      let text = `Checked by a person (${hu.labeledBy}) ${sample}. Reviewed not blind: agreed with the judge on ${reviewedAgreed} of ${reviewed} sentences.`
      if (blind) {
        text += ` Labelled blind, without the judge's verdicts: agreed on ${blind.agreed} of ${blind.items} sentences (the answers that changed in the index rebuild)`
        const d = blind.disagreements[0]
        if (blind.disagreements.length === 1 && d) {
          const same = sj?.disagreements.some((x) => x.judge === d.judge && x.second === d.human)
          text += `; on the ${ORDINAL[blind.items - 1] ?? 'other'} the judge said ${d.judge} and the person ${d.human}${same ? ', the same direction as the second judge' : ''}`
        }
        text += `. No kappa: the review saw the verdicts, and ${blind.items} blind sentences are too few for one.`
      } else text += " No kappa: the person saw the judge's verdicts."
      if (hu.pendingAnswers)
        text += ` Review pending for ${hu.pendingAnswers} of ${hu.sampleAnswers ?? hu.answers} answers.`
      lines.push(text)
    } else
      lines.push(
        `Checked by a person (${hu.labeledBy}) without the judge's verdicts, ${sample}: agreement ${pct(hu.observed)} on ${hu.items} sentences${hu.kappa === undefined ? '' : `, Cohen's kappa ${hu.kappa.toFixed(2)}`}.`,
      )
  }
  if (sj) {
    let text = `Agreement between two automatic judges: ${modelLabel(sj.model)}, blind, on the same ${sj.items} sentences: ${pct(sj.observed)}, Cohen's kappa ${sj.kappa?.toFixed(2) ?? '—'}.`
    const d0 = sj.disagreements[0]
    const oneWay = !!d0 && sj.disagreements.every((d) => d.judge === d0.judge && d.second === d0.second)
    if (oneWay)
      text += ` All ${sj.disagreements.length} disagreements go the same way: the main judge said ${d0.judge}, the second judge said ${d0.second}, so the faithfulness above is a ${d0.second === 'supported' ? 'conservative' : 'generous'} estimate.`
    if (sj.secondLabels?.length === 1)
      text += ` Kappa says little here: the second judge marked all ${sj.items} sentences ${sj.secondLabels[0]}, and with one judge on a single label, kappa is 0 whatever the other does.`
    else
      text += ` A low kappa is expected here: the main judge marked only ${sj.judgeFlagged} of ${sj.items} sentences as not fully supported, and with so few cases, ${sj.disagreements.length} disagreements${oneWay ? ' that all go one way' : ''} pull kappa down even at ${pct(sj.observed)} agreement.`
    text += ` The main judge stays ${modelLabel(sb.models.judge)}.`
    lines.push(text)
  }
  const c = sb.cost
  const all = Object.values(sb.generation).reduce((n, g) => n + g.answers, 0) + demoAnswers
  lines.push(
    c.reused
      ? `Cost: ${usd(c.answerUsd + c.judgeUsd)} for all recorded answers and their judgments (${all}); the index rebuild asked again the ${all - c.reused} whose search notes changed, for ${usd(c.spentUsd)}${sj ? `; the second judge cost ${usd(sj.costUsd)}` : ''}.`
      : `Cost: ${usd(c.spentUsd)} for the whole run${sj ? `, plus ${usd(sj.costUsd)} for the second judge` : ''}.`,
  )
  return lines
}

function JudgeCard({ sb, demoAnswers }: { sb: Scoreboard; demoAnswers: number }) {
  const hu = sb.human
  const sj = sb.secondJudge
  const reviewed = hu ? hu.items - (hu.blindPart?.items ?? 0) : 0
  const reviewedAgreed = hu ? Math.round(hu.observed * hu.items) - (hu.blindPart?.agreed ?? 0) : 0
  const lines = judgeLines(sb, demoAnswers)
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid md:grid-cols-3">
        <Cell k="Judge">
          <span className="font-medium">{modelLabel(sb.models.judge)}</span>
          <span className="text-[13px] text-muted-foreground">
            sentence by sentence: supported, partial or not supported
          </span>
        </Cell>
        <Cell k="Checked by a person">
          {hu ? (
            <>
              <span className="n text-[22px] font-medium">
                {hu.blind === false
                  ? `${reviewedAgreed} of ${reviewed}${hu.blindPart ? ` · ${hu.blindPart.agreed} of ${hu.blindPart.items} blind` : ''}`
                  : pct(hu.observed)}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {hu.blind === false
                  ? `sentences agreed: reviewed not blind${hu.blindPart ? ', then labelled blind' : ''}`
                  : 'agreement, blind'}{' '}
                · {hu.labeledBy} · stratified sample of {hu.sampleAnswers ?? hu.answers} answers
              </span>
            </>
          ) : (
            <span className="text-[13px] text-muted-foreground">Not checked by a person</span>
          )}
        </Cell>
        <Cell k="Second automatic judge, blind">
          {sj ? (
            <>
              <span className="n text-[22px] font-medium">{pct(sj.observed)}</span>
              <span className="n text-[13px] text-muted-foreground">
                {modelLabel(sj.model)} · Cohen's κ {sj.kappa?.toFixed(2) ?? '—'} · {sj.items} sentences
              </span>
            </>
          ) : (
            <span className="text-[13px] text-muted-foreground">None yet</span>
          )}
        </Cell>
      </div>
      <ul className="m-0 grid list-none gap-2 border-t px-4 py-3.5 text-sm">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {sj && sj.disagreements.length > 0 && (
        <Collapsible className="border-t">
          <CollapsibleTrigger className="group flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 text-left text-sm font-medium text-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset">
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform group-data-[state=closed]:-rotate-90"
            />
            See the {sj.disagreements.length} sentences where the two judges disagree
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="m-0 grid list-none gap-3 px-4 pb-4">
              {sj.disagreements.map((d) => (
                <li key={d.item} className="grid gap-1 border-l-2 pl-3 text-sm">
                  <span className="n text-[13px] text-muted-foreground">
                    <Link
                      href={`${paths.ask(d.questionId)}${d.variant === 'hybrid' ? '' : `&variant=${d.variant}`}`}
                    >
                      {d.questionId}
                    </Link>{' '}
                    · {VARIANT_NAME[d.variant as SearchVariant]?.toLowerCase() ?? d.variant}
                  </span>
                  <span>“{d.sentence}”</span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                    <span>
                      Main judge: <strong className="font-semibold">{d.judge}</strong>
                    </span>
                    <span>
                      Second judge: <strong className="font-semibold">{d.second}</strong>
                    </span>
                  </span>
                  <span className="text-muted-foreground">{d.reason}</span>
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  )
}

function Cell({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1 border-b px-4 py-3.5 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0">
      <span className="text-[13px] text-muted-foreground">{k}</span>
      {children}
    </div>
  )
}

interface QuestionResult {
  id: string
  kind: string
  question: string
  expected: string[]
  /** Per variant: rank of the first expected note in the top 5 and how many expected notes it found. */
  result: Record<SearchVariant, { first?: number; found: number }>
}

export function questionResults(demo: Demo): QuestionResult[] {
  return demo.questions
    .filter((q) => q.split === 'test')
    .map((q) => {
      const result = {} as QuestionResult['result']
      for (const v of VARIANTS) {
        const ids = demo.search({ question: q.id, variant: v }).hits.map((h) => h.noteId)
        const ranks = q.expectedSources.map((e) => ids.indexOf(e)).filter((i) => i >= 0)
        result[v] = { first: ranks.length ? Math.min(...ranks) + 1 : undefined, found: ranks.length }
      }
      return { id: q.id, kind: q.kind, question: q.question, expected: q.expectedSources, result }
    })
}

const FILTERS = {
  all: { label: 'All', keep: () => true },
  hybrid: {
    label: 'Hybrid wins',
    keep: (r: QuestionResult) => r.result.hybrid.found > r.result.vector.found,
  },
  vector: {
    label: 'Vectors win',
    keep: (r: QuestionResult) => r.result.vector.found > r.result.hybrid.found,
  },
  miss: {
    label: 'All miss',
    keep: (r: QuestionResult) => r.expected.length > 0 && VARIANTS.every((v) => r.result[v].found === 0),
  },
} as const

function QuestionMatrix({ demo }: { demo: Demo }) {
  const rows = useMemo(() => questionResults(demo), [demo])
  const [filter, setFilter] = useState<keyof typeof FILTERS>('all')
  const [all, setAll] = useState(false)
  const SHOWN = 10
  return (
    <Tabs value={filter} onValueChange={(v) => setFilter(v as keyof typeof FILTERS)} className="gap-3">
      <TabsList aria-label="Filter questions" className="max-w-full flex-wrap">
        {Object.entries(FILTERS).map(([k, f]) => (
          <TabsTrigger key={k} value={k}>
            {f.label} <span className="n text-xs text-muted-foreground">{rows.filter(f.keep).length}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {Object.entries(FILTERS).map(([k, f]) => {
        const list = rows.filter(f.keep)
        const shown = all ? list : list.slice(0, SHOWN)
        return (
          <TabsContent key={k} value={k} className="grid gap-3">
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">No question in this group.</p>
            ) : (
              <div
                role="region"
                aria-label={`Questions: ${f.label}`}
                tabIndex={0}
                className="overflow-x-auto rounded-lg border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Table className="w-max min-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Id</TableHead>
                      <TableHead scope="col">Kind</TableHead>
                      <TableHead scope="col">Question</TableHead>
                      {VARIANTS.map((v) => (
                        <TableHead key={v} scope="col">
                          {VARIANT_NAME[v]}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((r) => {
                      const missed = VARIANTS.some((v) => r.result[v].found < r.expected.length)
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="n text-[13px] whitespace-nowrap text-muted-foreground">
                            {r.id}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{KIND_LABEL[r.kind]}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[420px] min-w-[280px] py-2 whitespace-normal">
                            <Link href={paths.ask(r.id)}>{r.question}</Link>
                            {missed && r.expected.length > 0 && (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                Expected {r.expected.length === 1 ? 'note' : 'notes'}:{' '}
                                {r.expected.map((e) => demo.note(e)?.note.title ?? e).join(', ')}
                              </span>
                            )}
                          </TableCell>
                          {VARIANTS.map((v) => (
                            <TableCell key={v}>
                              <Hit expected={r.expected.length} {...r.result[v]} />
                            </TableCell>
                          ))}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            {list.length > SHOWN && (
              <Button variant="outline" className="justify-self-start" onClick={() => setAll((a) => !a)}>
                {all ? `Show the first ${SHOWN}` : `Show all ${list.length} questions`}
              </Button>
            )}
          </TabsContent>
        )
      })}
      <Rule>
        #n is the rank of the first expected note in the top 5, and n/m how many of the m expected notes are
        there; miss = none in the top 5. No-answer questions expect no note.
      </Rule>
    </Tabs>
  )
}

function Hit({ first, found, expected }: { first?: number; found: number; expected: number }) {
  if (expected === 0) return <span className="n text-[13px] text-muted-foreground">—</span>
  if (!first)
    return (
      <span className="n inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground">
        <X aria-hidden="true" className="size-3.5" />
        miss
      </span>
    )
  return (
    <span className="n inline-flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
      <Check aria-hidden="true" className="size-3.5" />#{first}
      {expected > 1 && (
        <span className="font-normal text-muted-foreground">
          {' '}
          · {found}/{expected}
        </span>
      )}
    </span>
  )
}
