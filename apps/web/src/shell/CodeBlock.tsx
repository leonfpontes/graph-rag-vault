// A terminal block: commands with a "$", comments dimmed, and a copy button that copies the commands
// alone (no "$", no comments).
import { cn } from '@leonfpontes/atlas-ui'
import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

export function CodeBlock({
  title = 'Terminal',
  lines,
  notes = [],
  className,
}: {
  title?: string
  lines: readonly string[]
  /** Dimmed comment lines after the commands. */
  notes?: readonly string[]
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <div className={cn('min-w-0 overflow-hidden rounded-lg bg-code-bg text-code-fg', className)}>
      <div className="flex items-center gap-2 border-b border-white/10 py-1 pr-1 pl-3.5 font-mono text-xs text-code-dim">
        <span>{title}</span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label={copied ? 'Copied' : lines.length > 1 ? 'Copy commands' : 'Copy command'}
          onClick={() => {
            navigator.clipboard
              ?.writeText(lines.map((l) => l.replace(/\s+#.*$/, '')).join('\n'))
              .catch(() => {})
            setCopied(true)
          }}
          className="grid size-10 cursor-pointer place-items-center rounded-md text-code-dim outline-none hover:text-code-fg focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:size-11 [&_svg]:size-4"
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto px-3.5 py-3 font-mono text-[13px] leading-[1.7]" tabIndex={0}>
        {lines.map((l) => {
          const [cmd, comment] = l.split(/(?=\s+#\s)/)
          return (
            <span key={l} className="block whitespace-pre">
              <span aria-hidden="true">$ </span>
              {cmd}
              {comment && <span className="text-code-dim">{comment}</span>}
            </span>
          )
        })}
        {notes.map((l) => (
          <span key={l} className="block whitespace-pre text-code-dim">
            # {l}
          </span>
        ))}
      </pre>
    </div>
  )
}
