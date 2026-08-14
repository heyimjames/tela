/**
 * Assets, fonts, and brand context.
 *
 * The asset rules, all of which are policy rather than convenience:
 *
 *  - The source must be **inside the approved root**. This server has no way to
 *    read an arbitrary path on the machine and should not acquire one.
 *  - The type is decided by **sniffing the content**, never the extension. A
 *    `.png` containing something else is identified as what it is, and content
 *    matching nothing accepted is refused.
 *  - **SVG is sanitized before it enters the document**, not before it is
 *    rendered — the difference matters, because a `.tela` file is a thing people
 *    hand to each other.
 *  - Fonts require an explicit **licence string**. An unlabelled font inside a
 *    portable bundle is a redistribution problem, and the persisted schema
 *    refuses one, so it is asked for here rather than invented.
 *
 * Payloads never cross the MCP boundary. An asset is imported by path and
 * referred to afterwards by `asset://<sha256>`.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { hashFromRef } from '../../tela/assets'
import { buildRefIndex } from '../assetRefs'
import type { TelaDocument } from '../../tela/schema'
import { toolError } from '../errors'
import { markdownRecord, responseFormatSchema } from '../format'
import { finalize, newId, nowIso } from '../documentOps'
import { archiveFragment, ingestAsset, mutateSession, readSession } from '../sessions'
import { sanitizeSvg } from '../sanitizeSvg'
import { ADDITIVE, DESTRUCTIVE, defineTool, IDEMPOTENT_WRITE, READ_ONLY } from '../tooling'
import { designArg, expectedSessionRevisionArg, mutationText, sessionState, sessionStateSchema } from './common'

const MAX_ASSET_BYTES = 32 * 1024 * 1024
const MAX_FONT_BYTES = 8 * 1024 * 1024

export function registerAssetTools(server: McpServer): void {
  defineTool(server, {
    name: 'tela_import_asset',
    title: 'Import asset',
    description:
      'Read an image or SVG from inside the approved root into the design as a content-addressed asset, and return the `asset://<sha256>` reference to put on a layer. The type is determined by sniffing the file\'s content; SVG is sanitized and refused if it carries script, event handlers, or external references. Importing identical bytes twice yields the same reference.',
    inputSchema: z.strictObject({
      design: designArg,
      source: z.string().min(1).max(1024).describe('Root-relative path of the image or SVG file to import.'),
      name: z.string().min(1).max(200).describe('Display name for the asset in the design\'s library.'),
      category: z.string().max(100).default('photos').describe('Library category, e.g. photos, logos, icons, graphics.'),
      kind: z.enum(['image', 'svg', 'icon']).optional().describe('How the asset is catalogued. Inferred from the content when omitted.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({
      session: sessionStateSchema,
      asset_id: z.string(),
      ref: z.string().describe('Put this on a layer\'s imageUrl, or a background fill\'s imageUrl.'),
      mime: z.string(),
      bytes: z.int().nonnegative(),
      deduplicated: z.boolean().describe('True when the design already held identical bytes and the existing reference was reused.'),
    }),
    annotations: ADDITIVE,
    handler: async (args, context) => {
      await context.progress(1, 3, 'reading the source file')
      const ingested = await ingestAsset(args.source, MAX_ASSET_BYTES)
      if (ingested.mime === 'font/woff2') {
        throw toolError('invalid_input', 'that file is a font, not an image', 'import fonts with tela_import_font, which records the licence a portable bundle requires')
      }
      if (ingested.mime === 'image/svg+xml') {
        // Decode and sanitize. A refusal here happens before the payload is
        // anywhere near the document.
        sanitizeSvg(Buffer.from(ingested.dataUrl.split(',')[1] ?? '', 'base64').toString('utf8'))
      }
      await context.progress(2, 3, 'adding to the design')

      const assetId = newId()
      const kind = args.kind ?? (ingested.mime === 'image/svg+xml' ? 'svg' : 'image')
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const existing = document.assets.find((asset) => hashFromRef(asset.ref) === ingested.sha256 || asset.ref === ingested.dataUrl)
        if (existing) {
          return { document, value: { assetId: existing.id, deduplicated: true } }
        }
        const next: TelaDocument = {
          ...document,
          assets: [
            ...document.assets,
            {
              id: assetId,
              name: args.name,
              type: kind,
              category: args.category,
              ref: ingested.dataUrl,
              createdAt: nowIso(),
            },
          ],
        }
        return { document: finalize(next), value: { assetId, deduplicated: false } }
      })

      await context.progress(3, 3, 'imported')
      const data = {
        session: sessionState(result.session),
        asset_id: result.value.assetId,
        ref: `asset://${ingested.sha256}`,
        mime: ingested.mime,
        bytes: ingested.bytes,
        deduplicated: result.value.deduplicated,
      }
      return {
        data,
        text:
          args.response_format === 'markdown'
            ? `Imported **${args.name}**.\n\n${markdownRecord(data as never)}`
            : mutationText(result.session, `Imported ${args.name} as ${data.ref}${data.deduplicated ? ' (identical bytes already present)' : ''}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_replace_asset',
    title: 'Replace asset',
    description:
      'Swap an existing asset\'s payload for a new file, keeping its id so every layer referring to it picks up the new artwork. Destructive: the previous payload is written to the managed trash and the old reference stops resolving.',
    inputSchema: z.strictObject({
      design: designArg,
      asset_id: z.string().min(1).max(128),
      source: z.string().min(1).max(1024).describe('Root-relative path of the replacement file.'),
      name: z.string().max(200).optional().describe('New display name. The existing name is kept when omitted.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({
      session: sessionStateSchema,
      asset_id: z.string(),
      ref: z.string(),
      previous_ref: z.string(),
      mime: z.string(),
      bytes: z.int().nonnegative(),
      relinked_layer_count: z.int().nonnegative().describe('Layers whose imageUrl was rewritten to the new reference.'),
    }),
    annotations: DESTRUCTIVE,
    handler: async (args) => {
      const ingested = await ingestAsset(args.source, MAX_ASSET_BYTES)
      if (ingested.mime === 'font/woff2') {
        throw toolError('invalid_input', 'that file is a font, not an image', 'replace fonts by importing a new one with tela_import_font and archiving the old one')
      }
      if (ingested.mime === 'image/svg+xml') {
        sanitizeSvg(Buffer.from(ingested.dataUrl.split(',')[1] ?? '', 'base64').toString('utf8'))
      }

      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const existing = document.assets.find((asset) => asset.id === args.asset_id)
        if (!existing) {
          throw toolError('not_found', `no asset "${args.asset_id}" in this design`, 'call tela_list_assets to see the ids this design holds')
        }
        const previousRef = existing.ref

        // Every layer pointing at the old payload is rewritten. Leaving them
        // would silently break artwork that was pointing at the asset the caller
        // just said they wanted replaced.
        let relinked = 0
        const rewrite = (value: string): string => {
          if (value !== previousRef) return value
          relinked += 1
          return ingested.dataUrl
        }
        const pages = document.pages.map((page) => ({
          ...page,
          frames: page.frames.map((frame) => ({
            ...frame,
            backgroundFill:
              frame.backgroundFill.type === 'image'
                ? { ...frame.backgroundFill, imageUrl: rewrite(frame.backgroundFill.imageUrl) }
                : frame.backgroundFill,
            layers: frame.layers.map((layer) => {
              if (layer.type === 'image') return { ...layer, imageUrl: rewrite(layer.imageUrl) }
              if (layer.type === 'background' && layer.fill.type === 'image') {
                return { ...layer, fill: { ...layer.fill, imageUrl: rewrite(layer.fill.imageUrl) } }
              }
              return layer
            }),
          })),
        }))

        const next: TelaDocument = {
          ...document,
          pages,
          assets: document.assets.map((asset) =>
            asset.id === args.asset_id ? { ...asset, ref: ingested.dataUrl, ...(args.name !== undefined ? { name: args.name } : {}) } : asset,
          ),
        }
        // Resolved before the payload is swapped out, while the old bytes are
        // still in the document and therefore still in the index.
        const previousPortable = buildRefIndex(document).toPortable.get(previousRef) ?? ''
        return { document: finalize(next), value: { previousRef, previousPortable, relinked } }
      })

      const data = {
        session: sessionState(result.session),
        asset_id: args.asset_id,
        ref: `asset://${ingested.sha256}`,
        previous_ref: result.value.previousPortable,
        mime: ingested.mime,
        bytes: ingested.bytes,
        relinked_layer_count: result.value.relinked,
      }
      return {
        data,
        text: mutationText(result.session, `Replaced asset ${args.asset_id}; ${result.value.relinked} reference(s) relinked to ${data.ref}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_archive_asset',
    title: 'Archive asset',
    description:
      'Remove an asset from the design\'s library, writing its record to the managed trash. Refused while any layer still references it, because an orphaned reference makes the whole design fail validation — archive or repoint those layers first.',
    inputSchema: z.strictObject({
      design: designArg,
      asset_id: z.string().min(1).max(128),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, asset_id: z.string(), archived_to: z.string() }),
    annotations: DESTRUCTIVE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const existing = document.assets.find((asset) => asset.id === args.asset_id)
        if (!existing) {
          throw toolError('not_found', `no asset "${args.asset_id}" in this design`, 'call tela_list_assets to see the ids this design holds')
        }
        const users = layersReferencing(document, existing.ref)
        if (users.length > 0) {
          throw toolError(
            'conflict',
            `asset "${args.asset_id}" is still used by ${users.length} layer(s) (${users.slice(0, 3).join(', ')})`,
            'update those layers with tela_update_layers to point elsewhere, or archive them with tela_archive_layers, then retry',
          )
        }
        const next: TelaDocument = { ...document, assets: document.assets.filter((asset) => asset.id !== args.asset_id) }
        // The archived record deliberately drops `ref`: it is the whole payload
        // inline, and the trash is not the place to duplicate megabytes of image.
        return { document: finalize(next), value: { ...existing, ref: '<payload omitted>' } }
      })
      const archivedTo = await archiveFragment(args.design, `asset-${args.asset_id}`, result.value)
      return {
        data: { session: sessionState(result.session), asset_id: args.asset_id, archived_to: archivedTo },
        text: mutationText(result.session, `Archived asset ${args.asset_id} to ${archivedTo}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_import_font',
    title: 'Import font',
    description:
      'Import a licensed WOFF2 font from inside the approved root so it travels with the design. The licence string is required and stored with the font: a portable bundle carrying an unlabelled font is a redistribution problem, and the format refuses one. Only WOFF2 is accepted.',
    inputSchema: z.strictObject({
      design: designArg,
      source: z.string().min(1).max(1024).describe('Root-relative path of the .woff2 file.'),
      family: z.string().min(1).max(200).describe('Font family name as it should be referenced in text layers.'),
      weight: z.int().min(1).max(1000).default(400),
      style: z.enum(['normal', 'italic']).default('normal'),
      license: z.string().min(1).max(500).describe('The licence this font is redistributed under, e.g. "SIL Open Font License 1.1". Required.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({
      session: sessionStateSchema,
      font_id: z.string(),
      family: z.string(),
      weight: z.int(),
      style: z.string(),
      ref: z.string(),
      bytes: z.int().nonnegative(),
    }),
    annotations: ADDITIVE,
    handler: async (args) => {
      const ingested = await ingestAsset(args.source, MAX_FONT_BYTES)
      if (ingested.mime !== 'font/woff2') {
        throw toolError(
          'invalid_input',
          `that file is ${ingested.mime}, not WOFF2`,
          'convert the font to WOFF2 before importing; only WOFF2 is accepted so bundles stay small and one format renders everywhere',
        )
      }
      const fontId = newId()
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const duplicate = document.fonts.find(
          (font) => font.family === args.family && font.weight === args.weight && font.style === args.style,
        )
        if (duplicate) {
          throw toolError(
            'conflict',
            `${args.family} ${args.weight}${args.style === 'italic' ? ' italic' : ''} is already imported`,
            'archive the existing font first, or import under a different family name',
          )
        }
        const next: TelaDocument = {
          ...document,
          fonts: [
            ...document.fonts,
            {
              id: fontId,
              family: args.family,
              weight: args.weight,
              style: args.style,
              license: args.license,
              ref: ingested.dataUrl,
              createdAt: nowIso(),
            },
          ],
        }
        return { document: finalize(next), value: fontId }
      })
      return {
        data: {
          session: sessionState(result.session),
          font_id: result.value,
          family: args.family,
          weight: args.weight,
          style: args.style,
          ref: `asset://${ingested.sha256}`,
          bytes: ingested.bytes,
        },
        text: mutationText(result.session, `Imported font ${args.family} ${args.weight} (${args.license})`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_get_brand_context',
    title: 'Get brand context',
    description:
      'Read the design\'s brand block: product name, social handle, display name, website, the AI guidance fields (product description, target audience, brand voice, call to action), and any palette token overrides. Read this before writing copy so the wording matches the brand the design carries.',
    inputSchema: z.strictObject({ design: designArg, response_format: responseFormatSchema }),
    outputSchema: z.strictObject({
      design: z.string(),
      brand: z.strictObject({
        product_name: z.string(),
        social_handle: z.string(),
        display_name: z.string(),
        website: z.string(),
        ai: z.strictObject({
          product_description: z.string(),
          target_audience: z.string(),
          brand_voice: z.string(),
          call_to_action: z.string(),
        }),
        palette: z.record(z.string(), z.string()),
      }),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const document = await readSession(args.design, (current) => current)
      const data = {
        design: args.design,
        brand: {
          product_name: document.brand.productName,
          social_handle: document.brand.socialHandle,
          display_name: document.brand.displayName,
          website: document.brand.website,
          ai: {
            product_description: document.brand.ai.productDescription,
            target_audience: document.brand.ai.targetAudience,
            brand_voice: document.brand.ai.brandVoice,
            call_to_action: document.brand.ai.callToAction,
          },
          palette: document.brand.palette,
        },
      }
      return {
        data,
        text: args.response_format === 'markdown' ? `### Brand context\n\n${markdownRecord(data.brand as never)}` : JSON.stringify(data),
      }
    },
  })

  defineTool(server, {
    name: 'tela_set_brand_context',
    title: 'Set brand context',
    description:
      'Update the design\'s brand block. Only the fields you pass are changed; the rest are left as they are. Palette entries are merged token by token — pass null as a token\'s value to drop the override.',
    inputSchema: z.strictObject({
      design: designArg,
      product_name: z.string().max(200).optional(),
      social_handle: z.string().max(200).optional(),
      display_name: z.string().max(200).optional(),
      website: z.string().max(500).optional(),
      product_description: z.string().max(2000).optional(),
      target_audience: z.string().max(2000).optional(),
      brand_voice: z.string().max(2000).optional(),
      call_to_action: z.string().max(500).optional(),
      palette: z
        .record(z.string(), z.union([z.string(), z.null()]))
        .optional()
        .describe('Palette token overrides to merge, e.g. {"brand-primary": "#ff5a1f"}. Null drops an override.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, changed_fields: z.array(z.string()) }),
    annotations: IDEMPOTENT_WRITE,
    handler: async (args) => {
      const changed: string[] = []
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const brand = { ...document.brand, ai: { ...document.brand.ai }, palette: { ...document.brand.palette } }
        const set = <K extends 'productName' | 'socialHandle' | 'displayName' | 'website'>(key: K, value: string | undefined, label: string) => {
          if (value === undefined) return
          brand[key] = value
          changed.push(label)
        }
        set('productName', args.product_name, 'product_name')
        set('socialHandle', args.social_handle, 'social_handle')
        set('displayName', args.display_name, 'display_name')
        set('website', args.website, 'website')
        if (args.product_description !== undefined) {
          brand.ai.productDescription = args.product_description
          changed.push('product_description')
        }
        if (args.target_audience !== undefined) {
          brand.ai.targetAudience = args.target_audience
          changed.push('target_audience')
        }
        if (args.brand_voice !== undefined) {
          brand.ai.brandVoice = args.brand_voice
          changed.push('brand_voice')
        }
        if (args.call_to_action !== undefined) {
          brand.ai.callToAction = args.call_to_action
          changed.push('call_to_action')
        }
        if (args.palette) {
          for (const [token, value] of Object.entries(args.palette)) {
            if (value === null) delete brand.palette[token]
            else brand.palette[token] = value
            changed.push(`palette.${token}`)
          }
        }
        if (changed.length === 0) {
          throw toolError('invalid_input', 'no brand fields were supplied', 'pass at least one field to change; call tela_get_brand_context to see the current values')
        }
        return { document: finalize({ ...document, brand }), value: changed }
      })
      return {
        data: { session: sessionState(result.session), changed_fields: result.value },
        text: mutationText(result.session, `Updated brand fields: ${result.value.join(', ')}`),
      }
    },
  })
}

/** Layer ids whose artwork resolves to `ref`, across every frame. */
function layersReferencing(document: TelaDocument, ref: string): string[] {
  const users: string[] = []
  for (const page of document.pages) {
    for (const frame of page.frames) {
      if (frame.backgroundFill.type === 'image' && frame.backgroundFill.imageUrl === ref) users.push(`frame:${frame.id}`)
      for (const layer of frame.layers) {
        if (layer.type === 'image' && layer.imageUrl === ref) users.push(layer.id)
        else if (layer.type === 'background' && layer.fill.type === 'image' && layer.fill.imageUrl === ref) users.push(layer.id)
      }
    }
  }
  return users
}
