// The recording stage of the share images (not a page for people: only with ?record, else the 404).
// scripts/share-images.mjs opens /share?record&theme=light and takes a screenshot of each piece at its
// final size, then reads window.__shareValues, the values the pieces show, and writes them next to
// the images (docs/share.values.json). `?case=win|tie|loss` shows the other outcomes, as examples.
import { useEffect, useState } from 'react'

import { useDemo } from '../lib/demo'
import { headline } from '../lib/headline'
import { useRouter } from '../lib/router'
import { exampleCase, featured, shareValues, type Featured, type ShareValues } from '../lib/share'
import { ShareArt } from '../share/ShareArt'

declare global {
  interface Window {
    __shareValues?: ShareValues
  }
}

export const PIECES = [
  { id: 'art-social', width: 1280, height: 640, dark: false },
  { id: 'art-og', width: 1200, height: 630, dark: false },
  { id: 'art-cover-light', width: 830, height: 415, dark: false },
  { id: 'art-cover-dark', width: 830, height: 415, dark: true },
] as const

export function Share() {
  const { state } = useDemo()
  const { location } = useRouter()
  const [f, setF] = useState<Featured>()
  const demo = state.status === 'ready' ? state.demo : undefined
  useEffect(() => {
    if (demo) void featured(demo).then(setF)
  }, [demo])
  const which = location.search.get('case')
  const sb =
    demo && (which === 'win' || which === 'tie' || which === 'loss')
      ? exampleCase(demo.scoreboard, which)
      : demo?.scoreboard
  const h = sb && headline(sb)
  useEffect(() => {
    if (sb && f && !which) window.__shareValues = shareValues(sb, f)
  }, [sb, f, which])
  if (!sb || !f || !h) return <p className="p-6 text-sm text-muted-foreground">Drawing the share images…</p>
  return (
    <div className="grid justify-start gap-10 bg-muted p-6">
      {PIECES.map((p) => (
        <section key={p.id} className={p.dark ? 'dark' : undefined}>
          <h2 className="mb-2 font-mono text-sm text-muted-foreground">
            {p.id} · {p.width} × {p.height}
          </h2>
          <ShareArt
            id={p.id}
            featured={f}
            sentence={h}
            width={p.width}
            height={p.height}
            example={sb.rehearsal}
          />
        </section>
      ))}
    </div>
  )
}
