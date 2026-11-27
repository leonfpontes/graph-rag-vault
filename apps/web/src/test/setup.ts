// jsdom lacks a few browser APIs the app and Radix use.
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// findBy… waits up to 5 s (1 s by default): pages load their data asynchronously.
configure({ asyncUtilTimeout: 5000 })

const desktop = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList
// Desktop by default; a test can switch to a phone (render.tsx, asPhone), and the next test starts over.
window.matchMedia = desktop

if (!('ResizeObserver' in window))
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

// jsdom draws nothing: the graph's canvas gets no context (and jsdom would log "not implemented").
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

Element.prototype.scrollIntoView ??= function () {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}
window.scrollTo = () => {}

afterEach(() => {
  cleanup()
  window.matchMedia = desktop
  document.documentElement.classList.remove('dark')
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})
