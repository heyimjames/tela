/**
 * Layer and structure tools.
 *
 * Two properties run through all of these:
 *
 *  - **Batch by default.** `add`, `update`, `duplicate`, and `archive` all take
 *    arrays. Composing a frame is inherently a multi-layer act, and one call per
 *    layer would mean one revision bump per layer — turning a single logical
 *    edit into a queue of revision conflicts for any concurrent caller.
 *  - **No reliance on selection.** Every layer is addressed by frame id and
 *    layer id. There is no "current selection" in this surface, so a caller
 *    never has to establish invisible state before acting, and two callers can
 *    never disagree about what "the selection" is.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { responseFormatSchema } from '../format'
import { addLayers, archiveLayers, duplicateLayers, groupLayers, reorderLayers, setAutoLayout, ungroupLayers, updateLayers } from '../documentOps'
import { archiveFragment, mutateSession } from '../sessions'
import { buildRefIndex, toSessionRefs } from '../assetRefs'
import { layerInputSchema, layerPatchSchema } from '../layerInput'
import { sanitizeSvg } from '../sanitizeSvg'
import { ADDITIVE, DESTRUCTIVE, defineTool, IDEMPOTENT_WRITE } from '../tooling'
import { designArg, expectedSessionRevisionArg, frameArg, mutationText, sessionState, sessionStateSchema } from './common'

const layerIdsArg = z.array(z.string().min(1).max(128)).min(1).max(500).describe('Layer ids to act on. tela_get_scene lists them.')

export function registerLayerTools(server: McpServer): void {
  defineTool(server, {
    name: 'tela_add_layers',
    title: 'Add layers',
    description:
      'Add one or more layers to a frame. Covers every persisted layer type: background, text, image, svg, shape, gradient, group, and draw. Geometry and styling default to sensible values, so a text layer needs little more than its content. Images and SVGs reference assets imported with tela_import_asset. Returns the new layer ids in the order given.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: frameArg,
      layers: z.array(layerInputSchema).min(1).max(200).describe('Layers to add, bottom to top.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, frame_id: z.string(), layer_ids: z.array(z.string()) }),
    annotations: ADDITIVE,
    handler: async (args) => {
      // SVG is sanitized before it can reach the document, so hostile markup is
      // refused at the authoring boundary rather than at render time — by which
      // point it would already be inside a saved .tela file.
      const layers = args.layers.map((layer) => (layer.type === 'svg' ? { ...layer, svgContent: sanitizeSvg(layer.svgContent) } : layer))
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        // Resolved inside the mutation so the index reflects the document this
        // change is actually applied to, not one read before the lock was taken.
        const resolved = toSessionRefs(layers, buildRefIndex(document))
        const next = addLayers(document, args.frame_id, resolved)
        return { document: next.document, value: next.layerIds }
      })
      return {
        data: { session: sessionState(result.session), frame_id: args.frame_id, layer_ids: result.value },
        text: mutationText(result.session, `Added ${result.value.length} layer(s) to frame ${args.frame_id}: ${result.value.join(', ')}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_update_layers',
    title: 'Update layers',
    description:
      'Patch fields on one or more layers in a frame. Each patch merges onto the layer and the result is re-validated against the strict persisted schema, so an invalid change is refused rather than saved. Pass null for a field to clear an optional property. A layer\'s type and id cannot be changed.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: frameArg,
      updates: z
        .array(z.strictObject({ layer_id: z.string().min(1).max(128), patch: layerPatchSchema }))
        .min(1)
        .max(500)
        .describe('Patches, applied in order. A failure anywhere leaves the whole call unapplied.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, frame_id: z.string(), layer_ids: z.array(z.string()) }),
    annotations: IDEMPOTENT_WRITE,
    handler: async (args) => {
      const updates = args.updates.map((update) =>
        typeof update.patch.svgContent === 'string' ? { ...update, patch: { ...update.patch, svgContent: sanitizeSvg(update.patch.svgContent) } } : update,
      )
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => ({
        document: updateLayers(document, args.frame_id, toSessionRefs(updates, buildRefIndex(document))),
        value: updates.map((update) => update.layer_id),
      }))
      return {
        data: { session: sessionState(result.session), frame_id: args.frame_id, layer_ids: result.value },
        text: mutationText(result.session, `Updated ${result.value.length} layer(s) in frame ${args.frame_id}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_duplicate_layers',
    title: 'Duplicate layers',
    description:
      'Copy layers within a frame, offset from the originals. Copies get fresh ids; group membership is rewritten only when both the group and its members were copied, so duplicating a member alone keeps it in the original group.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: frameArg,
      layer_ids: layerIdsArg,
      offset_x: z.number().finite().default(24),
      offset_y: z.number().finite().default(24),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, frame_id: z.string(), layer_ids: z.array(z.string()) }),
    annotations: ADDITIVE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const next = duplicateLayers(document, args.frame_id, args.layer_ids, { x: args.offset_x, y: args.offset_y })
        return { document: next.document, value: next.layerIds }
      })
      return {
        data: { session: sessionState(result.session), frame_id: args.frame_id, layer_ids: result.value },
        text: mutationText(result.session, `Duplicated ${result.value.length} layer(s): ${result.value.join(', ')}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_reorder_layers',
    title: 'Reorder layers',
    description:
      'Set the stacking order of a frame\'s layers, back to front. Pass every layer id in the frame exactly once; a partial list is refused so a layer can never be dropped by omission. Read the current order from tela_get_scene first.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: frameArg,
      layer_ids: z.array(z.string().min(1)).min(1).describe('Every layer id in the frame, back (index 0) to front.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, frame_id: z.string(), layer_ids: z.array(z.string()) }),
    annotations: IDEMPOTENT_WRITE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => ({
        document: reorderLayers(document, args.frame_id, args.layer_ids),
        value: args.layer_ids,
      }))
      return {
        data: { session: sessionState(result.session), frame_id: args.frame_id, layer_ids: args.layer_ids },
        text: mutationText(result.session, `Reordered ${args.layer_ids.length} layers in frame ${args.frame_id}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_archive_layers',
    title: 'Archive layers',
    description:
      'Remove layers from a frame, writing them to the managed trash as JSON so they can be recovered. References to the removed layers from groups and auto-layouts are cleaned up so the design stays valid.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: frameArg,
      layer_ids: layerIdsArg,
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({
      session: sessionStateSchema,
      frame_id: z.string(),
      layer_ids: z.array(z.string()),
      archived_to: z.string(),
    }),
    annotations: DESTRUCTIVE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const next = archiveLayers(document, args.frame_id, args.layer_ids)
        return { document: next.document, value: next.archived }
      })
      const archivedTo = await archiveFragment(args.design, `layers-${args.frame_id}`, result.value)
      return {
        data: { session: sessionState(result.session), frame_id: args.frame_id, layer_ids: args.layer_ids, archived_to: archivedTo },
        text: mutationText(result.session, `Archived ${result.value.length} layer(s) to ${archivedTo}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_group_layers',
    title: 'Group layers',
    description:
      'Wrap two or more layers in a group layer sized to their combined bounds. The group is what auto-layout attaches to, so group first, then call tela_set_auto_layout.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: frameArg,
      layer_ids: z.array(z.string().min(1)).min(2).max(500).describe('At least two layer ids to group.'),
      name: z.string().max(200).optional(),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, frame_id: z.string(), group_id: z.string() }),
    annotations: ADDITIVE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const next = groupLayers(document, args.frame_id, args.layer_ids, args.name)
        return { document: next.document, value: next.groupId }
      })
      return {
        data: { session: sessionState(result.session), frame_id: args.frame_id, group_id: result.value },
        text: mutationText(result.session, `Grouped ${args.layer_ids.length} layers as ${result.value}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_ungroup_layers',
    title: 'Ungroup layers',
    description: 'Dissolve a group, releasing its members as independent layers in place. Any auto-layout on the group is removed with it; the members keep their current positions.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: frameArg,
      group_id: z.string().min(1).max(128),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, frame_id: z.string(), layer_ids: z.array(z.string()) }),
    annotations: DESTRUCTIVE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const next = ungroupLayers(document, args.frame_id, args.group_id)
        return { document: next.document, value: next.layerIds }
      })
      return {
        data: { session: sessionState(result.session), frame_id: args.frame_id, layer_ids: result.value },
        text: mutationText(result.session, `Ungrouped ${args.group_id}, releasing ${result.value.length} layer(s)`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_set_auto_layout',
    title: 'Set auto layout',
    description:
      'Attach an auto-layout to a group and reflow its children into a row or column with the given gap, padding, and alignment. The reflow is written into the document, so the saved file is already correct — it does not need a browser to look right. Pass remove: true to detach the layout and leave the children where they are.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: frameArg,
      group_id: z.string().min(1).max(128).describe('Group layer to attach the layout to. Create one with tela_group_layers.'),
      remove: z.boolean().default(false).describe('Detach the auto-layout instead of setting one.'),
      direction: z.enum(['horizontal', 'vertical']).optional(),
      gap: z.number().finite().nonnegative().optional(),
      padding: z
        .strictObject({
          top: z.number().finite().nonnegative(),
          right: z.number().finite().nonnegative(),
          bottom: z.number().finite().nonnegative(),
          left: z.number().finite().nonnegative(),
        })
        .optional(),
      primary_align: z.enum(['start', 'center', 'end', 'space-between']).optional().describe('Alignment along the layout direction.'),
      counter_align: z.enum(['start', 'center', 'end', 'stretch']).optional().describe('Alignment across the layout direction.'),
      width_mode: z.enum(['fixed', 'hug']).optional(),
      height_mode: z.enum(['fixed', 'hug']).optional(),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, frame_id: z.string(), group_id: z.string(), removed: z.boolean() }),
    annotations: IDEMPOTENT_WRITE,
    handler: async (args) => {
      const config = args.remove
        ? null
        : {
            ...(args.direction !== undefined ? { direction: args.direction } : {}),
            ...(args.gap !== undefined ? { gap: args.gap } : {}),
            ...(args.padding !== undefined ? { padding: args.padding } : {}),
            ...(args.primary_align !== undefined ? { primaryAlign: args.primary_align } : {}),
            ...(args.counter_align !== undefined ? { counterAlign: args.counter_align } : {}),
            ...(args.width_mode !== undefined ? { widthMode: args.width_mode } : {}),
            ...(args.height_mode !== undefined ? { heightMode: args.height_mode } : {}),
          }
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => ({
        document: setAutoLayout(document, args.frame_id, args.group_id, config),
        value: args.group_id,
      }))
      return {
        data: { session: sessionState(result.session), frame_id: args.frame_id, group_id: args.group_id, removed: args.remove },
        text: mutationText(result.session, args.remove ? `Removed auto-layout from ${args.group_id}` : `Set auto-layout on ${args.group_id}`),
      }
    },
  })
}
