/**
 * Playwright project for the zero-network runtime probe (CLI-528).
 *
 * Scope is deliberately one thing. This config exists to gate a single
 * contractual property — the default-mode app makes no network request at
 * runtime — and not to become the repo's general browser-test runner. The
 * MCP browser-bridge suite stays where it is, under vitest.
 *
 * Three choices here are load-bearing:
 *
 *  - **The probe builds its own subject, into its own directory.** `webServer`
 *    builds before it previews, with the two feature gates explicitly emptied.
 *    A probe that served whatever happened to be sitting in `dist/` would be
 *    measuring an unknown build — and a `dist/` produced with
 *    `VITE_WORKSPACE_MODE=true` would make the gate pass while proving nothing
 *    about the shipped default. Explicit `process.env` entries win over `.env`
 *    files in Vite's env resolution, and both gates treat the empty string as
 *    off (`src/storage/index.ts`, `src/lib/aiApi.ts`), so this pins default
 *    mode even on a machine with a local `.env`.
 *
 *    The output goes to `dist-probe/`, not `dist/`, for the same reason
 *    `build:bridge` uses `dist-bridge/`: `vite build` runs with
 *    `emptyOutDir: true`, so building into `dist/` deletes `dist/mcp/` and
 *    leaves the vitest MCP suites failing on a missing binary. Running the
 *    probe must not break the next command you type.
 *
 *  - **No `reuseExistingServer`.** Every run rebuilds. Reuse would let a stale
 *    or differently-configured server answer the probe.
 *
 *  - **No retries, and no skip-when-no-browser.** A retry could bury an
 *    intermittent request; a skip would turn a gate into an assertion that
 *    cannot fail, which is worse than no gate because it mints a false record.
 *    A missing Chromium is therefore a hard failure telling you to run
 *    `npx playwright install chromium`. This suite is its own npm script
 *    (`npm run test:network`), so that strictness never breaks `npm test`.
 */

import { defineConfig, devices } from '@playwright/test'

import { BASE_URL, PROBE_PORT } from './tests/network/origin'

export default defineConfig({
  testDir: './tests/network',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // Generous: the webServer command includes a production build.
  timeout: 120_000,
  // `list` prints every test name as it runs, so a CI log can be read as
  // evidence the probe executed rather than evidence the job was green.
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    // Nothing offline-forcing here on purpose. The probe must observe what the
    // app actually attempts; blocking requests at the browser would hide the
    // very thing it is asked to detect.
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      `npm run build:app -- --outDir dist-probe && ` +
      `npm run preview -- --outDir dist-probe --port ${PROBE_PORT} --strictPort --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // The default payload build: workspace mode off, AI endpoint absent.
      VITE_WORKSPACE_MODE: '',
      VITE_AI_API_ORIGIN: '',
    },
  },
})
