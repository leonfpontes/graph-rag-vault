# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added

- `@graph-rag/embeddings`: one open embedding model pinned to a revision, the same in Node and in
  the browser, with the query prefix and the model's token counter (ADR 0003).
- The repository skeleton: README, agent rules, license, security policy, CI with coverage floors,
  secret scanning (gitleaks in CI and before each commit) and a guard against internal names.
- The pnpm monorepo: `vault`, `index`, `search`, `api`, `web` and `evals`, with their contracts
  (notes and typed links, reversible migrations, search results with reasons, questions and
  retrieval metrics) and a local server that takes `--port`.
