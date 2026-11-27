# Scoreboard: 40 questions never used for tuning

Hybrid search and graph only tie: 91% and 93% of the expected notes in the top 5 (-2 points, under the 5-point tie line).

Against vectors only (73%), hybrid search is +18.2 points: what the graph adds to vectors.

Against the strongest vector search we tried (arctic-embed-xs, 78%), hybrid is +13.1 points.

> **Note:** The index was rebuilt on 2026-11-27 with onnxruntime-web (WebAssembly), the runtime the browser uses, so a question searched in the demo gets the same vector as here (cosine > 0.9999). The earlier vectors came from onnxruntime-node, whose 8-bit kernels round differently (cosine 0.996). Graph only and hybrid kept their recall@5 and MRR; vectors only went from 78% to 73%. The 111 answers whose search notes changed were asked and judged again; the other 259 have the same inputs and were kept.

> **Note:** Before this run, a rehearsal bug answered the 40 test questions once, and those answers were read. Nothing was tuned on them: the search weights were fixed earlier on the 10 tuning questions, and the one change made afterwards (a passage per note that words its typed links and aliases, which live in the frontmatter) came from the tuning questions q-001, q-002, q-008 and q-009, which failed for that reason. The bug is fixed and tested: a rehearsal never answers a test question.

> **Note:** Graph only finds slightly more of the expected notes in its top 5 than hybrid (93% against 91%), but hybrid ranks them higher (MRR 0.87 against 0.78) and answers more of the answerable questions (96% against 94%).

> **Note:** The judge check samples half of its answers among those with a sentence the judge did not fully support, so it looks at the judge where it matters; it is not a random sample of all answers.

## Retrieval · recall@5 / MRR (one round: the search is deterministic)

| Variant                          | all (33)   | fact (8)    | multi-hop (14) | temporal (11) |
| -------------------------------- | ---------- | ----------- | -------------- | ------------- |
| Vectors only (bge-small-en-v1.5) | 73% / 0.73 | 100% / 0.92 | 50% / 0.66     | 82% / 0.67    |
| Graph only (bge-small-en-v1.5)   | 93% / 0.78 | 100% / 0.77 | 83% / 0.88     | 100% / 0.67   |
| Hybrid (bge-small-en-v1.5)       | 91% / 0.87 | 100% / 0.88 | 79% / 0.96     | 100% / 0.75   |
| Vectors only (all-minilm-l6-v2)  | 73% / 0.78 | 100% / 0.92 | 50% / 0.72     | 82% / 0.75    |
| Vectors only (arctic-embed-xs)   | 78% / 0.83 | 100% / 1.00 | 55% / 0.77     | 91% / 0.80    |

## Answers · mean ± deviation over 3 rounds (claude-haiku-5-5, judged by claude-haiku-5-5)

| Variant      | Faithfulness | Citations kept | Sentences removed | "I don't know" when unanswerable | Answered when answerable | Expected notes cited | Cost per answer | Median latency |
| ------------ | ------------ | -------------- | ----------------- | -------------------------------- | ------------------------ | -------------------- | --------------- | -------------- |
| Vectors only | 98% ± 1      | 99% ± 2        | 1% ± 1            | 100% ± 0                         | 73% ± 0                  | 62% ± 0              | $0.0004         | 1.3 s          |
| Graph only   | 97% ± 1      | 99% ± 1        | 0% ± 0            | 100% ± 0                         | 94% ± 3                  | 82% ± 3              | $0.0005         | 1.6 s          |
| Hybrid       | 95% ± 1      | 99% ± 0        | 1% ± 1            | 100% ± 0                         | 96% ± 2                  | 84% ± 3              | $0.0005         | 1.8 s          |

**Judge reviewed by a person (Leonardo Pontes), not blind:** agreed with the judge on 18 of 18 sentences from 8 of 10 answers, stratified sample (half of the 10 answers from those with a sentence the judge did not fully support). No kappa: the person saw the judge's verdicts. Review pending for 2 of 10 answers after the index rebuild.

**Agreement between 2 automatic judges (not a human check):** claude-opus-5-5 labelled the same 21 sentences from 10 answers of the judge-check sample (stratified, not random: see the note above) on 2026-11-27, with the same prompt and passages and without seeing the first verdicts. Agreement 76%, Cohen's kappa 0.00.

All 5 disagreements go the same way: the main judge (claude-haiku-5-5) said partial, the second judge said supported, so the faithfulness above is a conservative estimate.

Kappa says little here: the second judge marked all 21 sentences supported. With one judge on a single label, the agreement expected by chance equals the observed agreement, so kappa is 0 whatever the main judge does; the agreement (76%) and the disagreements below are the measure. The main judge stays claude-haiku-5-5.

The disagreements:

- S01 (Vectors only, q-039): claude-haiku-5-5 partial, claude-opus-5-5 supported (“Q3 2026 report, marked current, states field returns 0.8%.”). Sentence: "The most recent field return rate was 0.8%, reported in the Q3 2026 quality report."
- S04 (Graph only, q-026): claude-haiku-5-5 partial, claude-opus-5-5 supported (“Jonah Whitfield's note says Sana Orr handles the day-to-day accounts.”). Sentence: "Under Jonah Whitfield's team, Sana Orr is listed as handling the day-to-day accounts."
- S06 (Hybrid, q-022): claude-haiku-5-5 partial, claude-opus-5-5 supported (“The 17 Mar 2026 Supply review note records keeping Ampcore as battery supplier.”). Sentence: "That Keep Ampcore decision was taken at the Supply review of 17 March 2026."
- S07 (Vectors only, q-023): claude-haiku-5-5 partial, claude-opus-5-5 supported (“The 11 May 2026 Finance review lists 'Go live with the new ERP in February'.”). Sentence: "The February ERP go-live date appears in the outcome of the Finance review of 11 May 2026, the earliest meeting in these passages that records it."
- S11 (Graph only, q-037): claude-haiku-5-5 partial, claude-opus-5-5 supported (“The decision note says the supplier cannot deliver before November.”). Sentence: "The reason given is that the supplier cannot deliver before November."

**Cost:** this run $0.04 of a $1.00 cap, for the answers whose search notes changed; 259 answers with the same notes kept from the earlier run. All recorded answers: $0.17 (answers $0.11, judge $0.06); the second judge added $0.11.

Run 2026-11-27 · answer prompt 4987a68d9da9 · judge prompt 4439e6cce528 · index 3b0593aeb906. Faithfulness: supported 1, partial 0.5, unsupported 0, per sentence kept. "Citations kept": the share of the sources the model gave whose quote is in the cited passage (checked by code).
