# CLAUDE.md

@AGENTS.md

## Claude Code only

- English in the product, the docs and the code. The repository will be public.
- Personal preferences go in `CLAUDE.local.md` (ignored by git).

## What the harness (`.claude/`) already guarantees

- `settings.json` denies reading `.env*` and `.vercel`.
- The Stop hook runs `pnpm typecheck` when the session changed code.
