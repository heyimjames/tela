/**
 * Resources: stable read surfaces.
 *
 * Deliberately limited to things that are *stable and referenceable* — the
 * portable schema, the format and template and layout catalogues, and a status
 * snapshot. Anything per-design is a tool, not a resource: designs are
 * parameterized and mutable, and modelling them as resources would mean either
 * an unbounded URI space or a cache that lies.
 *
 * Workflow prompts are not registered here. They live in the shared plugin skill
 * so Codex and Claude Code get the same orchestration from one source; putting
 * them in the server would fork that guidance per host.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { AD_FORMATS } from '../brand/formats'
import { DESIGN_TEMPLATES } from '../brand/templates'
import { DESIGN_LAYOUTS } from '../brand/layouts'
import { CURRENT_BUNDLE_SCHEMA_VERSION, CURRENT_DOCUMENT_SCHEMA_VERSION, DOCUMENT_SCHEMA_ID, SUPPORTED_ASSET_MIME, telaDocumentSchema } from '../tela/schema'
import { PRODUCER } from '../tela/producer'
import { EXTERNAL_ID, SERVER_NAME, SERVER_VERSION } from './identity'
import { bridgeStatus } from './bridge/browser'
import { listOpenSessions } from './sessions'

const JSON_MIME = 'application/json'

export function registerResources(server: McpServer): void {
  server.registerResource(
    'status',
    'tela://status',
    {
      title: 'Pyrito Design runtime status',
      description: 'Server identity, whether the browser bridge is running, and which designs are open. The same data tela_get_status returns.',
      mimeType: JSON_MIME,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: JSON_MIME,
          text: JSON.stringify(
            {
              server_name: SERVER_NAME,
              external_id: EXTERNAL_ID,
              version: SERVER_VERSION,
              node_version: process.versions.node,
              bridge_running: bridgeStatus().running,
              open_designs: listOpenSessions().map((session) => ({
                design: session.design,
                session_revision: session.sessionRevision,
                unsaved_changes: session.dirty,
              })),
            },
            null,
            2,
          ),
        },
      ],
    }),
  )

  server.registerResource(
    'portable-schema',
    'tela://schema/portable/v1',
    {
      title: 'Portable .tela document schema v1',
      description: 'JSON Schema for the document inside a .tela bundle: pages, frames, all eight layer types, auto-layouts, versions, brand context, assets, and fonts.',
      mimeType: 'application/schema+json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/schema+json',
          // Generated from the same zod schema the reader and writer enforce, so
          // the published contract cannot drift from the enforced one.
          text: JSON.stringify(
            {
              $schema: 'https://json-schema.org/draft/2020-12/schema',
              $id: DOCUMENT_SCHEMA_ID,
              title: 'Pyrito Design portable document v1',
              'x-document-schema-version': CURRENT_DOCUMENT_SCHEMA_VERSION,
              'x-bundle-schema-version': CURRENT_BUNDLE_SCHEMA_VERSION,
              'x-producer': PRODUCER,
              'x-supported-asset-mime': SUPPORTED_ASSET_MIME,
              ...toJsonSchema(),
            },
            null,
            2,
          ),
        },
      ],
    }),
  )

  server.registerResource(
    'formats',
    'tela://formats',
    {
      title: 'Ad formats',
      description: 'Every ad format a frame can use, with platform, pixel dimensions, and aspect ratio. Format ids are what tela_add_frame and tela_generate_format_variants accept.',
      mimeType: JSON_MIME,
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: JSON_MIME, text: JSON.stringify(AD_FORMATS, null, 2) }],
    }),
  )

  server.registerResource(
    'templates',
    'tela://templates',
    {
      title: 'Design templates',
      description: 'Built-in starting points for a new design, with category, description, and native format. Pass a template id to tela_create_design.',
      mimeType: JSON_MIME,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: JSON_MIME,
          text: JSON.stringify(
            // `create()` is not called: it mints a whole document with fresh ids,
            // and a resource read must be cheap and side-effect-free.
            DESIGN_TEMPLATES.map((template) => ({
              id: template.id,
              name: template.name,
              category: template.category,
              description: template.description,
              formatId: template.formatId,
            })),
            null,
            2,
          ),
        },
      ],
    }),
  )

  server.registerResource(
    'layouts',
    'tela://layouts',
    {
      title: 'Design layouts',
      description: 'Built-in compositions that can be applied to a frame with tela_apply_layout. Each adapts to the frame\'s dimensions; `fits` names the aspect it was designed for.',
      mimeType: JSON_MIME,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: JSON_MIME,
          text: JSON.stringify(
            DESIGN_LAYOUTS.map((layout) => ({ id: layout.id, name: layout.name, description: layout.description, fits: layout.fits })),
            null,
            2,
          ),
        },
      ],
    }),
  )
}

/**
 * Convert the zod document schema to JSON Schema.
 *
 * Wrapped because a conversion failure must not take the resource down: a
 * best-effort descriptor beats a broken read, and the authoritative contract is
 * the zod schema either way.
 */
function toJsonSchema(): Record<string, unknown> {
  try {
    return z.toJSONSchema(telaDocumentSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  } catch {
    return { type: 'object', description: 'JSON Schema conversion unavailable in this build; the zod schema in src/tela/schema.ts is authoritative.' }
  }
}
