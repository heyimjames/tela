/**
 * Server identity.
 *
 * `SERVER_NAME` is what the MCP handshake advertises; `EXTERNAL_ID` is the
 * registered plugin/server id both hosts use in their manifests. They are
 * deliberately different strings and deliberately *not* `tela`: the user's
 * already-registered local `tela` server is the unrelated Pyrito Wiki, and
 * colliding with it would silently shadow a working integration.
 */

export const SERVER_NAME = 'tela-design-mcp-server'
export const EXTERNAL_ID = 'clickt-tela-design'
export const SERVER_VERSION = '0.1.1'

/**
 * Provenance for Anthropic's `mcp-builder` skill, which was used as *design and
 * evaluation methodology only*. It is not a dependency of this runtime and must
 * never become one; this constant exists so the attribution ships with the
 * artifact rather than living only in a commit message.
 */
export const MCP_BUILDER_PROVENANCE = {
  url: 'https://github.com/anthropics/skills/tree/f6656c1256d5a8adfa37db9110046ef20bac644c/skills/mcp-builder',
  commit: 'f6656c1256d5a8adfa37db9110046ef20bac644c',
  license: 'Apache-2.0',
  role: 'build-time methodology; not a runtime dependency',
} as const
