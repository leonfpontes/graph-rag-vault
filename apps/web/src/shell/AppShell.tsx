// The app shell: the top bar (mark, repository / vault, the product tabs, the mode, GitHub, theme)
// and, on phones, the tabs in a bottom bar within thumb reach. Note opens from a node, a source or
// a link, so it has no tab of its own.
import { LOCAL_ANSWER_COMMANDS, paths, type AppRoute, type DemoMode } from '@graph-rag/client'
import { Button, cn } from '@leonfpontes/atlas-ui'
import {
  ChartColumn,
  Check,
  ChevronDown,
  Folder,
  Info,
  MessageCircleQuestionMark,
  Moon,
  Sun,
  Waypoints,
  X,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { useDemo } from '../lib/demo'
import { GithubIcon, Mark } from '../lib/icons'
import { Link, useRouter } from '../lib/router'
import { useTheme } from '../lib/theme'
import { CodeBlock } from './CodeBlock'

export const REPOSITORY_URL = 'https://github.com/leonfpontes/graph-rag-vault'

const TABS = [
  { route: 'explore', label: 'Explore', href: paths.explore(), Icon: Waypoints },
  { route: 'ask', label: 'Ask', href: paths.ask(), Icon: MessageCircleQuestionMark },
  { route: 'evaluation', label: 'Evaluation', href: paths.evaluation(), Icon: ChartColumn },
] as const

const current = (route: AppRoute, tab: string) =>
  route.name === tab || (tab === 'explore' && route.name === 'note')

export function AppShell({ children }: { children: ReactNode }) {
  const { route } = useRouter()
  return (
    <div className="min-h-screen pb-[57px] md:pb-0">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background focus:not-sr-only focus:px-3 focus:py-2 focus:fixed focus:top-2 focus:left-2 focus:ring-[3px] focus:ring-ring/50"
      >
        Skip to content
      </a>
      <TopBar route={route} />
      <ExamplesBand />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <nav
        aria-label="Product tabs"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {TABS.map(({ route: name, label, href, Icon }) => (
          <Link
            key={name}
            href={href}
            aria-current={current(route, name) ? 'page' : undefined}
            className={cn(
              'grid min-h-14 place-items-center content-center gap-0.5 text-xs font-medium text-muted-foreground no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset [&_svg]:size-4',
              current(route, name) && 'text-foreground shadow-[inset_0_2px_0_var(--foreground)]',
            )}
          >
            <Icon aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}

function TopBar({ route }: { route: AppRoute }) {
  const { dark, toggle } = useTheme()
  return (
    <header className="sticky top-0 z-20 border-b bg-background">
      <div className="flex h-14 items-center gap-2 pr-3 pl-4 md:gap-4 md:px-6">
        <Link
          href={paths.howItWorks()}
          className="inline-flex min-h-11 items-center gap-2.5 text-[15px] leading-none font-semibold whitespace-nowrap text-foreground no-underline outline-none focus-visible:rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Mark />
          graph-rag-vault
        </Link>
        <span aria-hidden="true" className="hidden text-xl text-text-subtle md:inline">
          /
        </span>
        <span className="hidden items-center gap-1.5 font-mono text-sm font-medium md:inline-flex">
          <Folder aria-hidden="true" className="size-4 text-muted-foreground" />
          tarnwick-vault
        </span>
        <nav aria-label="Product" className="hidden h-14 items-stretch gap-6 px-6 md:flex">
          {TABS.map(({ route: name, label, href, Icon }) => (
            <Link
              key={name}
              href={href}
              aria-current={current(route, name) ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 border-transparent px-0.5 text-sm font-medium text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset [&_svg]:size-4',
                current(route, name) && 'border-foreground text-foreground',
              )}
            >
              <Icon aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <span className="flex-1" />
        <ModeButton />
        <Button asChild variant="ghost" size="icon" className="hidden md:inline-flex">
          <a href={REPOSITORY_URL} aria-label="GitHub repository">
            <GithubIcon />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
        >
          {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>
      </div>
    </header>
  )
}

/** Example data is marked, always: the band shows until the real scoreboard exists. */
function ExamplesBand() {
  const { state } = useDemo()
  if (state.status !== 'ready' || !state.demo.scoreboard.rehearsal) return null
  return (
    <div
      role="note"
      className="flex items-center justify-center gap-2 border-b border-dashed border-warning/50 bg-warning-subtle px-4 py-1.5 text-[13px] text-warning"
    >
      <Info aria-hidden="true" className="size-3.5" />
      Example numbers until <code>pnpm eval</code> runs on the test questions.
    </div>
  )
}

const MODE_TEXT: Record<
  DemoMode,
  { button: string; short: string; title: string; lead: string; key: string }
> = {
  static: {
    button: 'Demo mode',
    short: 'Demo',
    title: 'Demo mode: runs in your browser',
    lead: 'The search index of the Tarnwick Cycles vault ships with the page. Search runs here, with no server and no key.',
    key: 'Generated answers to your own question: only when you run it locally, with your key',
  },
  demo: {
    button: 'Demo mode',
    short: 'Demo',
    title: 'Local demo, no key',
    lead: 'This server runs on your machine without a model key: search and the recorded answers work as on the public site.',
    key: 'Generated answers to your own question: put your key in .env.local and start pnpm demo again',
  },
  local: {
    button: 'Local mode',
    short: 'Local',
    title: 'Local mode: answers with your key',
    lead: 'This server runs on your machine with your Anthropic key: a question with no recorded answer gets a written answer.',
    key: '',
  },
}

function ModeButton() {
  const { state } = useDemo()
  const mode: DemoMode = state.status === 'ready' ? state.demo.mode : 'static'
  const text = MODE_TEXT[mode]
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])
  return (
    <span ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md bg-info-subtle px-3 text-xs font-medium whitespace-nowrap text-info outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11"
      >
        <Info aria-hidden="true" className="size-3.5" />
        <span className="hidden md:inline">{text.button}</span>
        <span className="md:hidden">{text.short}</span>
        <ChevronDown aria-hidden="true" className="size-3" />
      </button>
      <div
        id={id}
        role="region"
        aria-label={text.title}
        hidden={!open}
        className="fixed top-16 right-3 left-3 z-30 grid gap-2.5 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-overlay md:absolute md:top-[calc(100%+8px)] md:right-0 md:left-auto md:w-[360px]"
      >
        <h2 className="text-sm font-semibold">{text.title}</h2>
        <p className="text-muted-foreground">{text.lead}</p>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          <ModeLine ok>Explore, notes and search: live, in your browser</ModeLine>
          <ModeLine ok>The 50 evaluation questions: recorded answers, instant</ModeLine>
          {text.key ? (
            <ModeLine>{text.key}</ModeLine>
          ) : (
            <ModeLine ok>Generated answers to your own question</ModeLine>
          )}
        </ul>
        {mode === 'static' && <CodeBlock title="Run locally" lines={LOCAL_ANSWER_COMMANDS} />}
      </div>
    </span>
  )
}

function ModeLine({ ok = false, children }: { ok?: boolean; children: ReactNode }) {
  const Icon = ok ? Check : X
  return (
    <li className="flex items-start gap-2">
      <Icon aria-hidden="true" className="mt-1 size-4 shrink-0" />
      <span>
        <span className="sr-only">{ok ? 'Works: ' : 'Not here: '}</span>
        {children}
      </span>
    </li>
  )
}
