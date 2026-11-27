// How numbers and dates read on screen. Every number is mono and tabular (the `n` class); these only
// turn values from the data into text, they never hold a number of their own.

/** 0.909 → "91%". */
export const pct = (x: number | undefined) => (x === undefined ? '—' : `${Math.round(x * 100)}%`)

/** Percentage points between two shares, signed: "+13 pp", "−2 pp", "±0 pp". */
export function pp(a: number | undefined, b: number | undefined): string {
  if (a === undefined || b === undefined) return '—'
  const d = Math.round((a - b) * 100)
  return `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} pp`
}

/** A signed number with a real minus sign: 13.1 → "+13.1", -2 → "−2". */
export const signed = (x: number, digits = 1) => {
  const r = Number(x.toFixed(digits))
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)}`
}

/** Mean ± one standard deviation of a share, in points: "96% ± 2". */
export const pctSd = (mean: number | undefined, sd: number) =>
  mean === undefined ? '—' : `${pct(mean)} ± ${Math.round(sd * 100)}`

export const usd = (x: number | undefined, digits = 2) => (x === undefined ? '—' : `$${x.toFixed(digits)}`)

/** Bytes as MB with one decimal ("11.2 MB"), or a whole number for the total ("34 MB"). */
export const mb = (bytes: number, digits = 1) => (bytes / 1_000_000).toFixed(digits)

export const thousands = (n: number) => n.toLocaleString('en-US')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-02" → "2 Oct 2026" (or "2 Oct" without the year). */
export function shortDate(iso: string, year = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const text = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`
  return year ? `${text} ${m[1]}` : text
}

/** "1492" ms → "1.5 s"; under a second stays in ms. */
export const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

/** Question ids: "q-022". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
