import { useSyncExternalStore } from 'react'

/** Phones: the layout below Tailwind's `md` (768 px). */
export const PHONE = '(max-width: 767px)'
/** Below this the Explore preview and the Ask graph move under the main column. */
export const NARROW = '(max-width: 1180px)'

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query)
      m.addEventListener?.('change', onChange)
      return () => m.removeEventListener?.('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
