// pnpm --filter @graph-rag/vault generate: renders examples/tarnwick/world.yaml into the notes of
// examples/tarnwick/vault, removing notes the world no longer has.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadWorld, renderWorld, vaultFiles } from './node.js'

const example = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/tarnwick')
const vault = path.join(example, 'vault')
const files = renderWorld(loadWorld(readFileSync(path.join(example, 'world.yaml'), 'utf8')))
mkdirSync(vault, { recursive: true })
for (const stale of vaultFiles(vault)) if (!files.has(stale)) rmSync(path.join(vault, stale))
for (const [file, text] of files) {
  mkdirSync(path.dirname(path.join(vault, file)), { recursive: true })
  writeFileSync(path.join(vault, file), text)
}
console.log(`Wrote ${files.size} notes to ${path.relative(process.cwd(), vault)}`)
