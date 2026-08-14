/**
 * The server factory.
 *
 * **`buildServer()` is side-effect-free.** It registers tools and resources and
 * returns. It does not touch the filesystem, does not start the loopback server,
 * does not launch a browser, and does not read the approved root. That is a hard
 * requirement rather than a style preference: a modern client may construct a
 * disposable server purely to read the tool list during discovery, and a factory
 * with side effects would launch Chromium — or fail on a missing root — just to
 * answer `tools/list`.
 *
 * Everything expensive is lazy, behind the first tool call that genuinely needs it.
 */

import { McpServer } from '@modelcontextprotocol/server'

import { SERVER_NAME, SERVER_VERSION } from './identity'
import { registerResources } from './resources'
import { resetRegisteredToolNames } from './tooling'
import { registerRuntimeTools } from './tools/runtime'
import { registerLifecycleTools } from './tools/lifecycle'
import { registerStructureTools } from './tools/structure'
import { registerLayerTools } from './tools/layers'
import { registerAssetTools } from './tools/assets'
import { registerOutputTools } from './tools/output'

const INSTRUCTIONS = `Tela authors finite editable static assets — campaign graphics, ad images, social graphics, and their format variants. Video belongs in Shotcut; landing pages, prototypes, and app UI belong in OpenDesign.

The master artifact is a .tela bundle on disk. Every path you pass is relative to an approved root; absolute paths are refused.

The normal loop:
1. tela_open_design (or tela_create_design) — note the session_revision and disk_revision it returns.
2. tela_get_design_summary, then tela_get_scene for the frame you are editing, to learn the ids.
3. Mutate with the tela_* authoring tools, passing expected_session_revision from the previous result each time.
4. tela_render_preview to see what you made.
5. tela_save_design with both expected_session_revision and expected_disk_revision.

Every mutation returns the next session_revision, so the value you need is always in the result you just received. A revision mismatch means someone else changed the design: re-read before retrying rather than forcing the write.

Nothing is permanently deleted. Every tela_archive_* tool moves content to a managed trash under the approved root.

This server makes no network requests of any kind.`

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {}, logging: {} },
      instructions: INSTRUCTIONS,
    },
  )

  // The registry is per-build so `tela_get_capabilities` reports this server's
  // tools rather than an accumulation across every server built in the process
  // (which is exactly what a test suite does).
  resetRegisteredToolNames()

  registerRuntimeTools(server)
  registerLifecycleTools(server)
  registerStructureTools(server)
  registerLayerTools(server)
  registerAssetTools(server)
  registerOutputTools(server)
  registerResources(server)

  return server
}
