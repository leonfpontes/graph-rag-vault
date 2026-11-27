import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { App } from '../App'
import { demoOptions, type DemoStub } from './demo'

/** The whole app at an address, with the demo served from the repository's files. */
export function renderAt(address: string, stub: DemoStub = {}) {
  window.history.replaceState(null, '', address)
  const options = demoOptions(stub)
  const user = userEvent.setup()
  return { ...render(<App demo={options} />), user, calls: options.calls }
}

/** Phones: every `(max-width: …)` query matches. */
export function asPhone() {
  window.matchMedia = ((query: string) =>
    ({
      matches: /max-width/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia
}
