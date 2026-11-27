# 0002 · SQLite with brute-force vectors, and a static demo that searches in the browser

**Status:** accepted · 2026-11-27

## Context

The vault has about 200 notes, so about 2 thousand chunks with 384-dimension embeddings. The public
demo must open with no key and answer a search in under 2 s. The embedding model is open and runs
locally (the model choice has its own ADR).

## Decision

- **Storage:** `node:sqlite`, built into Node 24: notes, links, chunks and embeddings, with
  reversible migrations. No native extension to build on every platform.
- **Vectors:** Float32 little-endian BLOBs and a brute-force cosine scan in TypeScript. At about 2
  thousand chunks a scan takes a few milliseconds. Revisit past about 100 thousand chunks, where an
  index (a vector extension or HNSW) starts to pay for its build and its native binary.
- **Fusion:** reciprocal rank fusion (k = 60) of the vector, graph and keyword lists; no model
  reranks, so the search costs nothing and is deterministic.
- **Demo:** static. The index is exported as a binary file and `packages/search` (no Node
  built-ins) runs it in the browser. Recorded questions answer at once; a new question is embedded
  in the browser by the same model as the index. Generated answers run only locally, with the
  person's key. No serverless function loads the model (size and cold start).

## Consequences

- The search package must stay free of Node APIs (typecheck without Node types, a lint rule, tests
  in jsdom).
- Node and browser embeddings must match: a parity test comes with the embedding story.
