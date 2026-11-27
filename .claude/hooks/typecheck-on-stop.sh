#!/usr/bin/env bash
# Runs the typecheck when the session ends, only if it changed code.
cd "$CLAUDE_PROJECT_DIR" || exit 0
git status --porcelain | grep -qE '\.(ts|tsx|js|mjs)$' || exit 0
pnpm --silent typecheck >&2 || exit 2
