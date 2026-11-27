# Graph RAG over a Markdown vault

A vault of Markdown notes becomes a typed knowledge graph. Questions are answered with hybrid
search (the graph plus embeddings), every sentence of an answer cites the note it came from, and an
evaluation measures what the graph adds over vector search alone.

> **Status: in development.** The skeleton, the contracts and CI are in place; the vault, the
> search, the app and the scoreboard come next. Every number here is measured: [the scoreboard](evals/results/latest.md).

## Quickstart

Node 24 and pnpm.

```bash
git clone https://github.com/leonfpontes/graph-rag-vault
cd graph-rag-vault && pnpm install
pnpm demo   # http://127.0.0.1:8787
```

No key is needed: the search runs in the browser, and the 50 evaluation questions replay their
recorded answers. For written answers to new questions, copy `.env.example` to `.env.local`, put
your Anthropic key in `ANTHROPIC_API_KEY` and run `pnpm demo` again (each answer costs a fraction of
a cent; `--no-key` ignores the key).

## How it works

```mermaid
flowchart LR
  vault[Markdown vault] --> parse[vault: notes + typed links]
  parse --> index[index: chunks, embeddings, graph in SQLite]
  index --> search{{search: vector + graph + keyword, fused}}
  question[Question] --> search
  search --> answer[Answer that cites its notes]
  search -. recall@5, MRR .-> evals[evals: 3 variants, scoreboard]
```

- **The vault** is a fictional company, Tarnwick Cycles: people, projects, decisions, meetings,
  documents and customers, linked by typed relations (`owner`, `decided_in`, `supersedes`…).
- **The search** runs in plain TypeScript, the same code in Node and in the browser, and says why
  each result came in: a vector match, a title, a keyword, or a link from another result.
- **The evaluation** compares three variants (vectors only, graph only, hybrid) on questions with
  known source notes.

## Scoreboard

40 questions never used for tuning, measured on 2026-11-27 ([full scoreboard](evals/results/latest.md)).
Answers by Claude Haiku 5.5, mean of 3 rounds.

| Variant      | Expected notes in the top 5 | MRR  | Answerable questions answered | Expected notes cited | Faithfulness |
| ------------ | --------------------------- | ---- | ----------------------------- | -------------------- | ------------ |
| Hybrid       | 91%                         | 0.87 | 96%                           | 84%                  | 94%          |
| Graph only   | 93%                         | 0.78 | 94%                           | 82%                  | 97%          |
| Vectors only | 78%                         | 0.73 | 79%                           | 67%                  | 96%          |

- **Search:** hybrid and graph only tie (2 points apart, under the 5-point tie line); against
  vectors only, hybrid is +13 points, most of it on multi-hop questions (79% against 55%).
- **Faithfulness** comes from an automatic judge (Claude Haiku 5.5), sentence by sentence, against
  the passages each sentence cites.
- **Reviewed by a person (Leonardo Pontes), not blind: agreed with the judge on 21 of 21
  sentences**, stratified sample (half of the 10 answers from those with a sentence the judge did
  not fully support). No kappa: the person saw the judge's verdicts.
- **Agreement between two automatic judges:** Claude Opus 5.5, blind, on the same 21 sentences:
  76%, Cohen's kappa 0.22. All 5 disagreements go the same way: the main judge said partial, the
  second judge said supported, so the faithfulness above is a conservative estimate. A low kappa
  is expected here: the main judge marked only 6 of 21 sentences as not fully supported, and with
  so few cases, 5 disagreements that all go one way pull kappa down even at 76% agreement. The
  main judge stays Claude Haiku 5.5.
- **Cost:** $0.17 for the whole run (370 answers and their judgments), plus $0.11 for the second
  judge.

## Repository

| Folder            | What it has                                                     |
| ----------------- | --------------------------------------------------------------- |
| `packages/vault`  | The note and link contract, and the Markdown parser             |
| `packages/index`  | The SQLite index: migrations, chunks, embeddings and the graph  |
| `packages/search` | Hybrid search, the same in Node and in the browser              |
| `packages/client` | What the app reads: the static demo in the browser, the routes  |
| `packages/api`    | The local API and the server for the app and the demo           |
| `apps/web`        | The app on Atlas UI: Explore, Ask, Note and Evaluation          |
| `evals`           | Questions with expected sources, the metrics and the scoreboard |

## Development

| Command                  | Does                                                                |
| ------------------------ | ------------------------------------------------------------------- |
| `pnpm dev --port 5173`   | the web app with hot reload (the API from `pnpm serve`)             |
| `pnpm demo --port 8787`  | builds, then serves the app and the API on one port                 |
| `pnpm serve --port 8787` | the same server, rebuilding only the API                            |
| `pnpm check`             | types, lint, formatting, tests and build                            |
| `pnpm qa`                | `pnpm check`, then the end-to-end tests (`E2E_PORT` picks the port) |
| `pnpm test --coverage`   | the tests with the coverage floors, as CI runs them                 |
| `pnpm index`             | rebuilds the search index from the vault (downloads the model once) |
| `pnpm retrieval`         | recall@5 and MRR of the three variants on the tuning questions      |

Every server listens on 127.0.0.1. `--port` or the `PORT` variable picks the port; a busy port
stops the server with an error, it never moves to the next one.

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Rules for AI agents:
[AGENTS.md](AGENTS.md). Changes: [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE). Built by [Leonardo Pontes](https://www.linkedin.com/in/leonardo-fonseca-pontes-465740103/).
Tarnwick Cycles and everyone in its vault are fictional.
