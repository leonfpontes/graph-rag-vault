# AGENTS.md

Rules for any coding agent (Claude Code, Codex, Cursor, Copilot…) in this repository.
The repository will be public: everything in it is in English, and no client, personal or internal
team data goes in. The vault is fictional. Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Commands

```bash
pnpm install                    # install (Node 24, see .nvmrc); also points git at .githooks
pnpm dev --port 5173            # web app with hot reload; the API runs with pnpm serve
pnpm check                      # types + lint + format + tests + build: required before you finish
pnpm qa                         # pnpm check, then the end-to-end tests
pnpm vitest run <file>          # one test
pnpm test --coverage            # with the coverage floors, as CI
pnpm --filter <package> build   # one package (names in docs/ARCHITECTURE.md)
E2E_PORT=4300 pnpm e2e          # end-to-end tests on your own port
pnpm demo --port 8787           # build, then serve app + API on 127.0.0.1 (answers new questions with ANTHROPIC_API_KEY; --no-key ignores it)
pnpm index                      # vault → .graph-rag/index.sqlite → apps/web/public/data/index.bin (model cached once)
pnpm retrieval                  # recall@5 and MRR of the 3 variants on probe + dev, free (--split test for the scoreboard)
```

## What the code doesn't tell you

- Several people and agents run servers on the same machine. Every server takes `--port` or `PORT`
  and fails on a busy port. The end-to-end tests start their own server on `E2E_PORT` (default 4173) and never reuse one that is already running: a busy port fails fast instead of testing
  someone else's build. Stop the servers you started when you finish.
- `packages/search` runs in the browser too (the public demo searches a prebuilt index there). No
  Node built-ins in it: its tsconfig has no Node types, ESLint forbids `node:` imports and its tests
  run in jsdom.
- `packages/client` runs in the browser too (the same rules as the search), and so does the
  `@graph-rag/answer/passages` entry (`src/browser.ts`): keep `node:` imports out of `passages.ts`,
  `types.ts` and `provider.ts` of the answer package.
- The public site is static: whatever a screen shows must come from `loadDemo` (`index.bin` and
  the `/data/*.json` files), never from the API, which exists only on `pnpm demo`. Numbers come
  from `demo.scoreboard` (latest.json as it is), never typed into a component.
- A new route of the app goes in `packages/client/src/routes.ts` and in the rewrites of
  `vercel.json` (a test compares them), or it is a 404 on the public site.
- Workspace packages resolve to `src/` before any build: the `graph-rag-source` export condition
  (TypeScript, Vite) and the aliases in `vitest.config.ts`. A new package the others import needs both.

## Rules

- No internal names, clients, private projects or personal e-mail addresses anywhere in the
  repository (test: `tests/repo.test.ts`, no exceptions).
- Tests read only files that are in the repository; approved values from outside are frozen in a
  fixture under `src/test/` (test: `tests/repo.test.ts`).
- Never read, print or commit secrets (`.env*`, tokens). A new variable goes in `.env.example` with
  no value. gitleaks runs before each commit (`.githooks/pre-commit`) and in CI.
- Every migration of the index has a `down` that undoes its `up` (test: `migrate.test.ts`).
- Search weights are tuned on the probe and dev questions only, never on test
  (`retrievalReport` refuses it).
- Decisions that are hard to undo get an ADR in `docs/adr/`.

## Done means

1. `pnpm qa` passes, and `pnpm test --coverage` keeps the floors.
2. No console errors in the browser at 1440 and 375 px (when there is a UI).
3. `docs/` updated if a route, contract, command or variable changed.
4. One line in `CHANGELOG.md`.

## Traps already paid for

| Symptom                                         | Cause                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm test -- --coverage` runs without coverage | pnpm passes the `--` on to Vitest; use `pnpm test --coverage`                                           |
| `Cannot find module '@graph-rag/…'` on a clone  | `dist/` doesn't exist before the build; see the `graph-rag-source` condition above                      |
| CI fails on Linux where macOS passed            | Run the suite as CI does before a push: `docker run node:24` with `pnpm test --coverage`                |
| A commit shows a personal e-mail                | A new clone doesn't carry the local `git config user.email`; set the GitHub noreply right after cloning |
| `index.bin` test fails after a vault edit       | The demo's index is generated: run `pnpm index` (it re-embeds only what changed) and commit the file    |
| An end-to-end test calls the model              | The e2e server runs with `--no-key`; never drop it, or a key in `.env.local` turns the demo into local  |
| A route opens locally and is a 404 on Vercel    | `vercel.json` rewrites only the routes in `routes.ts`; add the new one to both                          |

## Publishing

Nothing is published (GitHub, Vercel) before the owner's final approval.
