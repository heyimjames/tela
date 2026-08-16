/**
 * Playwright project for the rendered-brand assertions (CLI-561).
 *
 * `src/brand/brand.test.ts` proves the *sources* say the right thing. It cannot
 * prove the browser agrees: a token can be declared correctly and shadowed, a
 * `color-mix` can fail to parse and fall back to nothing, and an `<img>`-hosted
 * SVG can silently decline to use the font embedded in it. Those are questions
 * only a booted browser answers, which is why this suite exists alongside the
 * vitest one rather than instead of it.
 *
 * Scope is deliberately one thing — what the shipped chrome renders — and this
 * config does not become the repo's general browser-test runner. It follows the
 * zero-network probe's choices for the same reasons stated there:
 *
 *  - **It builds its own subject, into its own directory** (`dist-brand/`), with
 *    both feature gates explicitly emptied, so the subject is the default-mode
 *    build that ships and not whatever happens to be sitting in `dist/`.
 *    Building into `dist/` would delete `dist/mcp/` and break the next command.
 *  - **No `reuseExistingServer`** — a stale server could answer with a build
 *    made before the token change under test.
 *  - **No retries and no skip-when-no-browser.** A skip would turn the visual
 *    gate into an assertion that cannot fail, which is worse than no gate
 *    because it mints a false record. A missing Chromium is a hard failure
 *    telling you to run `npx playwright install chromium`. This suite is its own
 *    npm script (`npm run test:brand`), so that strictness never breaks
 *    `npm test`.
 */

import { defineConfig, devices } from '@playwright/test'

import { BASE_URL, BRAND_PORT } from './tests/brand/origin'

export default defineConfig({
  testDir: './tests/brand',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // Generous: the webServer command includes a production build.
  timeout: 120_000,
  // `list` prints every test name as it runs, so a CI log can be read as
  // evidence the assertions executed rather than evidence the job was green.
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    // Screenshots are the human-readable half of this suite's evidence; they are
    // written on failure and, for the two brand surfaces, unconditionally.
    screenshot: 'only-on-failure',
  },
  outputDir: './test-results/brand',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      `npm run build:app -- --outDir dist-brand && ` +
      `npm run preview -- --outDir dist-brand --port ${BRAND_PORT} --strictPort --host 127.0.0.1`,
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
