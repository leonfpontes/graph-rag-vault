# 0006 · A scoreboard on questions never used for tuning, with a judge checked by a person

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
  Differences under 5 recall@5 points are reported as a tie.
- **Answers** run 3 rounds per question and variant, with mean ± sample deviation: faithfulness from
  the judge (supported 1, partial 0.5, unsupported 0, per kept sentence), citations kept by the
  quote check (code, no model), sentences removed, "I don't know" on unanswerable questions,
  answerable questions answered, expected notes cited, cost and latency.
- **Judge:** Claude Haiku 5.5, one call per answer, a verdict per sentence through a tool, against
  the passages that sentence cites only (`evals/prompts/judge.md`).
- **Human check:** about 10 answers from round 1, half among those with a sentence the judge did not
  fully support (a random sample would be almost all `supported`, and kappa would measure
  nothing). The person sees the question, the sentence and the cited passages, not the verdict.
  Agreement and Cohen's kappa go on the scoreboard. Below a kappa of 0.8, the judge moves to a
  larger model, within the cap.
- **Cost:** a hard cap (default $5); each job reserves its worst case at the fallback model's price
  before it starts.

## Evidence

First scoreboard (`evals/results/latest.json`, 2026-11-27): recall@5 hybrid 91%, graph only 93%,
vectors only 78% with the shipped model (78% with arctic-embed-xs, 73% with all-MiniLM); the gap is
in multi-hop questions (vectors 55%, hybrid 79%). Answers on hybrid search: 96% of answerable
questions answered against 79% on vectors, 84% of the expected notes cited against 67%,
faithfulness 94–97% in every variant, every unanswerable question answered "I don't know". The
whole run (370 answers and their judgments) cost $0.17.

## Consequences

- Any change to the vault, the questions or the search makes the scoreboard stale; a test fails
  until `pnpm eval` runs again (about $0.20).
- The judge's verdicts count only after the human check; until then the scoreboard says it is
  pending.
