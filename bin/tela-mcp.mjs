#!/usr/bin/env node
/**
 * Launcher for the Tela Design MCP server.
 *
 * Both host manifests point at this file with a bare `node` command, so it must
 * stay a plain ESM module with no build step of its own. All it does is load the
 * compiled server, which starts itself.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const compiled = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/mcp/tela-mcp.mjs')

if (!existsSync(compiled)) {
  // stderr, never stdout: stdout is the JSON-RPC channel and a human-readable
  // line here would corrupt the very first frame the client tries to parse.
  process.stderr.write(
    'tela-design-mcp-server: dist/mcp/tela-mcp.mjs is missing. Run `npm run build` in the payload before launching.\n',
  )
  process.exit(1)
}

// `pathToFileURL`, not the bare path. A dynamic import specifier is a URL, and
// on Windows an absolute path begins with a drive letter — `D:\...` — which the
// ESM loader reads as the URL scheme `d:` and rejects with
// ERR_UNSUPPORTED_ESM_URL_SCHEME before any of our code runs. On POSIX the bare
// path happens to work, which is exactly why this is easy to ship broken: the
// server appears fine everywhere it is developed and fails to start on every
// Windows host.
await import(pathToFileURL(compiled).href)
