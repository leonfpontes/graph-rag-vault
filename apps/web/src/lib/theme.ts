// Light or dark: ?dark / ?light (or ?theme=) in the address first, then the person's last choice,
// then the system. index.html applies it before the first paint; the switch in the top bar keeps it.
import { useCallback, useSyncExternalStore } from 'react'

const KEY = 'graph-rag-vault:theme'

const isDark = () => document.documentElement.classList.contains('dark')

function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => mo.disconnect()
}

export function useTheme(): { dark: boolean; toggle: () => void } {
  const dark = useSyncExternalStore(subscribe, isDark, () => false)
  const toggle = useCallback(() => {
    const next = !isDark()
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem(KEY, next ? 'dark' : 'light')
    } catch {
      // private mode: the choice lasts for this page only
    }
  }, [])
  return { dark, toggle }
}
