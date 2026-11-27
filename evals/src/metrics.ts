// Retrieval metrics. They are deterministic (no model), so one round measures them; the rounds
// with mean ± deviation are for the generated answers.

/**
 * Share of the expected sources found in the first k results. `undefined` when there is nothing
 * to find (an unanswerable question): it is left out of the mean, not counted as 0 or 1.
 */
export function recallAtK(
  results: readonly string[],
  expected: readonly string[],
  k: number,
): number | undefined {
  if (expected.length === 0) return undefined
  const top = new Set(results.slice(0, k))
  const wanted = [...new Set(expected)]
  return wanted.filter((id) => top.has(id)).length / wanted.length
}

/** 1 / rank of the first expected source in the results (0 when none is there). */
export function reciprocalRank(results: readonly string[], expected: readonly string[]): number | undefined {
  if (expected.length === 0) return undefined
  const wanted = new Set(expected)
  const rank = results.findIndex((id) => wanted.has(id))
  return rank === -1 ? 0 : 1 / (rank + 1)
}

/** Mean of the defined values; undefined when there are none. */
export function mean(values: readonly (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => v !== undefined)
  return defined.length === 0 ? undefined : defined.reduce((a, b) => a + b, 0) / defined.length
}

/** Sample standard deviation (n − 1), as the scoreboard reports it across rounds; 0 for one value. */
export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const m = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1))
}
