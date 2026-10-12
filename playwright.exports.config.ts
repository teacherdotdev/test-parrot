// The out-of-band export comparison's own Playwright configuration.
//
// Deliberately separate from `playwright.config.ts`: `bun run test:e2e` must
// not pick the diagnostic up, and the diagnostic must not be a gate anything
// runs by accident. `bun run test:exports` is its only documented entry point.

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './scripts',
  testMatch: '*.diagnostic.ts',
  // One browser, one converter, one artifact directory: the comparison is a
  // diagnostic to read, not a suite to race.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4174' },
  webServer: {
    command: 'bunx vite --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
  },
})
