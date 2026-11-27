# 0006 · A scoreboard on questions never used for tuning, with a judge that is checked

**Status:** accepted · 2026-11-27

## Context

The project claims that the graph helps. That claim needs numbers a reader can trust: measured on
questions no weight or prompt was fitted to, against a strong vector baseline, with the answers'
faithfulness judged and the judge itself checked.

## Decision

- **Splits:** 10 questions tune (`probe`, `dev`); the 40 `test` questions only score. A run without
  the test split is a rehearsal: it writes `rehearsal.*` (not committed) and never answers a test
  question.
- **Retrieval** (recall@5, MRR) runs once: the search is deterministic. The vector-only variant is
  also measured with each candidate embedding model, and the scoreboard names the strongest.
- **Headline (the rule approved with the prototype):** hybrid against the best other variant
  (vectors only or graph only) on recall@5; under 5 points it is a tie, and no word suggests a win.
  A second line says what hybrid adds to vectors only.
- **Answers** run 3 rounds per question and variant, with mean ± sample deviation: faithfulness from
  the judge (supported 1, partial 0.5, unsupported 0, per kept sentence), citations kept by the
  quote check (code, no model), sentences removed, "I don't know" on unanswerable questions,
  answerable questions answered, expected notes cited, cost and latency.
- **Judge:** Claude Haiku 5.5, one call per answer, a verdict per sentence through a tool, against
  the passages that sentence cites only (`evals/prompts/judge.md`).
- **Judge check sample:** about 10 answers from round 1, half among those with a sentence the judge
  did not fully support (a random sample would be almost all `supported`, and kappa would measure
  nothing): `evals/results/judge-sample.json`.
- **Human check:** a blind one (the person sees the question, the sentence and the cited passages,
  not the verdict) gives agreement and Cohen's kappa. A review where the person sees the verdicts
  (`"blind": false` in `human-labels.json`) is published as a review, with how many verdicts the
  person agreed with and no kappa.
- **Second judge:** Claude Opus 5.5 (never Sonnet) labels the same sample blind, with the same
  prompt, passages and tool, under the remaining cap (`pnpm eval --second-judge`,
  `second-judge.json`). Its agreement and kappa with the first judge are published as agreement
  between two automatic judges, never as a human check. Opus is priced in `PRICES` but outside the
  default allowlist, so it can't answer questions. Below a kappa of 0.8, moving the main judge is
  decided by the product owner, not by the script.
- **Cost:** a hard cap (default $5); each job reserves its worst case at the fallback model's price
  before it starts.

## Evidence

First scoreboard (`evals/results/latest.json`, 2026-11-27): recall@5 hybrid 91%, graph only 93%,
vectors only 78% with the shipped model (78% with arctic-embed-xs, 73% with all-MiniLM); the gap is
in multi-hop questions (vectors 55%, hybrid 79%). Answers on hybrid search: 96% of answerable
questions answered against 79% on vectors, 84% of the expected notes cited against 67%,
faithfulness 94–97% in every variant, every unanswerable question answered "I don't know". The
whole run (370 answers and their judgments) cost $0.17.

Judge check (2026-11-27, 21 sentences from 10 answers): the person reviewed the verdicts, not
blind, and agreed with all 21. Claude Opus 5.5, blind, agreed with Haiku 5.5 on 76% (kappa 0.22).
On all 5 differences Haiku said partial and Opus supported, so Haiku is the stricter judge. The
second judge cost $0.11. The product owner kept Haiku 5.5 as the main judge: its faithfulness is
a conservative estimate, and a low kappa is expected with 6 flagged sentences and one-way
disagreements.

## Consequences

- Any change to the vault, the questions or the search makes the scoreboard stale; a test fails
  until `pnpm eval` runs again (about $0.20).
- The scoreboard says which check the judge had: blind, a review that was not blind, a second
  automatic judge, or none.
