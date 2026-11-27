// The graph's layout, the same for every visit (a fixed seed): every note joins its nearest project
// (breadth-first over the links), the projects spread on a sphere (a circle in 2D) and a short force
// simulation gathers each constellation around its project. Plain math, no DOM: the 2D canvas, the
// 3D scene and the List view all read it (docs/DESIGN.md, Graph).
import type { GraphView } from '@graph-rag/client'

export type GraphMode = '2d' | '3d'

export interface Layout {
  nodes: GraphView['nodes']
  /** Index pairs of the links, with the relation. */
  edges: [number, number, string][]
  /** Unit-scaled positions (95% of the notes inside radius 1). z is 0 in 2D. */
  pos: [number, number, number][]
  degree: number[]
  index: Map<string, number>
  adj: number[][]
  /** The project (node index) each note gathers around, or -1 when no link reaches one. */
  community: number[]
  /** The project nodes. */
  seeds: number[]
}

const cache = new WeakMap<GraphView, Partial<Record<GraphMode, Layout>>>()

export function layout(graph: GraphView, mode: GraphMode): Layout {
  const cached = cache.get(graph)?.[mode]
  if (cached) return cached
  let s = 11
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5
  const N = graph.nodes
  const index = new Map(N.map((n, i) => [n.id, i]))
  const edges: Layout['edges'] = []
  for (const l of graph.links) {
    const a = index.get(l.from)
    const b = index.get(l.to)
    if (a !== undefined && b !== undefined) edges.push([a, b, l.relation])
  }
  const adj: number[][] = N.map(() => [])
  for (const [a, b] of edges) {
    adj[a]!.push(b)
    adj[b]!.push(a)
  }
  const degree = adj.map((x) => x.length)
  const seeds = N.flatMap((n, i) => (n.type === 'project' ? [i] : []))
  const community = new Array<number>(N.length).fill(-1)
  let queue = [...seeds]
  for (const i of seeds) community[i] = i
  while (queue.length) {
    const next: number[] = []
    for (const i of queue)
      for (const j of adj[i]!)
        if (community[j]! < 0) {
          community[j] = community[i]!
          next.push(j)
        }
    queue = next
  }
  const anchor = new Map<number, [number, number, number]>()
  seeds.forEach((si, k) => {
    if (mode === '3d') {
      const y = 1 - (2 * (k + 0.5)) / seeds.length
      const r = Math.sqrt(1 - y * y)
      const th = k * 2.39996
      anchor.set(si, [Math.cos(th) * r, y, Math.sin(th) * r])
    } else {
      const a = (k / seeds.length) * Math.PI * 2
      const r = 0.55 + 0.35 * (k % 2)
      anchor.set(si, [Math.cos(a) * r, Math.sin(a) * r, 0])
    }
  })
  const home = (i: number) => anchor.get(community[i]!) ?? ([0, 0, 0] as [number, number, number])
  const pos: [number, number, number][] = N.map((_, i) => {
    const h = home(i)
    return [h[0] + rnd() * 0.3, h[1] + rnd() * 0.3, mode === '3d' ? h[2] + rnd() * 0.3 : 0]
  })
  const dims = mode === '3d' ? 3 : 2
  for (let it = 0; it < 240; it++) {
    const F = pos.map((): [number, number, number] => [0, 0, 0])
    const t = 0.05 * (1 - it / 280)
    for (let i = 0; i < pos.length; i++)
      for (let j = i + 1; j < pos.length; j++) {
        const dx = pos[i]![0] - pos[j]![0]
        const dy = pos[i]![1] - pos[j]![1]
        const dz = pos[i]![2] - pos[j]![2]
        const f = 0.004 / (dx * dx + dy * dy + dz * dz + 0.004)
        F[i]![0] += dx * f
        F[i]![1] += dy * f
        F[i]![2] += dz * f
        F[j]![0] -= dx * f
        F[j]![1] -= dy * f
        F[j]![2] -= dz * f
      }
    for (const [a, b] of edges) {
      const same = community[a] === community[b]
      const d = [0, 1, 2].map((k) => pos[b]![k]! - pos[a]![k]!)
      const r = Math.hypot(d[0]!, d[1]!, d[2]!) + 1e-6
      const f = (r - 0.1) * (same ? 0.4 : 0.05)
      for (let k = 0; k < 3; k++) {
        F[a]![k]! += (d[k]! / r) * f
        F[b]![k]! -= (d[k]! / r) * f
      }
    }
    for (let i = 0; i < pos.length; i++) {
      const h = home(i)
      for (let k = 0; k < dims; k++) {
        F[i]![k]! += (h[k]! - pos[i]![k]!) * 0.08
        pos[i]![k]! += Math.max(-t, Math.min(t, F[i]![k]!))
      }
    }
  }
  const radii = pos.map((p) => Math.hypot(...p)).sort((a, b) => a - b)
  const R = radii[Math.floor(radii.length * 0.95)] || 1
  for (const p of pos) for (let k = 0; k < 3; k++) p[k]! /= R
  const result: Layout = { nodes: N, edges, pos, degree, index, adj, community, seeds }
  cache.set(graph, { ...cache.get(graph), [mode]: result })
  return result
}

/** The constellations, biggest first: the project and its notes. */
export function constellations(L: Layout): { seed: number; members: number[] }[] {
  return L.seeds
    .map((seed) => ({ seed, members: L.nodes.flatMap((_, i) => (L.community[i] === seed ? [i] : [])) }))
    .sort(
      (a, b) =>
        b.members.length - a.members.length || L.nodes[a.seed]!.title.localeCompare(L.nodes[b.seed]!.title),
    )
}

/** Notes within 2 hops of a note: hop count by node index. */
export function hops(L: Layout, id: string | undefined, max = 2): Map<number, number> {
  const d = new Map<number, number>()
  const start = id === undefined ? undefined : L.index.get(id)
  if (start === undefined) return d
  d.set(start, 0)
  let q = [start]
  for (let h = 1; h <= max; h++) {
    const next: number[] = []
    for (const i of q)
      for (const j of L.adj[i]!)
        if (!d.has(j)) {
          d.set(j, h)
          next.push(j)
        }
    q = next
  }
  return d
}
