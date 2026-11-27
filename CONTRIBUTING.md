# Contributing

## Set up

Node 24 (see `.nvmrc`) and pnpm (`corepack enable`), then:

```bash
pnpm install
pnpm qa
```

`pnpm install` points git at `.githooks`, where a pre-commit hook runs
[gitleaks](https://github.com/gitleaks/gitleaks) when it is installed.

## Before you open a pull request

- [ ] `pnpm qa` passes (types, lint, formatting, tests, build, end-to-end)
- [ ] `pnpm test --coverage` keeps the floors
- [ ] A new test for every new rule
- [ ] No secrets in the diff
- [ ] `docs/` and `CHANGELOG.md` updated

## Conventions

- Short branches from `main`: `feat/`, `fix/`, `docs/`, `perf/`, `ops/`.
- [Conventional Commits](https://www.conventionalcommits.org/); the body explains why.
- Comments explain why, not what.
- Decisions that are hard to undo get an ADR in `docs/adr/`.
