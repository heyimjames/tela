import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tela is a standalone Vite SPA. It builds to ./dist and can be served
// from any static host. To embed it under a sub-path (e.g. an iframe at
// /studio/canvas), set `base` to that path.
// The source commit the release build stamps into `.tela` manifests, injected as
// a define so no tracked file is rewritten during a build (see src/tela/producer.ts).
// Unset for every ordinary build, which then carries the all-zero constant.
const sourceCommit = process.env.TELA_SOURCE_COMMIT?.trim().toLowerCase()
if (sourceCommit !== undefined && !/^[0-9a-f]{40}$/.test(sourceCommit)) {
  throw new Error(`TELA_SOURCE_COMMIT must be a 40-character lowercase hex sha, got "${process.env.TELA_SOURCE_COMMIT}"`)
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  ...(sourceCommit ? { define: { __TELA_SOURCE_COMMIT__: JSON.stringify(sourceCommit) } } : {}),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The v1 API client is vendored, not installed — see vendor/design-api-client/SOURCE.md.
      // Aliased to its source so the same bytes are typechecked, bundled and tested.
      "@performance-clickt/design-api-client": path.resolve(
        __dirname,
        "./vendor/design-api-client/src/index.ts",
      ),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 17777,
  },
})
