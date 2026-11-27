// The states every screen shares while the demo loads or when it fails: what is happening, in MB, and
// what to do next.
import { Button, Progress } from '@leonfpontes/atlas-ui'
import { LoaderCircle, OctagonX, RotateCcw } from 'lucide-react'

import type { Download } from '../lib/demo'
import { mb } from '../lib/format'

export function DownloadStatus({
  download,
  what = 'the graph index',
}: {
  download: Download
  what?: string
}) {
  const value = download.total ? Math.round((download.loaded / download.total) * 100) : undefined
  return (
    <div role="status" className="grid max-w-[380px] justify-items-start gap-3">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />
      <h2 className="text-base font-semibold">Loading {what}</h2>
      <Progress
        value={value ?? null}
        aria-label="Index download"
        aria-valuetext={download.total ? `${mb(download.loaded)} of ${mb(download.total)} MB` : undefined}
        className="w-60"
      />
      <p className="n text-[13px] text-muted-foreground">
        {download.total ? `${mb(download.loaded)} of ${mb(download.total)} MB` : `${mb(download.loaded)} MB`}{' '}
        · runs in your browser, no server
      </p>
    </div>
  )
}

export function DemoError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div role="alert" className="grid max-w-[420px] justify-items-start gap-3">
      <OctagonX aria-hidden="true" className="size-4 text-destructive" />
      <h2 className="text-base font-semibold">The graph index did not load</h2>
      <p className="text-sm text-muted-foreground">
        {error.message} Reload the page; if it keeps failing, run the demo locally with <code>pnpm demo</code>
        .
      </p>
      <Button variant="outline" onClick={onRetry}>
        <RotateCcw aria-hidden="true" />
        Try again
      </Button>
    </div>
  )
}
