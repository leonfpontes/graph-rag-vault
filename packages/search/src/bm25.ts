// Keyword search over the chunks: BM25 in plain TypeScript, so the browser ranks exactly as Node
// does (SQLite's FTS5 is not there). Terms are lowercase words without stop words, with a light
// plural stemmer ("cells" → "cell", "batteries" → "battery").

const STOP = new Set(
  (
    'a about after all also an and any are as at be been before but by can did do does for from had has ' +
    'have how i if in into is it its may more most new not now of on or our out over so than that the ' +
    'their them then there these they this those to under up was we were what when where which while ' +
    'who whom whose why will with would you your'
  ).split(' '),
)

/** A word without its plural ending; short words stay as they are. */
export function stem(word: string): string {
  if (word.length <= 3 || /\d/.test(word)) return word
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`
  if (/(ss|us|is)$/.test(word)) return word
  if (/(xes|ches|shes|sses)$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('s')) return word.slice(0, -1)
  return word
}

/** The terms of a text, in order, repeats kept. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)
}

export interface KeywordHit {
  /** Row of the document list. */
  index: number
  score: number
  /** The question terms the document contains. */
  matched: string[]
}

export const BM25_K1 = 1.2
export const BM25_B = 0.75

/** Builds a BM25 ranker over `documents`. The returned function ranks them for a query, best first. */
export function bm25(documents: readonly string[]): (query: string) => KeywordHit[] {
  const docs = documents.map(terms)
  const counts = docs.map((d) => {
    const tf = new Map<string, number>()
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1)
    return tf
  })
  const df = new Map<string, number>()
  for (const tf of counts) for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const n = docs.length
  const avg = n === 0 ? 0 : docs.reduce((a, d) => a + d.length, 0) / n
  return (query) => {
    const q = [...new Set(terms(query))]
    const hits: KeywordHit[] = []
    counts.forEach((tf, index) => {
      let score = 0
      const matched: string[] = []
      for (const t of q) {
        const f = tf.get(t)
        if (!f) continue
        const d = df.get(t)!
        const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5))
        score +=
          (idf * f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * docs[index]!.length) / avg))
        matched.push(t)
      }
      if (score > 0) hits.push({ index, score, matched })
    })
    return hits.sort((a, b) => b.score - a.score || a.index - b.index)
  }
}
