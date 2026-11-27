# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added

- One runtime for the vectors: the index, the local API and the evaluation run the embedding model
  on onnxruntime-web (WebAssembly) through `@graph-rag/embeddings/node`, as the browser does, so a
  question gets the same vector everywhere (cosine 0.9999997, the same top 5 in 50 of 50; before,
  onnxruntime-node gave 0.996 and 24 of 50). Passages are embedded one per call (a batch changes
  8-bit vectors). The runtime keys the stored vectors and the index's source hash. The index was
  rebuilt: graph only and hybrid keep 93% and 91%, vectors only goes from 78% to 73%.
  `pnpm eval --reuse` asked again only the 111 answers whose search notes changed ($0.04);
  `pnpm eval --sheet` keeps the judge-check sample, moves the person's labels where nothing
  changed and lists only what needs review.
- The judge check on the scoreboard and in the README: the person's review, not blind (agreed with
  the judge on 21 of 21 sentences, no kappa), and a blind second judge, Claude Opus 5.5, on the same
  stratified sample (`pnpm eval --second-judge`): agreement between two automatic judges 76%,
  Cohen's kappa 0.22, $0.11. Opus is priced but outside the default allowlist. The sample file is
  now `judge-sample.json`.
- The demo with no key and the local API. `@graph-rag/client` loads the search index, the
  scoreboard (`latest.json` as it is), the questions and the recorded answers in the browser: the
  first search answers in under 2 s, the 50 questions replay their answers at once, and a new
  question gets its search results and the commands to answer it locally. The local server adds
  `/api/search`, `/api/notes/<id>`, `/api/graph` and `POST /api/answer` (with the person's key:
  JSON from its own pages only, one at a time, 8 KB body, loopback hosts), real 404s for unknown
  paths, and `vercel.json` for a static deploy with `SITE_URL` for the social cards.
- The scoreboard (`pnpm eval`): retrieval of the three variants and vector baselines with each
  embedding model; answers and a faithfulness judge over 3 rounds with mean ± deviation; citations
  kept, sentences removed, "I don't know", cost and latency; a hard $5 cap; a check of the judge
  with Cohen's kappa. Answers read a "Links" passage per note that words its typed links
  and aliases, which live in the frontmatter.
- Hybrid search with the reason for every result (vector, title, keyword, typed link, replacement,
  recency, stale): entry lists fused by RRF, then scores spread along typed links; the same code in
  Node and the browser (ADR 0005). Incremental ingestion into SQLite, the search index file for the
  demo (`pnpm index`) and free retrieval scores on the tuning questions (`pnpm retrieval`).
- `@graph-rag/answer`: answers from the retrieved passages only, on Claude Haiku 5.5 with a
  fallback; every sentence cites and quotes a passage, checked by code; unsupported sentences are
  removed and shown as removed; with no basis the answer says it doesn't know (ADR 0004).
- The example vault: Tarnwick Cycles, 207 invented notes rendered from `examples/tarnwick/world.yaml`,
  with the note parser, the index schema (notes, aliases, links, chunks with full-text search,
  embeddings) and a 5-question probe whose traps are proved from the vault.
- The evaluation set: 50 questions (10 to tune, 40 for the scoreboard), each with evidence that the
  answer is in its sources and traps proved from the vault.
- `@graph-rag/embeddings`: one open embedding model pinned to a revision, the same in Node and in
  the browser, with the query prefix and the model's token counter (ADR 0003).
- The repository skeleton: README, agent rules, license, security policy, CI with coverage floors,
  secret scanning (gitleaks in CI and before each commit) and a guard against internal names.
- The pnpm monorepo: `vault`, `index`, `search`, `api`, `web` and `evals`, with their contracts
  (notes and typed links, reversible migrations, search results with reasons, questions and
  retrieval metrics) and a local server that takes `--port`.
