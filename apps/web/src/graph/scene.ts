// What the graph shows, apart from how it is drawn: the opacity of each note and link, which notes
// get a ring or a label, and where the labels go. The 2D canvas and the 3D scene both read this, so
// the rules hold in every view (docs/DESIGN.md, Graph):
// - a selection shows its neighborhood: 1 hop at full opacity, 2 hops at half, the rest at 12%;
// - a constellation (?cluster=) keeps its notes and fades the others to 12%;
// - an answer path lights only the links the answer walked, each with its type written on it, and
//   rings the cited notes with their citation number; everything else is gray;
// - labels are 12 px or more with a halo, never under the canvas controls and never over a visible note.
import type { AnswerPath } from '../lib/answer-path'
import { hops, type GraphMode, type Layout } from './layout'

export interface SceneOptions {
  mode: GraphMode
  /** Phones: one bubble per constellation instead of the notes. */
  summary?: boolean
  focus?: string
  cluster?: string
  path?: AnswerPath
  /** Note types shown (all when undefined). */
  types?: ReadonlySet<string>
  /** Link types shown (all when undefined). */
  relations?: ReadonlySet<string>
  /** Name the biggest constellations when nothing is selected. */
  clusterLabels?: boolean
  /** Turn slowly until the first interaction (never under reduced motion). */
  rotate?: boolean
  /** Starting zoom. */
  zoom?: number
}

export interface SceneState {
  visible: (i: number) => boolean
  alpha: (i: number) => number
  edgeVisible: (a: number, b: number, relation: string) => boolean
  edgeAlpha: (a: number, b: number) => number
  /** Path edges as node index pairs. */
  pathEdges: [number, number, string][]
  /** Notes to frame (the path, the constellation), when any. */
  fit: number[]
  /** Notes with a ring: the selection (ink) and the cited notes (evidence). */
  ring: (i: number) => 'focus' | 'cite' | undefined
  /** Notes to label, most important first. */
  labels: number[]
  /** Constellation names to write: seed node indexes. */
  clusterNames: number[]
  lit: (i: number) => boolean
  hop: Map<number, number>
}

export function sceneState(L: Layout, o: SceneOptions, narrow: boolean): SceneState {
  const path = o.path
  const onPath = new Set((path?.notes ?? []).map((id) => L.index.get(id)).filter((i) => i !== undefined))
  const hi = !!path
  const H = hops(L, o.focus)
  const csi = o.cluster === undefined ? undefined : L.index.get(o.cluster)
  const visible = (i: number) => !o.types || o.types.has(L.nodes[i]!.type)
  const alpha = (i: number) => {
    if (hi) return onPath.has(i) ? 1 : 0.22
    if (o.focus) return ({ 0: 1, 1: 1, 2: 0.5 } as Record<number, number>)[H.get(i) ?? -1] ?? 0.12
    if (csi !== undefined) return L.community[i] === csi ? 1 : 0.12
    return 1
  }
  const pathEdges: [number, number, string][] = []
  for (const e of path?.edges ?? []) {
    const a = L.index.get(e.from)
    const b = L.index.get(e.to)
    if (a !== undefined && b !== undefined) pathEdges.push([a, b, e.relation])
  }
  const isPathEdge = (a: number, b: number) =>
    pathEdges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
  const edgeVisible = (a: number, b: number, relation: string) =>
    visible(a) && visible(b) && (!o.relations || o.relations.has(relation)) && !(hi && isPathEdge(a, b))
  const edgeAlpha = (a: number, b: number) => {
    if (hi) return 0.14
    if (o.focus || csi !== undefined) return Math.min(alpha(a), alpha(b)) * 0.8
    return L.community[a] === L.community[b] ? 0.55 : 0.18
  }
  const cites = path?.cites ?? {}
  const ring = (i: number): 'focus' | 'cite' | undefined => {
    const id = L.nodes[i]!.id
    if (hi && cites[id]) return 'cite'
    if (!hi && id === o.focus) return 'focus'
    return undefined
  }
  const prio = (i: number) => (L.nodes[i]!.id === o.focus ? 0 : cites[L.nodes[i]!.id] ? 1 : 2)
  let labels: number[] = []
  if (hi) labels = [...onPath]
  else if (o.focus)
    labels = [...H.entries()]
      .filter(([, h]) => h <= 1)
      .map(([i]) => i)
      .slice(0, 10)
  else if (csi !== undefined)
    labels = L.nodes
      .map((_, i) => i)
      .filter((i) => L.community[i] === csi && i !== csi)
      .sort((a, b) => L.degree[b]! - L.degree[a]!)
      .slice(0, 8)
  labels = labels.filter(visible).sort((a, b) => prio(a) - prio(b))
  const size = (si: number) => L.community.filter((c) => c === si).length
  const clusterNames =
    hi || o.focus || o.clusterLabels === false
      ? []
      : csi !== undefined
        ? [csi]
        : L.seeds
            .filter(visible)
            .sort((a, b) => size(b) - size(a))
            .slice(0, narrow ? 6 : 12)
  const fit = hi
    ? [...onPath]
    : csi !== undefined
      ? L.nodes.flatMap((_, i) => (L.community[i] === csi ? [i] : []))
      : []
  return {
    visible,
    alpha,
    edgeVisible,
    edgeAlpha,
    pathEdges,
    fit,
    ring,
    labels,
    clusterNames,
    lit: (i) => onPath.has(i),
    hop: H,
  }
}

export interface Projected {
  x: number
  y: number
  /** Depth (bigger is farther). */
  z: number
  /** Perspective scale. */
  k: number
}

export interface Colors {
  edge: string
  evidence: string
  evidenceForeground: string
  canvas: string
  foreground: string
  muted: string
  type: Record<string, string>
}

export function readColors(el: Element): Colors {
  const css = getComputedStyle(el)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    edge: v('--edge'),
    evidence: v('--evidence'),
    evidenceForeground: v('--evidence-foreground'),
    canvas: v('--canvas'),
    foreground: v('--foreground'),
    muted: v('--muted-foreground'),
    type: Object.fromEntries(
      ['person', 'project', 'decision', 'meeting', 'customer', 'document'].map((t) => [t, v(`--t-${t}`)]),
    ),
  }
}

/** Radius of a note on screen: bigger with more links. */
export const radius = (L: Layout, i: number, p: Projected, zoom: number) =>
  (3 + Math.sqrt(L.degree[i]!) * 1.05) * p.k * (zoom > 1 ? Math.min(2, Math.sqrt(zoom)) : 1)

export type Box = [number, number, number, number]

/** Screen boxes of the controls drawn over the canvas: labels stay out of them. */
export function controlBoxes(container: HTMLElement): Box[] {
  const er = container.getBoundingClientRect()
  // Controls may sit next to the canvas, in the same graph area (search, view switch).
  const area = container.closest<HTMLElement>('[data-graph-area]') ?? container
  return [...area.querySelectorAll<HTMLElement>('[data-graph-control]')]
    .filter((x) => x.offsetParent !== null)
    .map((x) => {
      const r = x.getBoundingClientRect()
      return [r.left - er.left - 4, r.top - er.top - 4, r.right - er.left + 4, r.bottom - er.top + 4] as Box
    })
}

const SANS = '"IBM Plex Sans", system-ui, sans-serif'
const MONO = '"IBM Plex Mono", ui-monospace, monospace'

interface LabelOptions {
  font: string
  color: string
  badge?: number
  keep: boolean
  /** The note the label belongs to (screen x, y, radius): the label tries right, left, above, below. */
  at?: { x: number; y: number; r: number }
  spots?: (width: number) => [number, number][]
}

/** Draws labels where they fit: never under a control, a note or another label. */
export function labelWriter(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  boxes: Box[],
  colors: Colors,
) {
  return function label(text: string, o: LabelOptions) {
    ctx.font = o.font
    let t = text
    const max = W < 500 ? 130 : 200
    while (ctx.measureText(t).width > max && t.length > 4) t = t.slice(0, -2)
    if (t !== text) t = `${t.trimEnd()}…`
    const tw = ctx.measureText(t).width
    const full = (o.badge ? 24 : 0) + tw
    const a = o.at
    const tries: [number, number][] = o.spots
      ? o.spots(full)
      : a
        ? [
            [a.x + a.r + 8, a.y],
            [a.x - a.r - 8 - full, a.y],
            [a.x - full / 2, a.y - a.r - 14],
            [a.x - full / 2, a.y + a.r + 14],
            [a.x + a.r + 8, a.y - 16],
            [a.x + a.r + 8, a.y + 16],
            [a.x - a.r - 8 - full, a.y - 16],
            [a.x - a.r - 8 - full, a.y + 16],
            [a.x - full / 2, a.y - a.r - 30],
            [a.x - full / 2, a.y + a.r + 30],
            [a.x + a.r + 8, a.y - 32],
            [a.x + a.r + 8, a.y + 32],
          ]
        : []
    if (!tries.length) return
    const free = ([tx, ty]: [number, number]) =>
      tx > 4 &&
      tx + full < W - 4 &&
      ty > 10 &&
      ty < H - 10 &&
      !boxes.some((q) => tx - 2 < q[2] && tx + full + 2 > q[0] && ty - 10 < q[3] && ty + 10 > q[1])
    let spot = tries.find(free)
    if (!spot) {
      if (!o.keep) return
      spot = [Math.max(4, Math.min(W - full - 4, tries[0]![0])), Math.max(12, Math.min(H - 12, tries[0]![1]))]
    }
    boxes.push([spot[0] - 2, spot[1] - 10, spot[0] + full + 2, spot[1] + 10])
    let x = spot[0]
    const y = spot[1]
    ctx.textBaseline = 'middle'
    if (a && spot !== tries[0]) {
      ctx.globalAlpha = 0.6
      ctx.strokeStyle = colors.muted
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(x + (x < a.x ? full : 0), y)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    if (o.badge) {
      ctx.font = `600 12px ${MONO}`
      ctx.fillStyle = colors.evidence
      ctx.beginPath()
      ctx.roundRect(x, y - 9, 18, 18, 3)
      ctx.fill()
      ctx.fillStyle = colors.evidenceForeground
      ctx.textAlign = 'center'
      ctx.fillText(String(o.badge), x + 9, y + 0.5)
      ctx.textAlign = 'left'
      x += 24
      ctx.font = o.font
    }
    ctx.lineWidth = 4
    ctx.strokeStyle = colors.canvas
    ctx.lineJoin = 'round'
    ctx.strokeText(t, x, y)
    ctx.fillStyle = o.color
    ctx.fillText(t, x, y)
  }
}

/** Node labels, then the link type on each path link, then the constellation names. */
export function drawLabels(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  o: SceneOptions,
  s: SceneState,
  proj: Projected[],
  rad: (i: number) => number,
  W: number,
  H: number,
  controls: Box[],
  colors: Colors,
) {
  const boxes = [...controls]
  L.nodes.forEach((_, i) => {
    if (!s.visible(i) || s.alpha(i) < 0.5) return
    const p = proj[i]!
    const r = rad(i) + 2
    boxes.push([p.x - r, p.y - r, p.x + r, p.y + r])
  })
  const label = labelWriter(ctx, W, H, boxes, colors)
  const cites = o.path?.cites ?? {}
  for (const i of s.labels) {
    const n = L.nodes[i]!
    const p = proj[i]!
    label(n.title, {
      font: `${n.id === o.focus ? 600 : 500} 12px ${SANS}`,
      color: colors.foreground,
      badge: cites[n.id],
      keep: !!o.path || n.id === o.focus || !!cites[n.id],
      at: { x: p.x, y: p.y, r: rad(i) },
    })
  }
  for (const [a, b, rel] of s.pathEdges) {
    const pa = proj[a]!
    const pb = proj[b]!
    label(rel, {
      font: `500 12px ${MONO}`,
      color: colors.evidence,
      keep: true,
      spots: (fw) =>
        [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85].flatMap((t) => {
          const x = pa.x + (pb.x - pa.x) * t
          const y = pa.y + (pb.y - pa.y) * t
          return [
            [x - fw / 2, y],
            [x + 6, y],
            [x - fw - 6, y],
            [x - fw / 2, y - 14],
            [x - fw / 2, y + 14],
            [x + 10, y - 20],
            [x - fw - 10, y + 20],
          ] as [number, number][]
        }),
    })
  }
  for (const si of s.clusterNames) {
    const p = proj[si]!
    const size = L.community.filter((c) => c === si).length
    label(`${L.nodes[si]!.title} · ${size}`, {
      font: `600 13px ${SANS}`,
      color: colors.foreground,
      keep: false,
      at: { x: p.x, y: p.y, r: rad(si) },
    })
  }
}

/** The view that frames a set of notes: its center and a zoom that leaves room for labels. */
export function frame(
  L: Layout,
  fit: number[],
  mode: GraphMode,
): { center: [number, number, number]; zoom: number } {
  const pts = fit.map((i) => L.pos[i]!)
  const center = [0, 1, 2].map((k) => pts.reduce((t, p) => t + p[k]!, 0) / pts.length) as [
    number,
    number,
    number,
  ]
  const ds = pts
    .map((p) => Math.hypot(p[0] - center[0], p[1] - center[1], mode === '3d' ? p[2] - center[2] : 0))
    .sort((x, y) => x - y)
  const ext = ds[Math.min(ds.length - 1, Math.floor(ds.length * (pts.length > 8 ? 0.85 : 1)))] ?? 0
  // Never wider than the whole graph (zoom 1 shows every note).
  return { center, zoom: Math.max(1, Math.min(6, 0.55 / Math.max(ext, 0.02))) }
}

/**
 * The turn of the 3D view that spreads a set of notes the most on screen (the smallest distance
 * between two of them is the largest), so a lit path does not draw its notes on top of each other.
 */
export function bestYaw(L: Layout, notes: number[], pitch: number, fallback: number): number {
  if (notes.length < 2) return fallback
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  let best = fallback
  let bestScore = -1
  for (let k = 0; k < 24; k++) {
    const yaw = (k / 24) * Math.PI * 2
    const cy = Math.cos(yaw)
    const sy = Math.sin(yaw)
    const pts = notes.map((i) => {
      const [x, y, z] = L.pos[i]!
      return [x * cy - z * sy, y * cp - (x * sy + z * cy) * sp] as const
    })
    let min = Infinity
    for (let a = 0; a < pts.length; a++)
      for (let b = a + 1; b < pts.length; b++)
        min = Math.min(min, Math.hypot(pts[a]![0] - pts[b]![0], pts[a]![1] - pts[b]![1]))
    if (min > bestScore) {
      bestScore = min
      best = yaw
    }
  }
  return best
}
