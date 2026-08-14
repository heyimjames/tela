/**
 * Runtime and inspection tools: the read-only half of the surface.
 *
 * All ten are `readOnlyHint: true`, `openWorldHint: false` — they read local
 * state and reach nowhere. All of them accept `response_format`, and the four
 * that return sequences paginate.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { AD_FORMATS } from '../../brand/formats'
import { DESIGN_TEMPLATES } from '../../brand/templates'
import { DESIGN_LAYOUTS } from '../../brand/layouts'
import { CURRENT_BUNDLE_SCHEMA_VERSION, CURRENT_DOCUMENT_SCHEMA_VERSION, SUPPORTED_ASSET_MIME } from '../../tela/schema'
import { PRODUCER } from '../../tela/producer'
import { EXTERNAL_ID, MCP_BUILDER_PROVENANCE, SERVER_NAME, SERVER_VERSION } from '../identity'
import { bridgeStatus } from '../bridge/browser'
import { approvedRoot } from '../paths'
import { markdownRecord, markdownTable, pageText, paginate, paginationInputShape, paginationOutputShape, responseFormatSchema } from '../format'
import { listDesigns, listOpenSessions, readSession, requireSession, validateDocument } from '../sessions'
import { requireFrame } from '../documentOps'
import { buildRefIndex, toPortableRefs } from '../assetRefs'
import { assertDocumentInvariants } from '../../tela/invariants'
import { defineTool, READ_ONLY, registeredToolNames } from '../tooling'
import { designArg, frameArg } from './common'

export function registerRuntimeTools(server: McpServer): void {
  defineTool(server, {
    name: 'tela_get_status',
    title: 'Get runtime status',
    description:
      'Report whether the Tela runtime is ready: server identity, the approved root every path is confined to, whether the private browser bridge has been started, and which designs are currently open. Safe to call first; it never starts the browser.',
    inputSchema: z.strictObject({ response_format: responseFormatSchema }),
    outputSchema: z.strictObject({
      server_name: z.string(),
      external_id: z.string(),
      version: z.string(),
      node_version: z.string(),
      approved_root_configured: z.boolean().describe('True when TELA_APPROVED_ROOT is set explicitly rather than defaulted.'),
      bridge_running: z.boolean().describe('False until the first tool call that needs a browser. Rendering starts it lazily.'),
      open_designs: z.array(z.strictObject({ design: z.string(), session_revision: z.int(), unsaved_changes: z.boolean() })),
      ready: z.boolean(),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      // The root's *value* is deliberately not returned: it is an absolute path,
      // and this surface never emits one. Whether it was configured is the part
      // a caller can act on.
      let rootOk = true
      try {
        approvedRoot()
      } catch {
        rootOk = false
      }
      const data = {
        server_name: SERVER_NAME,
        external_id: EXTERNAL_ID,
        version: SERVER_VERSION,
        node_version: process.versions.node,
        approved_root_configured: Boolean(process.env.TELA_APPROVED_ROOT),
        bridge_running: bridgeStatus().running,
        open_designs: listOpenSessions().map((session) => ({
          design: session.design,
          session_revision: session.sessionRevision,
          unsaved_changes: session.dirty,
        })),
        ready: rootOk,
      }
      return {
        data,
        text: args.response_format === 'markdown' ? `### Tela runtime\n\n${markdownRecord(data)}` : JSON.stringify(data),
      }
    },
  })

  defineTool(server, {
    name: 'tela_get_capabilities',
    title: 'Get server capabilities',
    description:
      'Report what this build can do: the tool names it exposes, the export formats it produces, the schema versions it reads and writes, and the asset types it accepts. Use it to check a capability before relying on it rather than discovering the gap mid-workflow.',
    inputSchema: z.strictObject({ response_format: responseFormatSchema }),
    outputSchema: z.strictObject({
      tools: z.array(z.string()),
      export_formats: z.array(z.string()),
      layer_types: z.array(z.string()),
      asset_mime_types: z.array(z.string()),
      document_schema_version: z.int(),
      bundle_schema_version: z.int(),
      producer: z.strictObject({ name: z.string(), version: z.string(), source_commit: z.string() }),
      methodology: z.strictObject({ url: z.string(), commit: z.string(), license: z.string(), role: z.string() }),
      network_access: z.literal('none'),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const data = {
        tools: registeredToolNames(),
        export_formats: ['png', 'jpg', 'webp', 'svg'],
        layer_types: ['background', 'text', 'image', 'svg', 'shape', 'gradient', 'group', 'draw'],
        asset_mime_types: [...SUPPORTED_ASSET_MIME],
        document_schema_version: CURRENT_DOCUMENT_SCHEMA_VERSION,
        bundle_schema_version: CURRENT_BUNDLE_SCHEMA_VERSION,
        producer: { name: PRODUCER.name, version: PRODUCER.version, source_commit: PRODUCER.sourceCommit },
        methodology: { ...MCP_BUILDER_PROVENANCE },
        network_access: 'none' as const,
      }
      return {
        data,
        text: args.response_format === 'markdown' ? `### Capabilities\n\n${markdownRecord(data)}` : JSON.stringify(data),
      }
    },
  })

  defineTool(server, {
    name: 'tela_list_designs',
    title: 'List designs',
    description:
      'List every .tela design under the approved root, newest-path-first, with size and whether it is currently open. Filter with `contains`. Paginated.',
    inputSchema: z.strictObject({
      contains: z.string().max(200).optional().describe('Case-insensitive substring filter on the design path.'),
      open_only: z.boolean().default(false).describe('Return only designs with an open editing session.'),
      response_format: responseFormatSchema,
      ...paginationInputShape,
    }),
    outputSchema: z.strictObject({
      designs: z.array(
        z.strictObject({
          design: z.string(),
          name: z.string(),
          bytes: z.int().nonnegative(),
          modified: z.string(),
          open: z.boolean(),
        }),
      ),
      ...paginationOutputShape(),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      let all = await listDesigns()
      if (args.contains) {
        const needle = args.contains.toLowerCase()
        all = all.filter((entry) => entry.design.toLowerCase().includes(needle))
      }
      if (args.open_only) all = all.filter((entry) => entry.open)
      const page = paginate(all, `designs:${args.contains ?? ''}:${args.open_only}`, args.limit, args.cursor)
      const data = { designs: page.items, has_more: page.has_more, ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}), total: page.total }
      return {
        data,
        text: pageText(args.response_format, 'Designs', ['design', 'name', 'bytes', 'modified', 'open'], { ...page, items: page.items as never }),
      }
    },
  })

  defineTool(server, {
    name: 'tela_get_design_summary',
    title: 'Get design summary',
    description:
      'Structural overview of an open design: its pages, the frames on each with their formats and layer counts, the active page and frame, and the session and disk revisions you need for the next mutation. Start here before editing anything.',
    inputSchema: z.strictObject({ design: designArg, response_format: responseFormatSchema }),
    outputSchema: z.strictObject({
      design: z.string(),
      name: z.string(),
      session_revision: z.int(),
      disk_revision: z.string(),
      unsaved_changes: z.boolean(),
      active_page_id: z.string(),
      active_frame_id: z.string().nullable(),
      migrations_applied: z.array(z.string()),
      pages: z.array(
        z.strictObject({
          page_id: z.string(),
          name: z.string(),
          loose_element_count: z.int().nonnegative(),
          frames: z.array(
            z.strictObject({
              frame_id: z.string(),
              name: z.string(),
              format_id: z.string(),
              width: z.number(),
              height: z.number(),
              layer_count: z.int().nonnegative(),
              locked: z.boolean(),
              visible: z.boolean(),
            }),
          ),
        }),
      ),
      counts: z.strictObject({
        pages: z.int().nonnegative(),
        frames: z.int().nonnegative(),
        layers: z.int().nonnegative(),
        assets: z.int().nonnegative(),
        fonts: z.int().nonnegative(),
        versions: z.int().nonnegative(),
      }),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const session = requireSession(args.design)
      const document = await readSession(args.design, (current) => current)
      const pages = document.pages.map((page) => ({
        page_id: page.id,
        name: page.name,
        loose_element_count: page.looseElements.length,
        frames: page.frames.map((frame) => ({
          frame_id: frame.id,
          name: frame.name,
          format_id: frame.format.id,
          width: frame.width,
          height: frame.height,
          layer_count: frame.layers.length,
          locked: frame.locked,
          visible: frame.visible,
        })),
      }))
      const data = {
        design: session.design,
        name: document.name,
        session_revision: session.sessionRevision,
        disk_revision: session.diskRevision,
        unsaved_changes: session.dirty,
        active_page_id: document.activePageId,
        active_frame_id: document.activeFrameId,
        migrations_applied: session.migrationsApplied,
        pages,
        counts: {
          pages: document.pages.length,
          frames: pages.reduce((sum, page) => sum + page.frames.length, 0),
          layers: document.pages.reduce((sum, page) => sum + page.frames.reduce((inner, frame) => inner + frame.layers.length, 0), 0),
          assets: document.assets.length,
          fonts: document.fonts.length,
          versions: document.versions.length,
        },
      }
      const text =
        args.response_format === 'markdown'
          ? `### ${document.name}\n\nSession revision **${session.sessionRevision}**${session.dirty ? ' — unsaved changes' : ''}\n\n` +
            pages
              .map(
                (page) =>
                  `#### Page ${page.name} (\`${page.page_id}\`)\n\n` +
                  markdownTable(['frame_id', 'name', 'format_id', 'width', 'height', 'layer_count'], page.frames as never),
              )
              .join('\n\n')
          : JSON.stringify(data)
      return { data, text }
    },
  })

  defineTool(server, {
    name: 'tela_get_scene',
    title: 'Get frame scene',
    description:
      'Read one frame in full: its geometry, background, auto-layouts, and every layer with its type, box, and type-specific properties. This is how you find layer ids before updating them. Layers paginate for very dense frames.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: frameArg,
      include_layer_detail: z.boolean().default(true).describe('Include every persisted property of each layer. Set false for a compact index of ids, types, names, and boxes.'),
      response_format: responseFormatSchema,
      ...paginationInputShape,
    }),
    outputSchema: z.strictObject({
      design: z.string(),
      frame: z.strictObject({
        frame_id: z.string(),
        name: z.string(),
        page_id: z.string(),
        format_id: z.string(),
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
        locked: z.boolean(),
        visible: z.boolean(),
        background_fill: z.unknown(),
        auto_layouts: z.record(z.string(), z.unknown()),
      }),
      layers: z.array(z.record(z.string(), z.unknown())),
      session_revision: z.int(),
      ...paginationOutputShape(),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const session = requireSession(args.design)
      const document = await readSession(args.design, (current) => current)
      const { page, frame } = requireFrame(document, args.frame_id)
      // Portable refs on the way out: a client never sees a payload, and a
      // layer read here is byte-for-byte what it can pass back in.
      const index = buildRefIndex(document)
      const ordered = toPortableRefs([...frame.layers].sort((a, b) => a.zIndex - b.zIndex), index)
      const projected = ordered.map((layer) =>
        args.include_layer_detail
          ? (layer as unknown as Record<string, unknown>)
          : { id: layer.id, type: layer.type, name: layer.name, x: layer.x, y: layer.y, width: layer.width, height: layer.height, zIndex: layer.zIndex, visible: layer.visible },
      )
      const pageResult = paginate(projected, `scene:${args.design}:${args.frame_id}:${args.include_layer_detail}`, args.limit, args.cursor)
      const data = {
        design: session.design,
        frame: {
          frame_id: frame.id,
          name: frame.name,
          page_id: page.id,
          format_id: frame.format.id,
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          locked: frame.locked,
          visible: frame.visible,
          background_fill: toPortableRefs(frame.backgroundFill, index),
          auto_layouts: frame.autoLayouts ?? {},
        },
        layers: pageResult.items,
        session_revision: session.sessionRevision,
        has_more: pageResult.has_more,
        ...(pageResult.next_cursor ? { next_cursor: pageResult.next_cursor } : {}),
        total: pageResult.total,
      }
      const text =
        args.response_format === 'markdown'
          ? `### Frame ${frame.name} (\`${frame.id}\`) — ${frame.format.id} ${frame.width}×${frame.height}\n\n` +
            markdownTable(['id', 'type', 'name', 'x', 'y', 'width', 'height', 'zIndex'], pageResult.items as never)
          : JSON.stringify(data)
      return { data, text }
    },
  })

  defineTool(server, {
    name: 'tela_validate_design',
    title: 'Validate design',
    description:
      'Check an open design against the portable schema and its structural invariants, and report every violation with the field path that caused it. Call this when a mutation was refused and you need to know the design\'s actual state.',
    inputSchema: z.strictObject({ design: designArg, response_format: responseFormatSchema }),
    outputSchema: z.strictObject({
      design: z.string(),
      valid: z.boolean(),
      schema_issues: z.array(z.string()),
      invariant_issue: z.string().nullable(),
      session_revision: z.int(),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const session = requireSession(args.design)
      const document = await readSession(args.design, (current) => current)
      const schemaResult = validateDocument(document)
      let invariantIssue: string | null = null
      try {
        assertDocumentInvariants(document)
      } catch (cause) {
        invariantIssue = cause instanceof Error ? cause.message : String(cause)
      }
      const data = {
        design: session.design,
        valid: schemaResult.valid && invariantIssue === null,
        schema_issues: schemaResult.issues,
        invariant_issue: invariantIssue,
        session_revision: session.sessionRevision,
      }
      const text =
        args.response_format === 'markdown'
          ? data.valid
            ? `**${session.design}** is valid at session revision ${session.sessionRevision}.`
            : `### Validation failed\n\n${[...data.schema_issues, ...(invariantIssue ? [invariantIssue] : [])].map((issue) => `- ${issue}`).join('\n')}`
          : JSON.stringify(data)
      return { data, text }
    },
  })

  defineTool(server, {
    name: 'tela_list_templates',
    title: 'List templates',
    description: 'List the built-in design templates a new design can start from, with their category and native format. Pass a template id to tela_create_design.',
    inputSchema: z.strictObject({
      category: z.enum(['hiring', 'employer-brand', 'event', 'testimonial', 'general']).optional().describe('Filter by category.'),
      response_format: responseFormatSchema,
      ...paginationInputShape,
    }),
    outputSchema: z.strictObject({
      templates: z.array(z.strictObject({ template_id: z.string(), name: z.string(), category: z.string(), description: z.string(), format_id: z.string() })),
      ...paginationOutputShape(),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const all = DESIGN_TEMPLATES.filter((template) => !args.category || template.category === args.category).map((template) => ({
        template_id: template.id,
        name: template.name,
        category: template.category,
        description: template.description,
        format_id: template.formatId,
      }))
      const page = paginate(all, `templates:${args.category ?? ''}`, args.limit, args.cursor)
      return {
        data: { templates: page.items, has_more: page.has_more, ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}), total: page.total },
        text: pageText(args.response_format, 'Templates', ['template_id', 'name', 'category', 'format_id'], page as never),
      }
    },
  })

  defineTool(server, {
    name: 'tela_list_layouts',
    title: 'List layouts',
    description:
      'List the built-in compositions that can be applied to a frame with tela_apply_layout. A layout drops well-placed placeholder layers sized to the frame, which you then fill in.',
    inputSchema: z.strictObject({
      fits: z.enum(['any', 'landscape', 'portrait', 'square']).optional().describe('Filter to layouts designed for this aspect.'),
      response_format: responseFormatSchema,
      ...paginationInputShape,
    }),
    outputSchema: z.strictObject({
      layouts: z.array(z.strictObject({ layout_id: z.string(), name: z.string(), description: z.string(), fits: z.string() })),
      ...paginationOutputShape(),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const all = DESIGN_LAYOUTS.filter((layout) => !args.fits || layout.fits === args.fits).map((layout) => ({
        layout_id: layout.id,
        name: layout.name,
        description: layout.description,
        fits: layout.fits,
      }))
      const page = paginate(all, `layouts:${args.fits ?? ''}`, args.limit, args.cursor)
      return {
        data: { layouts: page.items, has_more: page.has_more, ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}), total: page.total },
        text: pageText(args.response_format, 'Layouts', ['layout_id', 'name', 'fits', 'description'], page as never),
      }
    },
  })

  defineTool(server, {
    name: 'tela_list_assets',
    title: 'List assets',
    description:
      'List the images, SVGs, icons, and fonts a design carries, with their content hashes and sizes. Payloads are never returned — an asset is referenced by `asset://<sha256>`, which is what you put on a layer.',
    inputSchema: z.strictObject({
      design: designArg,
      kind: z.enum(['all', 'image', 'svg', 'icon', 'font']).default('all').describe('Filter by asset kind. Fonts are listed separately from images.'),
      response_format: responseFormatSchema,
      ...paginationInputShape,
    }),
    outputSchema: z.strictObject({
      assets: z.array(
        z.strictObject({
          asset_id: z.string(),
          name: z.string(),
          kind: z.string(),
          category: z.string(),
          ref: z.string().describe('asset://<sha256>, or empty for an asset whose payload is not yet packed.'),
          width: z.number().optional(),
          height: z.number().optional(),
          created_at: z.string(),
          license: z.string().optional().describe('Fonts only. Every imported font records its licence.'),
        }),
      ),
      ...paginationOutputShape(),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const document = await readSession(args.design, (current) => current)
      const images = document.assets.map((asset) => ({
        asset_id: asset.id,
        name: asset.name,
        kind: asset.type,
        category: asset.category,
        ref: refOf(asset.ref),
        ...(asset.width !== undefined ? { width: asset.width } : {}),
        ...(asset.height !== undefined ? { height: asset.height } : {}),
        created_at: asset.createdAt,
      }))
      const fonts = document.fonts.map((font) => ({
        asset_id: font.id,
        name: `${font.family} ${font.weight}${font.style === 'italic' ? ' italic' : ''}`,
        kind: 'font',
        category: 'fonts',
        ref: refOf(font.ref),
        created_at: font.createdAt,
        license: font.license,
      }))
      const combined = [...images, ...fonts].filter((asset) => args.kind === 'all' || asset.kind === args.kind)
      const page = paginate(combined, `assets:${args.design}:${args.kind}`, args.limit, args.cursor)
      return {
        data: { assets: page.items, has_more: page.has_more, ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}), total: page.total },
        text: pageText(args.response_format, 'Assets', ['asset_id', 'name', 'kind', 'ref'], page as never),
      }
    },
  })

  defineTool(server, {
    name: 'tela_list_versions',
    title: 'List saved versions',
    description: 'List the named snapshots saved inside a design, newest last. Restore one with tela_restore_version.',
    inputSchema: z.strictObject({ design: designArg, response_format: responseFormatSchema, ...paginationInputShape }),
    outputSchema: z.strictObject({
      versions: z.array(
        z.strictObject({
          version_id: z.string(),
          name: z.string(),
          created_at: z.string(),
          source_frame_id: z.string().describe('The frame this snapshot was captured from; tela_restore_version targets it by default.'),
          format_id: z.string(),
          layer_count: z.int().nonnegative(),
        }),
      ),
      ...paginationOutputShape(),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const document = await readSession(args.design, (current) => current)
      const all = document.versions.map((version) => ({
        version_id: version.id,
        name: version.name,
        created_at: version.createdAt,
        source_frame_id: version.document.id,
        format_id: version.document.format.id,
        layer_count: version.document.layers.length,
      }))
      const page = paginate(all, `versions:${args.design}`, args.limit, args.cursor)
      return {
        data: { versions: page.items, has_more: page.has_more, ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}), total: page.total },
        text: pageText(args.response_format, 'Saved versions', ['version_id', 'name', 'created_at', 'format_id', 'layer_count'], page as never),
      }
    },
  })
}

/**
 * A session holds payloads inline as `data:` URLs; the file holds
 * `asset://<sha>`. Listing the inline form would emit the whole payload, so
 * only the portable form is ever reported.
 */
function refOf(ref: string): string {
  return ref.startsWith('asset://') ? ref : ''
}

/** Re-exported so the resource layer can advertise the same catalogues. */
export { AD_FORMATS }
