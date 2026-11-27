// Q1 (QA): the build with no scoreboard yet (a fresh evaluation, or a fork that has not run it).
// Fails today, marked it.fails with its card; the fix turns it.fails into it.
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { evalDataFiles, REPO_ROOT } from '../build-plugins.ts'

describe('the build with no evals/results/latest.json', () => {
  // https://trello.com/c/fGshnvYp
  it.fails('still emits the app data, so the app can show an empty scoreboard', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'q1-empty-'))
    mkdirSync(path.join(root, 'evals', 'results'), { recursive: true })
    cpSync(path.join(REPO_ROOT, 'evals', 'questions.yaml'), path.join(root, 'evals', 'questions.yaml'))
    cpSync(
      path.join(REPO_ROOT, 'evals', 'results', 'answers.json'),
      path.join(root, 'evals', 'results', 'answers.json'),
    )
    expect(() => evalDataFiles(root)).not.toThrow()
  })
})
