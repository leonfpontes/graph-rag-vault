// The graph as a React component. 3D uses Three.js, loaded on demand; while it loads, and without
// WebGL, the same projection is drawn on a 2D canvas. 2D and the phone map always use the canvas.
// The canvas is an image with a text label that names the selection and points to the List view.
import type { GraphView } from '@graph-rag/client'
import { cn } from '@leonfpontes/atlas-ui'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { mountCanvasGraph, type GraphHandle, type GraphHandlers } from './canvas'
import type * as ThreeScene from './three'
import type { SceneOptions } from './scene'

type ThreeModule = typeof ThreeScene
let threeLoad: Promise<ThreeModule> | undefined
const loadThree = () => (threeLoad ??= import('./three'))

export interface GraphCanvasProps extends GraphHandlers {
  graph: GraphView
  options: SceneOptions
  /** What the image shows, for screen readers. */
  label: string
  /** `full`: zoom in, zoom out and reset. `reset`: reset only (phones zoom by pinch). */
  zoomControls?: 'full' | 'reset' | false
  className?: string
  /** Controls drawn over the canvas (mark them `data-graph-control`: labels keep out of them). */
  children?: ReactNode
}

export function GraphCanvas({
  graph,
  options,
  label,
  zoomControls = 'full',
  className,
  children,
  onSelect,
  onCluster,
  onInteract,
}: GraphCanvasProps) {
  const box = useRef<HTMLDivElement>(null)
  const flat = useRef<HTMLCanvasElement>(null)
  const gl = useRef<HTMLCanvasElement>(null)
  const handle = useRef<GraphHandle | null>(null)
  const handlers = useRef<GraphHandlers>({})
  handlers.current = { onSelect, onCluster, onInteract }
  const optionsRef = useRef(options)
  optionsRef.current = options
  const wants3d = options.mode === '3d' && !options.summary
  const [three, setThree] = useState<ThreeModule | null>(null)
  // hasWebGL() asks the browser once per page (each probe opens a WebGL context).
  const use3d = wants3d && !!three && three.hasWebGL()

  useEffect(() => {
    if (!wants3d) return
    let live = true
    loadThree().then(
      (m) => live && setThree(m),
      () => {}, // no chunk (offline): the canvas keeps drawing the 3D projection
    )
    return () => {
      live = false
    }
  }, [wants3d])

  useEffect(() => {
    const container = box.current
    const canvas = flat.current
    if (!container || !canvas) return
    const relay: GraphHandlers = {
      onSelect: (id) => handlers.current.onSelect?.(id),
      onCluster: (id) => handlers.current.onCluster?.(id),
      onInteract: () => handlers.current.onInteract?.(),
    }
    let h: GraphHandle
    try {
      h =
        use3d && three && gl.current
          ? three.mountThreeGraph(container, gl.current, canvas, graph, optionsRef.current, relay)
          : mountCanvasGraph(container, canvas, graph, optionsRef.current, relay)
    } catch {
      // WebGL refused (context lost, blocked): the canvas draws it.
      h = mountCanvasGraph(container, canvas, graph, optionsRef.current, relay)
    }
    handle.current = h
    return () => {
      h.destroy()
      handle.current = null
    }
  }, [graph, use3d, three])

  useEffect(() => {
    handle.current?.set(options)
  }, [options])

  return (
    <div
      ref={box}
      className={cn('relative min-w-0 overflow-hidden rounded-lg border bg-(--canvas)', className)}
    >
      {use3d && <canvas ref={gl} aria-hidden="true" className="absolute inset-0 block" />}
      <canvas
        ref={flat}
        role="img"
        aria-label={label}
        className="absolute inset-0 block cursor-grab touch-none"
        data-renderer={use3d ? 'three' : 'canvas'}
      />
      {children}
      {zoomControls && (
        <div
          data-graph-control
          className="absolute right-3 bottom-3 grid overflow-hidden rounded-md border bg-background"
        >
          {zoomControls === 'full' && (
            <>
              <ZoomButton label="Zoom in" onClick={() => handle.current?.zoom(1.2)}>
                <Plus />
              </ZoomButton>
              <ZoomButton label="Zoom out" onClick={() => handle.current?.zoom(1 / 1.2)}>
                <Minus />
              </ZoomButton>
            </>
          )}
          <ZoomButton label="Reset view" onClick={() => handle.current?.reset()}>
            <RotateCcw />
          </ZoomButton>
        </div>
      )}
    </div>
  )
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-10 cursor-pointer place-items-center text-foreground outline-none not-first:border-t hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset pointer-coarse:size-11 [&_svg]:size-4"
    >
      {children}
    </button>
  )
}
