// The graph on a 2D canvas: the 2D view (phones, no WebGL, the Note page), the phone map of
// constellations, and the 3D view's stand-in while Three.js loads (the same projection, drawn flat).
// Drag pans in 2D and orbits in 3D, the wheel zooms, a click selects the nearest note.
import type { GraphView } from '@graph-rag/client'

import { constellations, layout, type Layout } from './layout'
import {
  controlBoxes,
  drawLabels,
  frame,
  radius,
  readColors,
  bestYaw,
  sceneState,
  type Colors,
  type Projected,
  type SceneOptions,
} from './scene'

export interface GraphHandlers {
  onSelect?: (id: string) => void
  onCluster?: (projectId: string) => void
  /** The first drag, wheel or zoom: the slow turn stops for good. */
  onInteract?: () => void
}

export interface GraphHandle {
  set(options: SceneOptions): void
  zoom(factor: number): void
  reset(): void
  destroy(): void
}

/** Draws a note type's shape (the same shapes as the legend). */
export function drawShape(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, r: number) {
  ctx.beginPath()
  if (type === 'person') ctx.arc(x, y, r, 0, Math.PI * 2)
  else if (type === 'project') {
    const a = r * 0.9
    ctx.roundRect(x - a, y - a, a * 2, a * 2, r * 0.25)
  } else if (type === 'decision') {
    const a = r * 1.2
    ctx.moveTo(x, y - a)
    ctx.lineTo(x + a, y)
    ctx.lineTo(x, y + a)
    ctx.lineTo(x - a, y)
    ctx.closePath()
  } else if (type === 'meeting') {
    const a = r * 1.25
    ctx.moveTo(x, y - a)
    ctx.lineTo(x + a * 0.95, y + a * 0.7)
    ctx.lineTo(x - a * 0.95, y + a * 0.7)
    ctx.closePath()
  } else if (type === 'customer') {
    for (let k = 0; k < 6; k++) {
      const an = (Math.PI / 3) * k - Math.PI / 2
      const px = x + Math.cos(an) * r * 1.1
      const py = y + Math.sin(an) * r * 1.1
      if (k) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
    }
    ctx.closePath()
  } else {
    const w = r * 0.8
    const h = r * 1.1
    ctx.moveTo(x - w, y - h)
    ctx.lineTo(x + w * 0.35, y - h)
    ctx.lineTo(x + w, y - h * 0.45)
    ctx.lineTo(x + w, y + h)
    ctx.lineTo(x - w, y + h)
    ctx.closePath()
  }
}

export interface View {
  yaw: number
  pitch: number
  zoom: number
  /** Pan in 2D, in screen pixels. */
  panX: number
  panY: number
  userZoom: boolean
}

export const START_VIEW: View = { yaw: 0.6, pitch: 0.35, zoom: 1, panX: 0, panY: 0, userZoom: false }

/** Screen positions of every note for a view (the canvas and the 3D stand-in share it). */
export function project(L: Layout, o: SceneOptions, fit: number[], view: View, W: number, H: number) {
  let zoom = view.zoom
  let c0: [number, number, number] = [0, 0, 0]
  const focus = o.focus === undefined ? undefined : L.index.get(o.focus)
  if (focus !== undefined) c0 = L.pos[focus]!
  // A framed set keeps its center when the person zooms; only the zoom becomes theirs.
  const framed = fit.length > 1
  if (framed) {
    const f = frame(L, fit, o.mode)
    c0 = f.center
    if (!view.userZoom) zoom = f.zoom
  } else if (focus !== undefined && !view.userZoom) zoom = o.zoom ?? zoom
  const Rx = W * 0.45 * zoom
  const Ry = H * 0.43 * zoom
  const R = Math.min(Rx, Ry)
  const sx = framed ? R : Rx
  const sy = framed ? R : Ry
  const cy = Math.cos(view.yaw)
  const syaw = Math.sin(view.yaw)
  const cp = Math.cos(view.pitch)
  const sp = Math.sin(view.pitch)
  const proj: Projected[] = L.pos.map(([x0, y0, z0]) => {
    const x = x0 - c0[0]
    const y = y0 - c0[1]
    const z = z0 - c0[2]
    if (o.mode === '2d') return { x: W / 2 + view.panX + x * sx, y: H / 2 + view.panY + y * sy, z: 0, k: 1 }
    const x1 = x * cy - z * syaw
    const z1 = x * syaw + z * cy
    const y1 = y * cp - z1 * sp
    const z2 = y * sp + z1 * cp
    const k = 2.6 / (2.6 + z2)
    return { x: W / 2 + x1 * sx * k, y: H / 2 + y1 * sy * k, z: z2, k }
  })
  return { proj, zoom }
}

interface Bubble {
  seed: number
  count: number
  cx: number
  cy: number
  r: number
}

export function mountCanvasGraph(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  graph: GraphView,
  initial: SceneOptions,
  handlers: GraphHandlers,
): GraphHandle {
  const ctx = canvas.getContext('2d')
  let o = initial
  let view: View = { ...START_VIEW }
  let W = 0
  let H = 0
  const dpr = window.devicePixelRatio || 1
  let colors: Colors = readColors(container)
  let proj: Projected[] = []
  let L = layout(graph, o.mode)
  let bubbles: Bubble[] = []
  let raf = 0
  let interacted = false
  let effectiveZoom = 1
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const drawSummary = () => {
    if (!ctx) return
    const L2 = layout(graph, '2d')
    const groups = constellations(L2)
    const top = 64
    const cols = W < 500 ? 3 : 4
    const rows = Math.ceil(groups.length / cols)
    const cw = W / cols
    const ch = (H - top - 8) / Math.max(rows, 1)
    const max = groups[0]?.members.length ?? 1
    bubbles = groups.map(({ seed, members }, k) => ({
      seed,
      count: members.length,
      cx: cw * (k % cols) + cw / 2,
      cy: top + ch * Math.floor(k / cols) + ch * 0.4,
      r: Math.max(12, Math.min(cw, ch) * 0.3 * Math.sqrt(members.length / max)),
    }))
    for (const { seed, count, cx, cy, r } of bubbles) {
      ctx.globalAlpha = 0.16
      ctx.fillStyle = colors.type.project!
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = colors.type.project!
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = colors.foreground
      ctx.font = '600 13px "IBM Plex Mono", ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(count), cx, cy)
      ctx.font = '500 12px "IBM Plex Sans", system-ui, sans-serif'
      const title = L2.nodes[seed]!.title
      let t = title
      while (ctx.measureText(t).width > cw - 10 && t.length > 4) t = t.slice(0, -2)
      if (t !== title) t = `${t.trimEnd()}…`
      ctx.fillText(t, cx, cy + r + 12)
    }
    ctx.textAlign = 'left'
  }

  const draw = () => {
    if (!ctx || !W) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    if (o.summary) return drawSummary()
    L = layout(graph, o.mode)
    const s = sceneState(L, o, W < 500)
    const p = project(L, o, s.fit, view, W, H)
    proj = p.proj
    effectiveZoom = p.zoom
    const rad = (i: number) => radius(L, i, proj[i]!, p.zoom)
    for (const [a, b, rel] of L.edges) {
      if (!s.edgeVisible(a, b, rel)) continue
      ctx.strokeStyle = colors.edge
      ctx.lineWidth = 1
      const depth = o.mode === '3d' ? 0.6 + 0.4 * Math.min(proj[a]!.k, proj[b]!.k) : 1
      ctx.globalAlpha = s.edgeAlpha(a, b) * (o.path || o.focus || o.cluster ? 1 : depth)
      ctx.beginPath()
      ctx.moveTo(proj[a]!.x, proj[a]!.y)
      ctx.lineTo(proj[b]!.x, proj[b]!.y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    for (const [a, b] of s.pathEdges) {
      ctx.strokeStyle = colors.evidence
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(proj[a]!.x, proj[a]!.y)
      ctx.lineTo(proj[b]!.x, proj[b]!.y)
      ctx.stroke()
    }
    const order = L.nodes.map((_, i) => i).sort((i, j) => proj[j]!.z - proj[i]!.z)
    for (const i of order) {
      if (!s.visible(i)) continue
      const n = L.nodes[i]!
      const q = proj[i]!
      const r = rad(i)
      ctx.globalAlpha = s.alpha(i)
      ctx.fillStyle = o.path && !s.lit(i) ? colors.edge : (colors.type[n.type] ?? colors.type.document!)
      drawShape(ctx, n.type, q.x, q.y, r)
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = colors.canvas
      ctx.stroke()
      const ring = s.ring(i)
      if (ring) {
        ctx.globalAlpha = 1
        ctx.lineWidth = 2
        ctx.strokeStyle = ring === 'focus' ? colors.foreground : colors.evidence
        ctx.beginPath()
        ctx.arc(q.x, q.y, r + 4.5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    drawLabels(ctx, L, o, s, proj, rad, W, H, controlBoxes(container), colors)
  }

  const resize = () => {
    // The inside of the box (no border): the canvas sits in it, absolutely, at inset 0.
    W = container.clientWidth || container.getBoundingClientRect().width
    H = container.clientHeight || container.getBoundingClientRect().height
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    draw()
  }
  // A lit path turns to the angle that spreads its notes the most.
  const pathYaw = (yaw: number) => {
    if (!o.path || o.mode !== '3d') return yaw
    const L3 = layout(graph, '3d')
    const ids = o.path.notes.map((id) => L3.index.get(id)).filter((i): i is number => i !== undefined)
    return bestYaw(L3, ids, view.pitch, yaw)
  }
  view.yaw = pathYaw(view.yaw)
  const ro = new ResizeObserver(resize)
  ro.observe(container)
  resize()

  // The theme changes the colors: read them again when the root's class changes.
  const mo = new MutationObserver(() => {
    colors = readColors(container)
    draw()
  })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  const interact = () => {
    if (interacted) return
    interacted = true
    handlers.onInteract?.()
  }
  const tick = () => {
    if (!interacted && o.rotate && o.mode === '3d' && !o.summary) {
      view.yaw += 0.0025
      draw()
    }
    raf = requestAnimationFrame(tick)
  }
  if (!still) raf = requestAnimationFrame(tick)

  let drag: { x: number; y: number; view: View; moved: boolean } | null = null
  const onDown = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, view: { ...view }, moved: false }
    canvas.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: PointerEvent) => {
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      drag.moved = true
      interact()
    }
    if (!drag.moved || o.summary) return
    if (o.mode === '3d')
      view = {
        ...view,
        yaw: drag.view.yaw + dx * 0.008,
        pitch: Math.max(-1.2, Math.min(1.2, drag.view.pitch + dy * 0.008)),
      }
    else view = { ...view, panX: drag.view.panX + dx, panY: drag.view.panY + dy }
    draw()
  }
  const onUp = (e: PointerEvent) => {
    const d = drag
    drag = null
    if (!d || d.moved) return
    const r = canvas.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    if (o.summary) {
      const b = bubbles.find((q) => Math.hypot(q.cx - x, q.cy - y) < Math.max(q.r, 22))
      if (b) handlers.onCluster?.(layout(graph, '2d').nodes[b.seed]!.id)
      return
    }
    const s = sceneState(L, o, W < 500)
    let best = -1
    let bd = 14
    proj.forEach((p, i) => {
      if (!s.visible(i)) return
      const dd = Math.hypot(p.x - x, p.y - y)
      if (dd < bd) {
        bd = dd
        best = i
      }
    })
    if (best >= 0) handlers.onSelect?.(L.nodes[best]!.id)
  }
  const zoomBy = (f: number) => {
    interact()
    view = { ...view, userZoom: true, zoom: Math.max(0.6, Math.min(6, effectiveZoom * f)) }
    draw()
  }
  const onWheel = (e: WheelEvent) => {
    if (o.summary) return
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  void document.fonts?.ready.then(draw)

  return {
    set(next) {
      const reframe =
        next.focus !== o.focus || next.cluster !== o.cluster || next.path !== o.path || next.mode !== o.mode
      o = next
      if (reframe) view = { ...view, userZoom: false, zoom: 1, panX: 0, panY: 0, yaw: pathYaw(view.yaw) }
      draw()
    },
    zoom: zoomBy,
    reset() {
      view = { ...START_VIEW }
      draw()
    },
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    },
  }
}
