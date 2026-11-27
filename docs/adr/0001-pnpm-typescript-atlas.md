# 0001 · One pnpm monorepo in TypeScript, with Atlas UI from npm

**Status:** accepted · 2026-11-27

## Context

The project has six parts that share types: the vault parser, the index, the search (which also
runs in the browser), the API, the app and the evaluation. A reader should run it in three
commands, and CI should catch on Linux what passes on a laptop.

## Decision

- One pnpm workspace, TypeScript in `strict`, Node 24 (`.nvmrc`, `engines`), ESLint, Prettier and
  Vitest with one project per package; Playwright for the end-to-end tests.
- Workspace packages are private and export their source under the `graph-rag-source` condition,
  so typecheck and tests run on a clean clone before any build.
- The app uses the published Atlas UI (`@leonfpontes/atlas-ui`, shadcn/ui on Tailwind 4) with its
  theme, adding only what this product needs.
- One command proves everything: `pnpm check` (types, lint, format, tests, build); `pnpm qa` adds
  the end-to-end tests. CI runs the same steps, with coverage floors, on Linux.

## Consequences

- A new package needs the source condition in its `package.json` and an alias in
  `vitest.config.ts` (a guard test checks both).
- Atlas UI changes reach the app only through a new published version.
