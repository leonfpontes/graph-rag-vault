# 0005 · Hybrid search: fused entry lists, then scores spread along typed links

**Status:** accepted · 2026-11-27

## Context

Vectors alone miss what the vault only says through links (the dealer at the meeting where a
decision was made) and pick the old note when a newer one replaced it in other words. The search
must explain each result, run the same in Node and in the browser (ADR 0002), and be tuned only on
the 10 probe and dev questions, never on the 40 that make the scoreboard.

## Decision

- **Entry lists:** the vector neighbours (best chunk per note, top 20), the notes the question names
  by title or alias, and BM25 keyword matches (top 20). They are fused by weighted RRF (k = 60;
  the title list weighs 2) and normalized so the best note scores 1.
- **Graph:** a linked note inherits `score × min(1, alpha × relation weight)`, up to 2 hops, both
  directions, keeping the best path. A relation the question names ("report to", "dealer",
  "owner") weighs double. A note that `supersedes` a found note takes over its whole score.
- **Time:** score × (1 + 0.15 × recency) in all three variants; a replaced note, or one whose
  status is `superseded` or `outdated`, × 0.5.
- **Variants:** `vector` uses only the vector list; `graph` uses titles and keywords, then the graph;
  `hybrid` uses all three lists, then the graph.
- **Keywords in TypeScript, not FTS5:** the browser has no SQLite, and the demo must rank exactly
  as the evaluation measures. FTS5 stays in the schema for lookups in the local API.
- **The index file** (`apps/web/public/data/index.bin`, about 0.7 MB) carries notes, links, chunks,
  their vectors and the 50 questions with theirs. `pnpm index` writes it; a test fails when it is
  behind the vault or the questions.

## Evidence

- Fusing the graph as one more RRF list tied with vectors on the probe (recall@5 0.42 both): a note
  reached only by a link always lost to notes in two lists. Spreading scores reached 0.75.
- Tuning set (probe + dev, 9 answerable questions), `pnpm retrieval`: recall@5 vector 0.67, graph
  0.85, hybrid 0.93. Title weight and relation boost sit in the middle of a plateau (hybrid 0.93 to
  0.96 for title weight 2–3, boost 1–2, alpha 0.5–0.7). Nine questions are few: the test split says
  whether this holds.

## Consequences

- Relation cues are English patterns (`RELATION_CUES`); a question in other words gets the plain
  weights.
- The demo and the evaluation share one ranking; a Playwright test proves the browser gives the
  same top 5 as Node for every recorded question.
