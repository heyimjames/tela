import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Kept in step with vite.config.ts and tsconfig — see vendor/design-api-client/SOURCE.md.
      '@performance-clickt/design-api-client': fileURLToPath(
        new URL('./vendor/design-api-client/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    // The portable-source layer is deliberately DOM-free, so it runs on plain Node.
    // Anything that needs a document belongs in a Playwright test, not here.
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
