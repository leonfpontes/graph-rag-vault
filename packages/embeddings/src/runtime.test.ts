import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { EMBEDDING_RUNTIME, ONNX_WEB_VERSION, poolAndNormalize } from './index.js'

const json = (file: string) =>
  JSON.parse(readFileSync(file, 'utf8')) as { dependencies: Record<string, string> }

describe('the runtime', () => {
  it('pins the onnxruntime-web that transformers.js loads in the browser', () => {
    const own = json(new URL('../package.json', import.meta.url).pathname)
    expect(own.dependencies['onnxruntime-web']).toBe(ONNX_WEB_VERSION)
    // the package's own package.json sits above its resolved entry point
    let dir = path.dirname(createRequire(import.meta.url).resolve('@huggingface/transformers'))
    while (!existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir)
    expect(json(path.join(dir, 'package.json')).dependencies['onnxruntime-web']).toBe(ONNX_WEB_VERSION)
    expect(EMBEDDING_RUNTIME).toBe(`onnxruntime-web@${ONNX_WEB_VERSION} wasm q8`)
  })

  it('pools the first token or the mean of the real tokens, to unit length', () => {
    // 2 texts × 3 tokens × 2 dims; the second text has one padding token
    const hidden = [3, 4, 1, 1, 9, 9, 0, 2, 2, 0, 50, 50]
    const mask = [1, 1, 1, 1, 1, 0]
    const cls = poolAndNormalize(hidden, [2, 3, 2], mask, 'cls')
    ;[0.6, 0.8, 0, 1].forEach((x, i) => expect(cls[i]).toBeCloseTo(x, 6))
    const mean = poolAndNormalize(hidden, [2, 3, 2], mask.map(BigInt), 'mean')
    // text 1: mean (13/3, 14/3); text 2: mean of (0,2) and (2,0) = (1,1), the padding left out
    expect(mean[0]! / mean[1]!).toBeCloseTo(13 / 14, 6)
    expect(mean[2]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(mean[3]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(Math.hypot(mean[0]!, mean[1]!)).toBeCloseTo(1, 6)
  })
})
