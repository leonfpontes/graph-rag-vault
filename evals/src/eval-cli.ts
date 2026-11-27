#!/usr/bin/env node
// pnpm eval [--split test] [--rounds 3] [--budget 5] [--concurrency 4] [--variants vector,graph,hybrid]
//           [--questions q-011,q-012] [--no-baselines] [--no-demo-extras] [--out evals/results]
// pnpm eval --report            rebuild latest.md and the human check from the files, no model call
// pnpm eval --sheet <file.md>   write the judge-check sample (answers.json → judge-sample.json) and a sheet
// pnpm eval --second-judge      label that sample with Opus 5.5 (second-judge.json), then --report
// pnpm eval --reuse             keep the recorded answers whose search notes did not change
// The test split writes the scoreboard (latest.json, latest.md, answers.json); any other split is a
// rehearsal (rehearsal.*). The key comes from ANTHROPIC_API_KEY or .env.local and is never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import {
  ANSWER_MODELS,
  createAnthropicProvider,
  passageTextById,
  promptVersion,
  readAnswerPrompt,
} from '@graph-rag/answer'
import { createEmbedder, DEFAULT_EMBEDDING_MODEL, EMBEDDING_MODEL_KEYS } from '@graph-rag/embeddings/node'
import { decodeIndex } from '@graph-rag/search'

import { parseEvalArgs } from './args.js'
import { JUDGE_MODELS, judgePromptVersion, readJudgePrompt } from './judge.js'
import { evaluate } from './evaluate.js'
import type { AnswerRecord } from './generation.js'
import { loadQuestions } from './questions.js'
import {
  carryLabels,
  humanAgreement,
  pickSample,
  resample,
  sampleSheet,
  type HumanLabels,
  type SampleItem,
} from './sample.js'
import { runSecondJudge, SECOND_JUDGE_MODEL, secondJudgeCheck, type SecondJudgeFile } from './second-judge.js'
import { bestBaseline } from './baselines.js'
import { toMarkdown, verdictOf, type Results } from './scoreboard.js'

const args = parseEvalArgs(process.argv.slice(2))
const root = process.env.INIT_CWD ?? process.cwd()
const at = (p: string) => path.resolve(root, p)
const out = at(args.out)
const stem = args.rehearsal ? 'rehearsal' : 'latest'
const files = {
  results: path.join(out, `${stem}.json`),
  markdown: path.join(out, `${stem}.md`),
  answers: path.join(out, args.rehearsal ? 'rehearsal-answers.json' : 'answers.json'),
  sample: path.join(out, 'judge-sample.json'),
  labels: path.join(out, 'human-labels.json'),
  secondJudge: path.join(out, 'second-judge.json'),
}

async function write(file: string, text: string) {
  const prettier = await import('prettier')
  const options = (await prettier.resolveConfig(file)) ?? {}
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, await prettier.format(text, { ...options, filepath: file }))
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T

const index = decodeIndex(readFileSync(at(args.index)))
const questions = loadQuestions(readFileSync(at(args.questionsFile), 'utf8'))

if (args.sheet) {
  const records = readJson<AnswerRecord[]>(files.answers)
  const text = new Map(questions.map((q) => [q.id, q.question]))
  const questionText = (id: string) => text.get(id) ?? id
  const chunkText = (id: string) => passageTextById(index, id) ?? ''
  const scored = records.filter((r) => args.splits.includes(r.split))
  // An existing sample keeps its answers: they are read again from the new records, the person's
  // labels move to the new ids where nothing changed, and the sheet lists only what needs a label.
  let items: SampleItem[]
  let toLabel: SampleItem[]
  if (existsSync(files.sample)) {
    const { items: previous } = readJson<{ items: SampleItem[] }>(files.sample)
    items = resample(previous, scored, questionText, chunkText)
    if (existsSync(files.labels)) {
      const labels = carryLabels(previous, items, readJson<HumanLabels>(files.labels), args.pendingReason)
      await write(files.labels, JSON.stringify(labels, null, 2))
      toLabel = items.filter((it) => !labels.labels[it.item])
    } else toLabel = items
  } else toLabel = items = pickSample(scored, questionText, chunkText)
  await write(files.sample, JSON.stringify({ items }, null, 2))
  const sheet = sampleSheet(
    toLabel,
    `# Judge check: ${toLabel.length} sentences\n\nFor each sentence, read only the quoted passages under it and tick one box: supported (the passages say all of it), partial (part of it), unsupported (they don't say it). Do not use what you know about the company.`,
  )
  mkdirSync(path.dirname(path.resolve(args.sheet)), { recursive: true })
  writeFileSync(path.resolve(args.sheet), sheet)
  console.log(
    `${items.length} sentences in the sample, ${toLabel.length} on the sheet → ${path.resolve(args.sheet)}`,
  )
} else if (args.report || args.secondJudge) {
  const results = readJson<Results>(files.results)
  if (args.secondJudge) {
    if (!process.env.ANTHROPIC_API_KEY && existsSync(at('.env.local'))) process.loadEnvFile(at('.env.local'))
    const { items } = readJson<{ items: SampleItem[] }>(files.sample)
    const file = await runSecondJudge({
      items,
      records: readJson<AnswerRecord[]>(files.answers),
      index,
      provider: createAnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY ?? '',
        allowedModels: [SECOND_JUDGE_MODEL],
      }),
      // --budget (default the evaluation's $5 cap), less what the scoreboard run spent
      capMicros: Math.round((args.budgetUsd - results.cost.spentUsd) * 1e6),
    })
    await write(files.secondJudge, JSON.stringify(file, null, 2))
    console.error(`second judge: $${(file.costMicros / 1e6).toFixed(4)}`)
  }
  // The verdict follows the current rule, from the stored retrieval and baselines (no new run).
  results.verdict = verdictOf(results.retrieval, bestBaseline(results.baselines))
  if (existsSync(files.labels) && existsSync(files.sample)) {
    const { items } = readJson<{ items: SampleItem[] }>(files.sample)
    const { items: n, ...rest } = humanAgreement(items, readJson<HumanLabels>(files.labels))
    results.human = { items: n, ...rest }
  }
  if (existsSync(files.secondJudge) && existsSync(files.sample)) {
    const { items } = readJson<{ items: SampleItem[] }>(files.sample)
    results.secondJudge = secondJudgeCheck(items, readJson<SecondJudgeFile>(files.secondJudge))
  }
  await write(files.results, JSON.stringify(results, null, 2))
  await write(files.markdown, toMarkdown(results))
  console.log(toMarkdown(results))
} else {
  if (!process.env.ANTHROPIC_API_KEY && existsSync(at('.env.local'))) process.loadEnvFile(at('.env.local'))
  const provider = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const cacheDir =
    process.env.GRAPH_RAG_MODEL_CACHE ?? path.join(homedir(), '.cache', 'graph-rag-vault', 'models')
  let previous: AnswerRecord[] | undefined
  if (args.reuse) {
    const before = readJson<Results>(files.results)
    const now = { answer: promptVersion(readAnswerPrompt()), judge: judgePromptVersion(readJudgePrompt()) }
    if (
      JSON.stringify(before.promptVersions) !== JSON.stringify(now) ||
      before.models.answer !== ANSWER_MODELS.primary ||
      before.models.judge !== JUDGE_MODELS.primary
    )
      throw new Error('--reuse needs the same prompts and models as the recorded answers; run without it.')
    previous = readJson<AnswerRecord[]>(files.answers)
  }
  const { results, records } = await evaluate({
    previous,
    args,
    index,
    questions,
    provider,
    embeddingModelKey: DEFAULT_EMBEDDING_MODEL,
    baselineEmbedders: args.baselines
      ? async function* () {
          for (const model of EMBEDDING_MODEL_KEYS.filter((k) => k !== DEFAULT_EMBEDDING_MODEL))
            yield await createEmbedder({ model, cacheDir })
        }
      : undefined,
    log: (line) => console.error(line),
  })
  await write(files.answers, JSON.stringify(records, null, 2))
  await write(files.results, JSON.stringify(results, null, 2))
  await write(files.markdown, toMarkdown(results))
  console.log(toMarkdown(results))
  console.log(`spent $${results.cost.spentUsd.toFixed(4)} of $${results.cost.capUsd}`)
  if (results.cost.stoppedEarly) process.exitCode = 2
}
