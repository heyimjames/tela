/**
 * The browser-level storage gate (CLI-538).
 *
 * CLI-527 moved bundle bodies into IndexedDB and proved the result once, by hand, in
 * a real Chromium: a 6 MB body round-tripping byte-identically, a genuine
 * `QuotaExceededError` classified as such, a legacy `localStorage` body migrated, and
 * "Clear All Data" actually emptying the store. The committed suite for all of that
 * runs on an IndexedDB *double* under vitest, which can only ever prove the code
 * agrees with the double. This config makes the real-browser proof a standing check,
 * the way `playwright.config.ts` did for the zero-network property.
 *
 * ## Why a second config file rather than more projects in `playwright.config.ts`
 *
 * Playwright starts **every** `webServer` entry for a run, whatever `--project` is
 * selected; there is no per-project server. Folding these projects into the
 * zero-network config would therefore make the existing offline gate build this
 * suite's two extra apps on every run, and a failure in either one would fail the
 * zero-network check — a contractual gate taking a dependency on a test fixture.
 * Keeping them apart keeps each gate's red meaning one thing. `playwright.config.ts`
 * says in its own header that it is deliberately scoped to one property; this honours
 * that rather than editing it away.
 *
 * ## Two projects, two builds, two origins
 *
 *  - **`storage`** serves the default-mode build (both feature gates explicitly
 *    emptied, exactly as the zero-network probe does) plus the storage harness page,
 *    from `dist-storage-probe/`.
 *  - **`workspace-cookies`** serves a `VITE_WORKSPACE_MODE=true` build from
 *    `dist-workspace-probe/`, against a stub API server — never the real backend.
 *
 * Separate output directories are load-bearing twice over: the workspace-mode build
 * must not be able to become the artifact a default-mode assertion measured, and
 * neither build may touch `dist/`, which is what ships inside the certified MCP
 * payload. (`vite build` runs with `emptyOutDir: true`; building into `dist/` deletes
 * `dist/mcp/` and leaves the vitest MCP suites failing on a missing binary — the
 * CLI-528 lesson.)
 *
 * ## No retries, no reuse, no skip
 *
 * Same reasoning as the zero-network probe. A retry could bury an intermittent
 * failure, a reused server could answer from a stale or differently-configured build,
 * and a skip-when-no-browser would turn a gate into an assertion that cannot fail —
 * which is worse than no gate, because it mints a false record.
 */

import { defineConfig, devices } from '@playwright/test'

import { STORAGE_BASE_URL, STORAGE_PORT, WORKSPACE_BASE_URL, WORKSPACE_PORT } from './tests/storage/origin'

export default defineConfig({
  testDir: './tests/storage',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // Generous: a single test writes, reads back and hashes a 6 MB body, twice over in
  // the quota case.
  timeout: 180_000,
  // `list` prints every test name as it runs, so a CI log can be read as evidence the
  // gate executed rather than as evidence the job was green.
  reporter: [['list']],
  projects: [
    {
      name: 'storage',
      // Everything *except* the cookie spec, rather than a list of the files that
      // exist today. A per-project allow-list is a silent-drop hole: a spec added to
      // `tests/storage/` later would match no project and never run, and Playwright
      // only errors when *no* test matches at all, so the job would stay green while
      // quietly not running the new check. Subtracting instead means a new spec runs
      // by default, against the default-mode build, and anything that needs the other
      // origin has to be named here to opt out.
      testIgnore: ['**/workspace-cookies.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: STORAGE_BASE_URL },
    },
    {
      name: 'workspace-cookies',
      testMatch: '**/workspace-cookies.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: WORKSPACE_BASE_URL },
    },
  ],
  webServer: [
    {
      // The app first, then the harness into a subdirectory of the same tree. Order
      // matters: the app build empties its output directory, the harness build does
      // not (see tests/storage/harness/vite.config.ts).
      command:
        `npm run build:app -- --outDir dist-storage-probe && ` +
        `npx vite build --config tests/storage/harness/vite.config.ts && ` +
        `npm run preview -- --outDir dist-storage-probe --port ${STORAGE_PORT} --strictPort --host 127.0.0.1`,
      url: STORAGE_BASE_URL,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        // The default payload build: workspace mode off, AI endpoint absent. Explicit
        // `process.env` entries win over `.env` files in Vite's env resolution, and
        // both gates treat the empty string as off, so this pins default mode even on
        // a machine with a local `.env`.
        VITE_WORKSPACE_MODE: '',
        VITE_AI_API_ORIGIN: '',
      },
    },
    {
      command:
        `npm run build:app -- --outDir dist-workspace-probe && ` +
        `node tests/storage/stub-server.mjs`,
      url: `${WORKSPACE_BASE_URL}/__stub__/health`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        VITE_WORKSPACE_MODE: 'true',
        VITE_AI_API_ORIGIN: '',
        // Same-origin API, which is the deployment shape src/workspace/endpoint.ts
        // documents — so the cookie under test is a first-party one, as in production.
        VITE_WORKSPACE_API_BASE_URL: '',
        STUB_PORT: String(WORKSPACE_PORT),
        STUB_ROOT: 'dist-workspace-probe',
      },
    },
  ],
})
