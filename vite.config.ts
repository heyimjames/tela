import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tela is a standalone Vite SPA. It builds to ./dist and can be served
// from any static host. To embed it under a sub-path (e.g. an iframe at
// /studio/canvas), set `base` to that path.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
