import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against the built app and the API on E2E_PORT (default 4173): the same server
// as pnpm demo, so build first (pnpm qa does). The server is always started here, on that port only
// (it exits when the port is busy and is never reused), so a busy port fails fast instead of testing
// a server someone else left running.
const port = Number(process.env.E2E_PORT ?? 4173)

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
      // Ranking and embedding parity and the demo's data layer don't depend on the viewport: one run is enough.
      testIgnore: ['**/search-parity.e2e.ts', '**/embed-parity.e2e.ts', '**/demo.e2e.ts'],
    },
  ],
  webServer: {
    // --no-key: recorded answers only, like the public site, even with a key in .env.local.
    command: `node packages/api/dist/cli.js serve --port ${port} --no-key`,
    url: `http://127.0.0.1:${port}/api/meta`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
