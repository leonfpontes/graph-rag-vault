# Scoreboard: 40 questions never used for tuning

Hybrid search finds 91% of the expected notes in its top 5, against 78% for vectors only (+13.1 points).

> **Note:** Before this run, a rehearsal bug answered the 40 test questions once, and those answers were read. Nothing was tuned on them: the search weights were fixed earlier on the 10 tuning questions, and the one change made afterwards (a passage per note that words its typed links and aliases, which live in the frontmatter) came from the tuning questions q-001, q-002, q-008 and q-009, which failed for that reason. The bug is fixed and tested: a rehearsal never answers a test question.

> **Note:** Graph only finds slightly more of the expected notes in its top 5 than hybrid (93% against 91%), but hybrid ranks them higher (MRR 0.87 against 0.78) and answers more of the answerable questions (96% against 94%).

> **Note:** The human check samples half of its answers among those with a sentence the judge did not fully support, so the agreement measures the judge where it matters; it is not a random sample of all answers.

## Retrieval · recall@5 / MRR (one round: the search is deterministic)

| Variant                          | all (33)   | fact (8)    | multi-hop (14) | temporal (11) |
| -------------------------------- | ---------- | ----------- | -------------- | ------------- |
| Vectors only (bge-small-en-v1.5) | 78% / 0.73 | 100% / 0.92 | 55% / 0.65     | 91% / 0.71    |
| Graph only (bge-small-en-v1.5)   | 93% / 0.78 | 100% / 0.77 | 83% / 0.88     | 100% / 0.67   |
| Hybrid (bge-small-en-v1.5)       | 91% / 0.87 | 100% / 0.88 | 79% / 0.96     | 100% / 0.75   |
| Vectors only (all-minilm-l6-v2)  | 73% / 0.76 | 100% / 0.92 | 50% / 0.73     | 82% / 0.70    |
| Vectors only (arctic-embed-xs)   | 78% / 0.82 | 100% / 1.00 | 55% / 0.78     | 91% / 0.74    |

## Answers · mean ± deviation over 3 rounds (claude-haiku-5-5, judged by claude-haiku-5-5)

| Variant      | Faithfulness | Citations kept | Sentences removed | "I don't know" when unanswerable | Answered when answerable | Expected notes cited | Cost per answer | Median latency |
| ------------ | ------------ | -------------- | ----------------- | -------------------------------- | ------------------------ | -------------------- | --------------- | -------------- |
| Vectors only | 96% ± 2      | 99% ± 1        | 1% ± 1            | 100% ± 0                         | 79% ± 0                  | 67% ± 0              | $0.0004         | 1.5 s          |
| Graph only   | 97% ± 1      | 99% ± 1        | 0% ± 0            | 100% ± 0                         | 94% ± 3                  | 82% ± 3              | $0.0005         | 1.6 s          |
| Hybrid       | 94% ± 1      | 99% ± 1        | 0% ± 0            | 100% ± 0                         | 96% ± 2                  | 84% ± 3              | $0.0005         | 1.8 s          |

**Judge checked by a human:** pending.

**Cost:** $0.17 of a $5.00 cap (answers $0.11, judge $0.06).

Run 2026-11-27 · answer prompt 4987a68d9da9 · judge prompt 4439e6cce528 · index 0da96347a942. Faithfulness: supported 1, partial 0.5, unsupported 0, per sentence kept. "Citations kept": the share of the sources the model gave whose quote is in the cited passage (checked by code).
