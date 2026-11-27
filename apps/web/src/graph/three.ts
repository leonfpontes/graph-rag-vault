// The 3D view on Three.js, loaded only when it is shown (a chunk of its own). Flat shapes that always
// face the camera, thin links, the answer path in 2.5 px lines; no lights, glow or bloom. Labels,
// rings and citation numbers go on a 2D canvas over the scene, placed by the same rules as the 2D view.
import type { GraphView } from '@graph-rag/client'
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'

import { drawShape, START_VIEW, type GraphHandle, type GraphHandlers, type View } from './canvas'
import { layout, type Layout } from './layout'
import {
  controlBoxes,
  drawLabels,
  frame,
  readColors,
  bestYaw,
  sceneState,
  type Colors,
  type Projected,
  type SceneOptions,
} from './scene'

const FOV = 40
const BASE_DISTANCE = 3.1

function shapeTexture(type: string): Texture {
  const size = 64
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  drawShape(ctx, type, size / 2, size / 2, size * 0.36)
  ctx.fill()
  const t = new CanvasTexture(c)
  t.anisotropy = 2
  return t
}

let webgl: boolean | undefined

/**
 * True when the browser can draw WebGL (no WebGL: the 2D view). Asked once per page: each probe
 * opens a WebGL context, and browsers keep only about 16 alive, so probing on every render made the
 * 3D scene lose its own. The probe's context is released at once.
 */
export function hasWebGL(): boolean {
  if (webgl !== undefined) return webgl
  try {
    const c = document.createElement('canvas')
    const ctx = c.getContext('webgl2') ?? c.getContext('webgl')
    webgl = !!ctx
    ctx?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl = false
  }
  return webgl
}

export function mountThreeGraph(
  container: HTMLElement,
  glCanvas: HTMLCanvasElement,
  overlay: HTMLCanvasElement,
  graph: GraphView,
  initial: SceneOptions,
  handlers: GraphHandlers,
): GraphHandle {
  let o = initial
  let view: View = { ...START_VIEW }
  let colors: Colors = readColors(container)
  const L: Layout = layout(graph, '3d')
  const renderer = new WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true })
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  renderer.setClearColor(0x000000, 0)
  const scene = new Scene()
  const camera = new PerspectiveCamera(FOV, 1, 0.01, 100)
  const textures = new Map<string, Texture>()
  const tex = (type: string) => {
    if (!textures.has(type)) textures.set(type, shapeTexture(type))
    return textures.get(type)!
  }
  const sprites = L.nodes.map((n, i) => {
    const s = new Sprite(new SpriteMaterial({ map: tex(n.type), transparent: true, depthWrite: false }))
    s.position.set(...L.pos[i]!)
    scene.add(s)
    return s
  })
  const edgeGeometry = new BufferGeometry()
  const edgeMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
  const edges = new LineSegments(edgeGeometry, edgeMaterial)
  scene.add(edges)
  const pathGeometry = new LineSegmentsGeometry()
  const pathMaterial = new LineMaterial({ linewidth: 2.5, worldUnits: false, transparent: true })
  const pathLines = new LineSegments2(pathGeometry, pathMaterial)
  scene.add(pathLines)
  const octx = overlay.getContext('2d')
  let W = 0
  let H = 0
  let effectiveZoom = 1
  let proj: Projected[] = []
  const dpr = window.devicePixelRatio || 1
  let raf = 0
  let interacted = false
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const draw = () => {
    if (!W || !H) return
    const s = sceneState(L, o, W < 500)
    // Fill the canvas: with nothing framed, the cloud widens with the canvas (x and z together, so it
    // stays round as it turns); a framed set or a selection keeps true proportions.
    const stretch = s.fit.length > 1 || o.focus ? 1 : Math.min(1.8, Math.max(1, (W / Math.max(H, 1)) * 0.95))
    const P = L.pos.map(([x, y, z]): [number, number, number] => [x * stretch, y, z * stretch])
    // Where the camera looks and how close: the selection, the framed set, or the whole graph.
    let target: [number, number, number] = [0, 0, 0]
    let zoom = view.zoom
    const focus = o.focus === undefined ? undefined : L.index.get(o.focus)
    if (focus !== undefined) target = P[focus]!
    if (s.fit.length > 1) {
      const f = frame(L, s.fit, '3d')
      target = f.center
      if (!view.userZoom) zoom = f.zoom
    } else if (focus !== undefined && !view.userZoom) zoom = o.zoom ?? zoom
    effectiveZoom = zoom
    const d = BASE_DISTANCE / zoom
    const cp = Math.cos(view.pitch)
    camera.position.set(
      target[0] + d * cp * Math.sin(view.yaw),
      target[1] + d * Math.sin(view.pitch),
      target[2] + d * cp * Math.cos(view.yaw),
    )
    camera.up.set(0, 1, 0)
    camera.lookAt(...target)
    camera.updateMatrixWorld()
    // World units per screen pixel at the target's distance: notes keep their pixel size.
    const perPixel = (2 * d * Math.tan((FOV * Math.PI) / 360)) / H
    const v = new Vector3()
    sprites.forEach((sp, i) => sp.position.set(...P[i]!))
    proj = P.map((p) => {
      v.set(...p).project(camera)
      const dist = camera.position.distanceTo(new Vector3(...p))
      return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, z: dist, k: d / dist }
    })
    const px = (i: number) =>
      (3 + Math.sqrt(L.degree[i]!) * 1.05) * (zoom > 1 ? Math.min(2, Math.sqrt(zoom)) : 1)
    L.nodes.forEach((n, i) => {
      const sprite = sprites[i]!
      sprite.visible = s.visible(i)
      const m = sprite.material
      m.opacity = s.alpha(i)
      m.color = new Color(o.path && !s.lit(i) ? colors.edge : (colors.type[n.type] ?? colors.type.document!))
      const size = px(i) * 2.6 * perPixel
      sprite.scale.set(size, size, 1)
      sprite.renderOrder = 2
    })
    const pos: number[] = []
    const col: number[] = []
    const edge = new Color(colors.edge)
    for (const [a, b, rel] of L.edges) {
      if (!s.edgeVisible(a, b, rel)) continue
      const al = s.edgeAlpha(a, b)
      pos.push(...P[a]!, ...P[b]!)
      col.push(edge.r, edge.g, edge.b, al, edge.r, edge.g, edge.b, al)
    }
    edgeGeometry.setAttribute('position', new Float32BufferAttribute(pos, 3))
    edgeGeometry.setAttribute('color', new Float32BufferAttribute(col, 4))
    edgeGeometry.computeBoundingSphere()
    const pp: number[] = []
    for (const [a, b] of s.pathEdges) pp.push(...P[a]!, ...P[b]!)
    pathLines.visible = pp.length > 0
    if (pp.length) {
      pathGeometry.setPositions(pp)
      pathMaterial.color = new Color(colors.evidence)
      pathMaterial.resolution.set(W, H)
    }
    renderer.render(scene, camera)
    if (!octx) return
    octx.setTransform(dpr, 0, 0, dpr, 0, 0)
    octx.clearRect(0, 0, W, H)
    const rad = (i: number) => px(i) * proj[i]!.k
    for (let i = 0; i < L.nodes.length; i++) {
      const ring = s.ring(i)
      if (!ring || !s.visible(i)) continue
      const q = proj[i]!
      octx.lineWidth = 2
      octx.strokeStyle = ring === 'focus' ? colors.foreground : colors.evidence
      octx.beginPath()
      octx.arc(q.x, q.y, rad(i) + 4.5, 0, Math.PI * 2)
      octx.stroke()
    }
    drawLabels(octx, L, o, s, proj, rad, W, H, controlBoxes(container), colors)
  }

  const resize = () => {
    // The inside of the box (no border): the canvas sits in it, absolutely, at inset 0.
    W = container.clientWidth || container.getBoundingClientRect().width
    H = container.clientHeight || container.getBoundingClientRect().height
    renderer.setSize(W, H, false)
    glCanvas.style.width = `${W}px`
    glCanvas.style.height = `${H}px`
    overlay.width = Math.round(W * dpr)
    overlay.height = Math.round(H * dpr)
    overlay.style.width = `${W}px`
    overlay.style.height = `${H}px`
    camera.aspect = W / Math.max(H, 1)
    camera.updateProjectionMatrix()
    draw()
  }
  // A lit path turns to the angle that spreads its notes the most.
  const pathYaw = (yaw: number) => {
    if (!o.path) return yaw
    const ids = o.path.notes.map((id) => L.index.get(id)).filter((i): i is number => i !== undefined)
    // The camera's right is (cos yaw, 0, −sin yaw): the same screen axes as the canvas, so the same angle.
    return bestYaw(L, ids, view.pitch, yaw)
  }
  view.yaw = pathYaw(view.yaw)
  const ro = new ResizeObserver(resize)
  ro.observe(container)
  resize()
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
    if (!interacted && o.rotate) {
      view.yaw += 0.0025
      draw()
    }
    raf = requestAnimationFrame(tick)
  }
  if (!still) raf = requestAnimationFrame(tick)

  let drag: { x: number; y: number; view: View; moved: boolean } | null = null
  const onDown = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, view: { ...view }, moved: false }
    overlay.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: PointerEvent) => {
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      drag.moved = true
      interact()
    }
    if (!drag.moved) return
    view = {
      ...view,
      yaw: drag.view.yaw - dx * 0.008,
      pitch: Math.max(-1.2, Math.min(1.2, drag.view.pitch + dy * 0.008)),
    }
    draw()
  }
  const onUp = (e: PointerEvent) => {
    const d = drag
    drag = null
    if (!d || d.moved) return
    const r = overlay.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
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
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)
  }
  overlay.addEventListener('pointerdown', onDown)
  overlay.addEventListener('pointermove', onMove)
  overlay.addEventListener('pointerup', onUp)
  overlay.addEventListener('wheel', onWheel, { passive: false })
  void document.fonts?.ready.then(draw)

  return {
    set(next) {
      const reframe = next.focus !== o.focus || next.cluster !== o.cluster || next.path !== o.path
      o = next
      if (reframe) view = { ...view, userZoom: false, zoom: 1, yaw: pathYaw(view.yaw) }
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
      overlay.removeEventListener('pointerdown', onDown)
      overlay.removeEventListener('pointermove', onMove)
      overlay.removeEventListener('pointerup', onUp)
      overlay.removeEventListener('wheel', onWheel)
      for (const s of sprites) s.material.dispose()
      for (const t of textures.values()) t.dispose()
      edgeGeometry.dispose()
      edgeMaterial.dispose()
      pathGeometry.dispose()
      pathMaterial.dispose()
      renderer.dispose()
    },
  }
}
