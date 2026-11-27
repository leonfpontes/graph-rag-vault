import { describe, expect, it } from 'vitest'

import { DownloadTally } from './progress'

describe('the download tally', () => {
  it('adds the model and the runtime into one bar, and never shows more loaded than the total', () => {
    const seen: { loaded: number; total: number }[] = []
    const t = new DownloadTally({ model: 34, runtime: 14 }, (d) => seen.push(d))
    t.add('runtime', 10)
    t.add('model', 5)
    expect(seen.at(-1)).toEqual({ loaded: 15, total: 48 })
    t.total('model', 30) // the server says the size
    expect(seen.at(-1)).toEqual({ loaded: 15, total: 44 })
    t.add('runtime', 10) // more than expected (a compressed Content-Length): the total follows
    expect(seen.at(-1)).toEqual({ loaded: 25, total: 50 })
    t.total('runtime', undefined)
    expect(t.now()).toEqual({ loaded: 25, total: 50 })
  })

  it('counts a part of unknown size by what has arrived', () => {
    const t = new DownloadTally({}, () => {})
    t.add('model', 7)
    expect(t.now()).toEqual({ loaded: 7, total: 7 })
  })
})
