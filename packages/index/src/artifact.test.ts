// The search index the demo loads (apps/web/public/data/index.bin) is generated from the vault and
// the questions by `pnpm index`. This test rebuilds what it can without the model (the source hash,
// the chunks, the recorded questions) and fails when the file fell behind.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveModel } from '@graph-rag/embeddings'
import { decodeIndex } from '@graph-rag/search'
import { readVault } from '@graph-rag/vault/node'
import { describe, expect, it } from 'vitest'

import { chunkVault, readQuestions, sourceHash } from './index.js'

/** The repository root: the nearest folder above this file with pnpm-workspace.yaml. */
let root = path.dirname(fileURLToPath(import.meta.url))
while (!existsSync(path.join(root, 'pnpm-workspace.yaml'))) root = path.dirname(root)
const index = decodeIndex(readFileSync(path.join(root, 'apps/web/public/data/index.bin')))
const vault = readVault(path.join(root, 'examples/tarnwick/vault'))
const questions = readQuestions(readFileSync(path.join(root, 'evals/questions.yaml'), 'utf8'))
const model = resolveModel()

describe('the exported search index', () => {
  it('is up to date with the vault, the questions and the default model (else: pnpm index)', () => {
    expect(vault.problems).toEqual([])
    expect(index.model).toEqual({ id: model.id, revision: model.revision, dims: model.dims })
    expect(index.sourceHash, 'run pnpm index').toBe(sourceHash(vault.notes, questions, model))
  })

  it('holds every note and chunk of the vault, and a unit vector for each chunk and question', () => {
    expect(index.notes.map((n) => n.id).sort()).toEqual(vault.notes.map((n) => n.id).sort())
    const chunks = chunkVault(vault.notes)
    expect(index.chunks.map((c) => [c.id, c.embedText]).sort()).toEqual(
      chunks.map((c) => [c.id, c.embedText]).sort(),
    )
    expect(index.queries.map((q) => [q.id, q.question])).toEqual(questions.map((q) => [q.id, q.question]))
    const norm = (v: Float32Array) => Math.hypot(...v)
    for (let i = 0; i < index.chunks.length; i++)
      expect(norm(index.vectors.subarray(i * model.dims, (i + 1) * model.dims))).toBeCloseTo(1, 4)
    for (const q of index.queries) expect(norm(q.vector)).toBeCloseTo(1, 4)
  })

  it('stays small enough for the demo to load at once', () => {
    expect(readFileSync(path.join(root, 'apps/web/public/data/index.bin')).byteLength).toBeLessThan(
      2 * 1024 * 1024,
    )
  })
})
