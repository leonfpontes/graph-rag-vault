// Copy approved outside the repository, frozen here so the tests read only repository files. The
// page writes these sentences from latest.json; with this scoreboard they must read exactly so.

/** The judge card, as approved for the scoreboard of 27/11/2026 (the same text as the README). */
export const JUDGE_LINES = [
  "Reviewed by a person (Leonardo Pontes), not blind: agreed with the judge on 21 of 21 sentences, stratified sample (half of the 10 answers from those with a sentence the judge did not fully support). No kappa: the person saw the judge's verdicts.",
  "Agreement between two automatic judges: Claude Opus 5.5, blind, on the same 21 sentences: 76%, Cohen's kappa 0.22.",
  'All 5 disagreements go the same way: the main judge said partial, the second judge said supported, so the faithfulness above is a conservative estimate.',
  'A low kappa is expected here: the main judge marked only 6 of 21 sentences as not fully supported, and with so few cases, 5 disagreements that all go one way pull kappa down even at 76% agreement. The main judge stays Claude Haiku 5.5.',
  '$0.17 for the whole run, plus $0.11 for the second judge.',
]

/** Words the judge card never uses: the person's review was not blind, and the sample is stratified. */
export const JUDGE_NEVER = [
  /checked by a human/i,
  /checked by leonardo/i,
  /picked at random/i,
  /kappa 1\.00/i,
]

/** The scoreboard sentence with the run of 27/11/2026 (d271f1d). */
export const HEADLINE = {
  long: 'Hybrid search and graph only tie: 91% and 93% of the expected notes in the top 5 (−2 points, under the 5-point tie line).',
  sub: 'Against vectors only (78%), hybrid search is +13.1 points: what the graph adds to vectors.',
  short: 'Hybrid search and graph only tie: recall@5 91% and 93%.',
  subShort: 'Vectors only: 78% (hybrid +13.1 points).',
}
