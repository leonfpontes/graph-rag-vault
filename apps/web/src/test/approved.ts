// Copy approved outside the repository, frozen here so the tests read only repository files. The
// page writes these sentences from latest.json; with this scoreboard they must read exactly so.

/** The judge card, as approved after the index rebuild of 27/11/2026 (the same text as the README). */
export const JUDGE_LINES = [
  "Checked by a person (Leonardo Pontes) on a stratified sample of 10 answers (half from those with a sentence the judge did not fully support). Reviewed not blind: agreed with the judge on 18 of 18 sentences. Labelled blind, without the judge's verdicts: agreed on 2 of 3 sentences (the answers that changed in the index rebuild); on the third the judge said partial and the person supported, the same direction as the second judge. No kappa: the review saw the verdicts, and 3 blind sentences are too few for one.",
  "Agreement between two automatic judges: Claude Opus 5.5, blind, on the same 21 sentences: 76%, Cohen's kappa 0.00. All 5 disagreements go the same way: the main judge said partial, the second judge said supported, so the faithfulness above is a conservative estimate. Kappa says little here: the second judge marked all 21 sentences supported, and with one judge on a single label, kappa is 0 whatever the other does. The main judge stays Claude Haiku 5.5.",
  'Cost: $0.17 for all recorded answers and their judgments (370); the index rebuild asked again the 111 whose search notes changed, for $0.04; the second judge cost $0.11.',
]

/** Words the judge card never uses: the person's review was not blind, and the sample is stratified. */
export const JUDGE_NEVER = [
  /checked by a human/i,
  /checked by leonardo/i,
  /picked at random/i,
  /kappa 1\.00/i,
  /21 of 21/,
  /review pending/i,
]

/** The scoreboard sentence with the index rebuilt on WebAssembly (27/11/2026). */
export const HEADLINE = {
  long: 'Hybrid search and graph only tie: 91% and 93% of the expected notes in the top 5 (−2 points, under the 5-point tie line).',
  sub: 'Against vectors only (73%), hybrid search is +18.2 points: what the graph adds to vectors.',
  short: 'Hybrid search and graph only tie: recall@5 91% and 93%.',
  subShort: 'Vectors only: 73% (hybrid +18.2 points).',
}
