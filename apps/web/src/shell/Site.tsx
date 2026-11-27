// The site's own header and footer, for the landing page and the 404 (the product screens have the
// app shell). The footer is the same as Atlas and Crew: who built it, LinkedIn and GitHub, the project
// and docs links, and the legal line that the company in the vault is fictional.
import { paths } from '@graph-rag/client'
import { Button } from '@leonfpontes/atlas-ui'
import { ExternalLink, Moon, Sun } from 'lucide-react'
import type { ReactNode } from 'react'

import { GithubIcon, Mark } from '../lib/icons'
import { Link } from '../lib/router'
import { useTheme } from '../lib/theme'
import { REPOSITORY_URL } from './AppShell'

export const LINKEDIN_URL = 'https://www.linkedin.com/in/leonardo-fonseca-pontes-465740103/'
export const GITHUB_PROFILE_URL = 'https://github.com/leonfpontes'
export const ATLAS_URL = 'https://github.com/leonfpontes/design-system-mcp'

export const WRAP = 'mx-auto w-full max-w-[1200px] px-6 max-[600px]:px-4'

export function Brand() {
  return (
    <Link
      href={paths.howItWorks()}
      className="inline-flex min-h-11 items-center gap-2.5 text-[15px] leading-none font-semibold whitespace-nowrap text-foreground no-underline outline-none focus-visible:rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Mark />
      graph-rag-vault
    </Link>
  )
}

export function ThemeButton() {
  const { dark, toggle } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  )
}

export function SiteHeader({ nav }: { nav?: { href: string; label: string }[] }) {
  return (
    <header className="border-b">
      <div className={`${WRAP} flex h-16 items-center gap-5`}>
        <Brand />
        {nav && (
          <nav aria-label="Page" className="hidden gap-5 md:flex">
            {nav.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="inline-flex min-h-6 items-center text-sm text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:rounded-xs focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {n.label}
              </a>
            ))}
          </nav>
        )}
        <span className="flex-1" />
        <Button asChild variant="ghost" size="icon">
          <a href={REPOSITORY_URL} aria-label="GitHub repository">
            <GithubIcon />
          </a>
        </Button>
        <ThemeButton />
      </div>
    </header>
  )
}

const FOOT_LINK =
  'inline-flex min-h-8 items-center text-sm text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:rounded-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 max-[760px]:min-h-11'

function FootList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-2.5 text-[13px] font-semibold">{title}</h2>
      <ul className="m-0 grid list-none gap-1 p-0">{children}</ul>
    </div>
  )
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t pt-10 pb-14">
      <div
        className={`${WRAP} grid grid-cols-[2fr_1fr_1fr] gap-8 max-[760px]:grid-cols-2 max-[760px]:[&>div:first-child]:col-span-2`}
      >
        <div>
          <p className="font-semibold">Built by Leonardo Pontes</p>
          <p className="text-sm text-muted-foreground">
            Ingestion, hybrid search, evaluation and interface, end to end. The interface uses{' '}
            <a
              href={ATLAS_URL}
              className="text-primary underline decoration-1 underline-offset-4 outline-none hover:decoration-2 focus-visible:rounded-xs focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Atlas UI
            </a>
            .
          </p>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={LINKEDIN_URL}>
                LinkedIn <ExternalLink aria-hidden="true" />
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={GITHUB_PROFILE_URL}>
                <GithubIcon />
                GitHub
              </a>
            </Button>
          </div>
        </div>
        <FootList title="Project">
          <li>
            <a className={FOOT_LINK} href={REPOSITORY_URL}>
              Repository
            </a>
          </li>
          <li>
            <Link className={FOOT_LINK} href={paths.explore()}>
              Demo
            </Link>
          </li>
          <li>
            <Link className={FOOT_LINK} href={paths.evaluation()}>
              Evaluation
            </Link>
          </li>
        </FootList>
        <FootList title="Docs">
          <li>
            <a className={FOOT_LINK} href={`${paths.howItWorks()}#quickstart`}>
              Quickstart
            </a>
          </li>
          <li>
            <a className={FOOT_LINK} href={`${paths.howItWorks()}#search`}>
              Hybrid search
            </a>
          </li>
          <li>
            <a className={FOOT_LINK} href={`${paths.howItWorks()}#eval`}>
              How we measure
            </a>
          </li>
        </FootList>
        <p className="col-span-full text-[13px] text-muted-foreground">
          graph-rag-vault · MIT license · Tarnwick Cycles, its people and its customers are fictional.
        </p>
      </div>
    </footer>
  )
}
