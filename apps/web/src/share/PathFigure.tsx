// The links an answer walked, drawn for the landing hero and the share images (docs/DESIGN.md,
// Share images): only the lit links, in --evidence, each with its link type written along it; every
// note in its type's shape and color with a short name; the cited notes with an evidence ring and
// their citation number right before the name. Units: a 600 × 380 viewBox, text 26 units (26 px in
// the 1280 social preview, so ≥ 11 px at 600 px).
import { isNoteType, SHAPE_PATH } from '../lib/notes'
import { layoutPath, PATH_H, PATH_W, type FeaturedNode, type PlacedNode } from '../lib/share'
import type { PathEdge } from '../lib/answer-path'

const TEXT = 26
/** IBM Plex Sans 500, average advance per character at 26 units (measured on the names of the vault). */
const CHAR = 14.2
const NODE = 34
const RING = 24
const BADGE = 30
const GAP = 8

const nameWidth = (s: string) => s.length * CHAR

/** Where a label starts, so it stays inside the drawing. */
function labelX(n: PlacedNode, width: number): number {
  const x = n.anchor === 'start' ? n.x - 30 : n.anchor === 'end' ? n.x + 30 - width : n.x - width / 2
  return Math.min(Math.max(x, 4), PATH_W - 4 - width)
}

export function PathFigure({
  nodes,
  edges,
  className,
  lit = edges.length,
}: {
  nodes: readonly FeaturedNode[]
  edges: readonly PathEdge[]
  className?: string
  /** How many links are lit, in path order (the demo video lights them one by one); the rest wait in gray. */
  lit?: number
}) {
  const placed = layoutPath(nodes, edges)
  const at = new Map(placed.map((n) => [n.id, n]))
  const litNodes = new Set(edges.slice(0, lit).flatMap((e) => [e.from, e.to]))
  return (
    <svg
      viewBox={`0 0 ${PATH_W} ${PATH_H}`}
      className={className}
      aria-hidden="true"
      data-path-figure=""
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      {edges.map((e, i) => {
        const on = i < lit
        const a = at.get(e.from)
        const b = at.get(e.to)
        if (!a || !b) return null
        // Text reads left to right: draw from the left note.
        const [p, q] = a.x <= b.x ? [a, b] : [b, a]
        const angle = Math.atan2(q.y - p.y, q.x - p.x)
        const deg = (angle * 180) / Math.PI
        const mx = (p.x + q.x) / 2
        const my = (p.y + q.y) / 2
        // 16 units off the link, on its upper side.
        const off = -16
        const tx = mx - Math.sin(angle) * off
        const ty = my + Math.cos(angle) * off
        return (
          <g key={`${e.from}|${e.to}|${e.relation}`} data-edge={e.relation}>
            <line
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              stroke={on ? 'var(--evidence)' : 'var(--edge)'}
              strokeWidth={on ? 4 : 2}
            />
            <text
              opacity={on ? 1 : 0}
              x={tx.toFixed(1)}
              y={ty.toFixed(1)}
              textAnchor="middle"
              transform={`rotate(${deg.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})`}
              style={{
                font: `500 ${TEXT}px var(--font-mono)`,
                fill: 'var(--evidence)',
                paintOrder: 'stroke',
                stroke: 'var(--canvas)',
                strokeWidth: 8,
                strokeLinejoin: 'round',
              }}
            >
              {e.relation}
            </text>
          </g>
        )
      })}
      {placed.map((n) => {
        const type = isNoteType(n.type) ? n.type : 'document'
        // The name keeps its place whether the number shows yet or not.
        const width = nameWidth(n.short) + (n.cite ? BADGE + GAP : 0)
        const x0 = labelX(n, width)
        const baseline = n.labelSide === 'below' ? n.y + RING + 12 + TEXT : n.y - RING - 14
        const cite = litNodes.has(n.id) ? n.cite : undefined
        return (
          <g key={n.id} data-node={n.id}>
            <path
              d={SHAPE_PATH[type]}
              fill={`var(--t-${type})`}
              transform={`translate(${n.x - NODE / 2} ${n.y - NODE / 2}) scale(${NODE / 16})`}
            />
            {cite && (
              <circle cx={n.x} cy={n.y} r={RING} fill="none" stroke="var(--evidence)" strokeWidth={3} />
            )}
            {cite && (
              <g data-cite={cite}>
                <rect
                  x={x0}
                  y={baseline - TEXT + 1}
                  width={BADGE}
                  height={BADGE}
                  rx={4}
                  fill="var(--evidence)"
                />
                <text
                  x={x0 + BADGE / 2}
                  y={baseline}
                  textAnchor="middle"
                  style={{ font: `600 ${TEXT}px var(--font-mono)`, fill: 'var(--evidence-foreground)' }}
                >
                  {cite}
                </text>
              </g>
            )}
            <text
              x={x0 + (n.cite ? BADGE + GAP : 0)}
              y={baseline}
              style={{
                font: `500 ${TEXT}px var(--font-sans)`,
                fill: 'var(--foreground)',
                paintOrder: 'stroke',
                stroke: 'var(--canvas)',
                strokeWidth: 8,
                strokeLinejoin: 'round',
              }}
            >
              {n.short}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** The same path as text, for screen readers and for reading: "Velo Lund —owner→ Sana Orr". */
export function pathText(nodes: readonly FeaturedNode[], edges: readonly PathEdge[]): string[] {
  const title = new Map(nodes.map((n) => [n.id, n.title]))
  return edges.map((e) => `${title.get(e.from) ?? e.from} ${e.relation} ${title.get(e.to) ?? e.to}`)
}
