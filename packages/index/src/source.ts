// What an exported index was built from, as one hash: the chunker, the model, every note and every
// recorded question. A test recomputes it from the repository with no model, so an index that
// fell behind the vault or the questions fails `pnpm check`.
import type { Note } from '@graph-rag/vault'

import { CHUNK_TOKENS } from './chunk.js'
import { CHUNKER_VERSION, noteHash, sha256 } from './ingest.js'

export interface SourceQuestion {
  id: string
  question: string
}

export function sourceHash(
  notes: readonly Note[],
  questions: readonly SourceQuestion[],
  model: { id: string; revision: string },
): string {
  const parts = [
    `chunker ${CHUNKER_VERSION} ${CHUNK_TOKENS}`,
    `model ${model.id}@${model.revision}`,
    ...[...notes].sort((a, b) => (a.id < b.id ? -1 : 1)).map((n) => `note ${noteHash(n)}`),
    ...questions.map((q) => `question ${q.id} ${q.question}`),
  ]
  return sha256(parts.join('\n'))
}
