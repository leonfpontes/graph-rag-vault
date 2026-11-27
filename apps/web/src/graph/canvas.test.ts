// The 2D canvas renderer with a recording context: jsdom has no canvas, so the test counts what is
// drawn and drives the pointer by hand.
import { createVault } from '@graph-rag/client'
import { decodeIndex } from '@graph-rag/search'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { answerPath } from '../lib/answer-path'
import { INDEX_BYTES } from '../test/demo'
import { mountCanvasGraph, project, START_VIEW } from './canvas'
import { layout } from './layout'
import { sceneState } from './scene'

const index = decodeIndex(INDEX_BYTES)
const graph = createVault(index).graph()

function recordingContext() {
  const calls: Record<string, number> = {}
  const texts: string[] = []
  const ctx = new Proxy(
    {},
    {
      get(_t, key: string) {
        if (key === 'measureText') return (t: string) => ({ width: t.length * 6 })
        if (key === 'fillText') return (t: string) => texts.push(t)
        return (..._args: unknown[]) => {
          calls[key] = (calls[key] ?? 0) + 1
        }
      },
      set: () => true,
    },
  )
  return { ctx: ctx as CanvasRenderingContext2D, calls, texts }
}

function mount(options: Parameters<typeof mountCanvasGraph>[3], handlers = {}) {
  const container = document.createElement('div')
  const canvas = document.createElement('canvas')
  container.append(canvas)
  document.body.append(container)
  const rec = recordingContext()
  canvas.getContext = (() => rec.ctx) as unknown as typeof canvas.getContext
  const rect = {
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }
  container.getBoundingClientRect = () => rect as DOMRect
  canvas.getBoundingClientRect = () => rect as DOMRect
  const handle = mountCanvasGraph(container, canvas, graph, options, handlers)
  return { handle, canvas, ...rec }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the 2D canvas', () => {
  it('draws every note, names the biggest constellations, and selects the nearest note on a click', () => {
    const onSelect = vi.fn()
    const { canvas, calls, texts, handle } = mount({ mode: '2d' }, { onSelect })
    expect(calls.fill).toBeGreaterThanOrEqual(graph.nodes.length)
    expect(texts.some((t) => / · \d+$/.test(t))).toBe(true)
    const L = layout(graph, '2d')
    const s = sceneState(L, { mode: '2d' }, false)
    const { proj } = project(L, { mode: '2d' }, s.fit, START_VIEW, 800, 600)
    const target = proj[L.index.get('dec-switch-battery-voltaro')!]!
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: target.x, clientY: target.y }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: target.x, clientY: target.y }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    handle.zoom(1.2)
    handle.reset()
    handle.destroy()
  })

  it('lights an answer path with the type written on each link, and rings the cited notes with their number', () => {
    const path = answerPath(
      index,
      [
        {
          noteId: 'dec-switch-battery-voltaro',
          score: 1,
          reasons: [
            {
              kind: 'link',
              from: 'mtg-2026-10-02-supply-review',
              relation: 'decided_in',
              direction: 'in',
              hops: 1,
            },
          ],
        },
        { noteId: 'mtg-2026-10-02-supply-review', score: 0.5, reasons: [] },
      ],
      [{ noteId: 'dec-switch-battery-voltaro', chunkId: 'dec-switch-battery-voltaro#0', quote: 'x' }],
    )
    const { texts } = mount({ mode: '3d', path, clusterLabels: false })
    expect(texts).toContain('decided_in')
    expect(texts).toContain('1')
    expect(texts.some((t) => t.startsWith('Switch Ridgeline battery'))).toBe(true)
  })

  it('draws the phone map, one bubble per constellation, and opens one on a tap', () => {
    const onCluster = vi.fn()
    const { canvas, texts } = mount({ mode: '2d', summary: true }, { onCluster })
    const projects = graph.nodes.filter((n) => n.type === 'project').length
    // Each bubble writes its count and its name.
    expect(texts.length).toBe(projects * 2)
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 64 + 30 }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 64 + 30 }))
    expect(onCluster).toHaveBeenCalledWith(expect.stringMatching(/^prj-/))
  })

  it('pans in 2D and zooms with the wheel, and stops the slow turn at the first interaction', () => {
    const onInteract = vi.fn()
    const { canvas } = mount({ mode: '2d' }, { onInteract })
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 40 }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 60, clientY: 40 }))
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, cancelable: true }))
    expect(onInteract).toHaveBeenCalledTimes(1)
  })
})
