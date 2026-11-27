#!/usr/bin/env node
// pnpm index            ingests the vault into .graph-rag/index.sqlite (only what changed) and writes
//                       the search index the demo loads (apps/web/public/data/index.bin)
// pnpm index --check    says whether that file is up to date with the vault and the questions, with
//                       no model and no network (exit 1 when it is behind)
// Options: --vault <dir> --questions <file> --db <file> --out <file> --model <key>
// The model is downloaded once to GRAPH_RAG_MODEL_CACHE (default ~/.cache/graph-rag-vault/models).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { createEmbedder, resolveModel } from '@graph-rag/embeddings'
import { decodeIndex, encodeIndex } from '@graph-rag/search'
import { readVault } from '@graph-rag/vault/node'

import { exportIndex } from './export.js'
import { ingest } from './ingest.js'
import { openIndex } from './open.js'
import { readQuestions } from './questions.js'
import { sourceHash } from './source.js'

function repoRoot(): string {
  let dir = process.cwd()
  while (!existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('Run this inside the graph-rag-vault repository.')
    dir = parent
  }
  return dir
}

const root = repoRoot()
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    vault: { type: 'string', default: 'examples/tarnwick/vault' },
    questions: { type: 'string', default: 'evals/questions.yaml' },
    db: { type: 'string', default: '.graph-rag/index.sqlite' },
    out: { type: 'string', default: 'apps/web/public/data/index.bin' },
    model: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
})
const at = (p: string) => path.resolve(root, p)

const vault = readVault(at(values.vault))
if (vault.problems.length > 0) {
  console.error(`The vault has ${vault.problems.length} problems:\n  ${vault.problems.join('\n  ')}`)
  process.exit(1)
}
const questions = readQuestions(readFileSync(at(values.questions), 'utf8'))
const model = resolveModel(values.model)
const hash = sourceHash(vault.notes, questions, model)
const out = at(values.out)

if (values.check) {
  const current = existsSync(out) ? decodeIndex(readFileSync(out)).sourceHash : undefined
  if (current === hash) console.log(`${values.out} is up to date with the vault and the questions.`)
  else {
    console.error(
      `${values.out} is ${current ? 'behind the vault or the questions' : 'missing'}: run pnpm index.`,
    )
    process.exitCode = 1
  }
} else {
  const started = performance.now()
  const cacheDir =
    process.env.GRAPH_RAG_MODEL_CACHE ?? path.join(homedir(), '.cache', 'graph-rag-vault', 'models')
  const embedder = await createEmbedder({ model: model.key, cacheDir })
  mkdirSync(path.dirname(at(values.db)), { recursive: true })
  const db = openIndex(at(values.db))
  const report = await ingest(db, vault.notes, embedder)
  const queryVectors = await Promise.all(questions.map((q) => embedder.embedQuery(q.question)))
  const index = exportIndex(db, {
    model: { id: model.id, revision: model.revision, dims: model.dims },
    sourceHash: hash,
    queries: questions.map((q, i) => ({ ...q, vector: queryVectors[i]! })),
  })
  db.close()
  mkdirSync(path.dirname(out), { recursive: true })
  const bytes = encodeIndex(index)
  writeFileSync(out, bytes)
  const n = report.notes
  console.log(
    `Notes: ${n.added} added, ${n.updated} updated, ${n.removed} removed, ${n.unchanged} unchanged. ` +
      `Chunks embedded: ${report.embedded} of ${index.chunks.length} (${model.key}).`,
  )
  console.log(
    `Wrote ${values.out}: ${index.notes.length} notes, ${index.links.length} links, ${index.chunks.length} chunks, ` +
      `${index.queries.length} questions, ${(bytes.byteLength / 1024).toFixed(0)} KB, in ${((performance.now() - started) / 1000).toFixed(1)} s.`,
  )
}
