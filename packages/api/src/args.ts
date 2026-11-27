// Command-line options of the server, kept apart from cli.ts so they can be tested.
import { parseArgs } from 'node:util'

export const DEFAULT_PORT = 8787

export interface ServeOptions {
  command: string | undefined
  port: number
}

/** `pnpm demo -- --port 8891` passes the `--` through: it is dropped, or the flags after it are lost. */
export function parseServeArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): ServeOptions {
  const { values, positionals } = parseArgs({
    args: argv.filter((arg) => arg !== '--'),
    allowPositionals: true,
    options: { port: { type: 'string' } },
  })
  const raw = values.port ?? env.PORT ?? String(DEFAULT_PORT)
  const port = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`The port must be a number from 1 to 65535, not "${raw}".`)
  return { command: positionals[0], port }
}
