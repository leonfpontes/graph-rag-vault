# 0004 · Answers that cite and quote their passages, on Claude Haiku 5.5

**Status:** accepted · 2026-11-27

## Context

An answer must come only from what the search found, and a reader must see where each sentence came
from. A citation the model writes can still be wrong: a passage the search never returned, or a
passage that doesn't say what the sentence says. The answer runs only locally, with the person's
key; the demo replays recorded answers.

## Decision

- **Model:** `claude-haiku-5-5` (effort `medium`), with `claude-haiku-4-5-20251001` as the
  fallback when the primary fails after its retries. A cost allowlist (the models priced in
  `packages/answer/src/pricing.ts`) refuses any other model before a call. No Sonnet.
- **Output through a tool:** the model calls `submit_answer` with `answerable` and short sentences,
  each with its sources as `{ passage: "P2", quote: "exact words" }`. The prompt is a file
  (`packages/answer/prompts/answer.md`) and its hash is the prompt version.
- **Checked by code, not trusted:** a source whose passage id wasn't sent is dropped; a quote is
  kept only if its words (case, punctuation and spacing aside) are in that passage. A sentence left
  with no source is removed and returned as removed, with the reason (`no-source`,
  `unknown-passage`, `quote-not-found`), so the app can show it struck out.
- **"I don't know":** when the model says the passages don't answer, or every sentence is removed,
  the answer is unknown and lists the 3 nearest notes. With no passages, no call is made.
- **Robustness:** one reminder when the model answers in text or with a broken tool input; then an
  error. Retries on 408, 409, 429, 5xx and 529 with the server's retry-after (at most 30 s).

## Evidence

Live smoke on the 5 probe questions (rehearsal search, 2026-11-27): 2 temporal questions answered
from the newer note with every quote found, the unanswerable one and the 2 whose answer note the
search missed answered "I don't know"; no sentence removed; $0.0025 in total ($0.0005 per answer).

## Consequences

- The quote check proves a passage contains the words, not that the words support the sentence:
  faithfulness is measured by the judge in the evaluation, checked against a human sample.
- A quote the model paraphrases is dropped even when the fact is right; the evaluation counts it.
