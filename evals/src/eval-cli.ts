#!/usr/bin/env node
// pnpm eval [--split test] [--rounds 3] [--budget 5] [--concurrency 4] [--variants vector,graph,hybrid]
//           [--questions q-011,q-012] [--no-baselines] [--no-demo-extras] [--out evals/results]
// pnpm eval --report            rebuild latest.md and the human check from the files, no model call
// pnpm eval --sheet <file.md>   write the human sample (answers.json → human-sample.json) and its sheet
// The test split writes the scoreboard (latest.json, latest.md, answers.json); any other split is a
// rehearsal (rehearsal.*). The key comes from ANTHROPIC_API_KEY or .env.local and is never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { createAnthropicProvider, passageText } from '@graph-rag/answer'
import { createEmbedder, DEFAULT_EMBEDDING_MODEL, EMBEDDING_MODEL_KEYS } from '@graph-rag/embeddings'
import { decodeIndex } from '@graph-rag/search'

import { parseEvalArgs } from './args.js'
import { evaluate } from './evaluate.js'
import type { AnswerRecord } from './generation.js'
import { loadQuestions } from './questions.js'
import { humanAgreement, pickSample, sampleSheet, type HumanLabels, type SampleItem } from './sample.js'
import { toMarkdown, type Results } from './scoreboard.js'

const args = parseEvalArgs(process.argv.slice(2))
const root = process.env.INIT_CWD ?? process.cwd()
const at = (p: string) => path.resolve(root, p)
const out = at(args.out)
const stem = args.rehearsal ? 'rehearsal' : 'latest'
const files = {
  results: path.join(out, `${stem}.json`),
  markdown: path.join(out, `${stem}.md`),
  answers: path.join(out, args.rehearsal ? 'rehearsal-answers.json' : 'answers.json'),
  sample: path.join(out, 'human-sample.json'),
  labels: path.join(out, 'human-labels.json'),
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
  const chunks = new Map(index.chunks.map((c) => [c.id, c]))
  const text = new Map(questions.map((q) => [q.id, q.question]))
  const items = pickSample(
    records.filter((r) => args.splits.includes(r.split)),
    (id) => text.get(id) ?? id,
    (id) => passageText(chunks.get(id)?.embedText ?? ''),
  )
  await write(files.sample, JSON.stringify({ items }, null, 2))
  const sheet = sampleSheet(
    items,
    `# Judge check: ${items.length} sentences\n\nFor each sentence, read only the quoted passages under it and tick one box: supported (the passages say all of it), partial (part of it), unsupported (they don't say it). Do not use what you know about the company.`,
  )
  mkdirSync(path.dirname(path.resolve(args.sheet)), { recursive: true })
  writeFileSync(path.resolve(args.sheet), sheet)
  console.log(`${items.length} sentences → ${files.sample} and ${path.resolve(args.sheet)}`)
} else if (args.report) {
  const results = readJson<Results>(files.results)
  if (existsSync(files.labels) && existsSync(files.sample)) {
    const { items } = readJson<{ items: SampleItem[] }>(files.sample)
    const {
      observed,
      kappa,
      items: n,
      answers,
      labeledBy,
      labeledAt,
    } = humanAgreement(items, readJson<HumanLabels>(files.labels))
    results.human = { items: n, answers, observed, kappa, labeledBy, labeledAt }
  }
  await write(files.results, JSON.stringify(results, null, 2))
  await write(files.markdown, toMarkdown(results))
  console.log(toMarkdown(results))
} else {
  if (!process.env.ANTHROPIC_API_KEY && existsSync(at('.env.local'))) process.loadEnvFile(at('.env.local'))
  const provider = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const cacheDir =
    process.env.GRAPH_RAG_MODEL_CACHE ?? path.join(homedir(), '.cache', 'graph-rag-vault', 'models')
  const { results, records } = await evaluate({
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
