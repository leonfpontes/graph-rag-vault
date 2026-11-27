# Scoreboard: 40 questions never used for tuning

Hybrid search and graph only tie: 91% and 93% of the expected notes in the top 5 (-2 points, under the 5-point tie line).

Against vectors only (78%), hybrid search is +13.1 points: what the graph adds to vectors.

> **Note:** Before this run, a rehearsal bug answered the 40 test questions once, and those answers were read. Nothing was tuned on them: the search weights were fixed earlier on the 10 tuning questions, and the one change made afterwards (a passage per note that words its typed links and aliases, which live in the frontmatter) came from the tuning questions q-001, q-002, q-008 and q-009, which failed for that reason. The bug is fixed and tested: a rehearsal never answers a test question.

> **Note:** Graph only finds slightly more of the expected notes in its top 5 than hybrid (93% against 91%), but hybrid ranks them higher (MRR 0.87 against 0.78) and answers more of the answerable questions (96% against 94%).

> **Note:** The judge check samples half of its answers among those with a sentence the judge did not fully support, so it looks at the judge where it matters; it is not a random sample of all answers.

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

**Judge reviewed by a person (Leonardo Pontes), not blind:** agreed with the judge on 21 of 21 sentences, stratified sample (half of the 10 answers from those with a sentence the judge did not fully support). No kappa: the person saw the judge's verdicts.

**Agreement between 2 automatic judges (not a human check):** claude-opus-5-5 labelled the same 21 sentences from 10 answers of the judge-check sample (stratified, not random: see the note above) on 2026-11-27, with the same prompt and passages and without seeing the first verdicts. Agreement 76%, Cohen's kappa 0.22.

They differ on 5 sentences; claude-haiku-5-5 is the stricter on 5, so if claude-opus-5-5 is right, the faithfulness above is understated:

- S01 (Vectors only, q-021): claude-haiku-5-5 partial, claude-opus-5-5 supported (“Passage names Chloé Dumont as owner and names no author.”). Sentence: "The passages name Chloé Dumont as the owner of the Wheel building standard, not as its author."
- S02 (Vectors only, q-021): claude-haiku-5-5 partial, claude-opus-5-5 supported (“Passage states Chloé Dumont reports to Hiro Sato; the conclusion is explicitly hedged.”). Sentence: "Chloé Dumont reports to Hiro Sato, so on that basis the answer is Hiro Sato."
- S07 (Hybrid, q-022): claude-haiku-5-5 partial, claude-opus-5-5 supported (“Supply review 17 Mar 2026 meeting note records keeping Ampcore as battery supplier.”). Sentence: "That Keep Ampcore decision was taken at the Supply review of 17 March 2026."
- S08 (Vectors only, q-023): claude-haiku-5-5 partial, claude-opus-5-5 supported (“The 11 May 2026 Finance review lists 'Go live with the new ERP in February'.”). Sentence: "The February ERP go-live date appears in the outcome of the Finance review of 11 May 2026, the earliest meeting in these passages that records it."
- S12 (Graph only, q-037): claude-haiku-5-5 partial, claude-opus-5-5 supported (“Passage states the supplier cannot deliver before November.”). Sentence: "The reason given is that the supplier cannot deliver before November."

**Cost:** $0.17 of a $5.00 cap (answers $0.11, judge $0.06); the second judge added $0.11.

Run 2026-11-27 · answer prompt 4987a68d9da9 · judge prompt 4439e6cce528 · index 0da96347a942. Faithfulness: supported 1, partial 0.5, unsupported 0, per sentence kept. "Citations kept": the share of the sources the model gave whose quote is in the cited passage (checked by code).
