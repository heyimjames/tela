/**
 * The harness's own build.
 *
 * Separate from `vite.config.ts` at the repo root, and that separation is the point:
 * adding this page as a second entry to the app's build would put it in `dist/`, and
 * `dist/` is what ships inside the certified MCP payload. A test page must not be
 * able to reach a user's machine.
 *
 * `emptyOutDir` is off because this build runs *after* the app build has filled the
 * same probe directory — it adds a subdirectory rather than replacing the tree. The
 * CLI-528 lesson is one step further along the same wire: a build step that writes
 * into a directory another step owns will eventually delete something. Here the app
 * writes `dist-storage-probe/` and the harness writes only
 * `dist-storage-probe/__storage_harness__/`, so neither can clobber the other, and
 * `dist/` is untouched by both.
 *
 * `base` is the harness's own served path, so its asset URLs resolve when the page is
 * opened at `/__storage_harness__/`.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

export default defineConfig({
  root: here,
  base: '/__storage_harness__/',
  resolve: {
    // Kept in step with the root `vite.config.ts`: the harness must resolve the same
    // modules the app does, or it would be testing a different tree.
    alias: {
      '@': path.resolve(repoRoot, 'src'),
      '@performance-clickt/design-api-client': path.resolve(
        repoRoot,
        'vendor/design-api-client/src/index.ts',
      ),
    },
  },
  build: {
    outDir: path.resolve(repoRoot, 'dist-storage-probe/__storage_harness__'),
    emptyOutDir: false,
  },
})
