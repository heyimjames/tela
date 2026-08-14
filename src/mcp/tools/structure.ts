/**
 * Pages and the remaining frame tools.
 *
 * Reordering takes a **complete permutation** rather than "move this one to
 * index 3". A full order is idempotent, is verifiable against what the caller
 * last read, and cannot silently drop an item that appeared between the read and
 * the write — a move-one API drops exactly that item, silently, every time two
 * callers interleave.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { responseFormatSchema } from '../format'
import { addPage, archiveFrame, archivePage, reorderFrames, reorderPages, updateFrame, updatePage } from '../documentOps'
import { archiveFragment, mutateSession } from '../sessions'
import { buildRefIndex, toSessionRefs } from '../assetRefs'
import { ADDITIVE, DESTRUCTIVE, defineTool, IDEMPOTENT_WRITE } from '../tooling'
import { designArg, expectedSessionRevisionArg, frameArg, mutationText, pageArg, sessionState, sessionStateSchema } from './common'

export function registerStructureTools(server: McpServer): void {
  defineTool(server, {
    name: 'tela_add_page',
    title: 'Add page',
    description: 'Add an empty page to the design. Frames are added to it separately with tela_add_frame.',
    inputSchema: z.strictObject({
      design: designArg,
      name: z.string().min(1).max(200),
      index: z.int().nonnegative().optional().describe('Position to insert at. Omit to append.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, page_id: z.string() }),
    annotations: ADDITIVE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const next = addPage(document, args.name, args.index)
        return { document: next.document, value: next.pageId }
      })
      return {
        data: { session: sessionState(result.session), page_id: result.value },
        text: mutationText(result.session, `Added page "${args.name}" (${result.value})`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_update_page',
    title: 'Update page',
    description: 'Rename a page and/or make it the active page. Making a page active clears the active frame unless the active frame is on that page.',
    inputSchema: z.strictObject({
      design: designArg,
      page_id: pageArg,
      name: z.string().min(1).max(200).optional(),
      active: z.boolean().optional().describe('Set true to make this the active page.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, page_id: z.string() }),
    annotations: IDEMPOTENT_WRITE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => ({
        document: updatePage(document, args.page_id, {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.active !== undefined ? { active: args.active } : {}),
        }),
        value: args.page_id,
      }))
      return {
        data: { session: sessionState(result.session), page_id: args.page_id },
        text: mutationText(result.session, `Updated page ${args.page_id}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_reorder_pages',
    title: 'Reorder pages',
    description:
      'Set the page order. Pass every existing page id exactly once, in the order you want; a partial list is refused so a page can never be dropped by omission. Read the current order from tela_get_design_summary first.',
    inputSchema: z.strictObject({
      design: designArg,
      page_ids: z.array(z.string().min(1)).min(1).describe('Every page id, in the desired order.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, page_ids: z.array(z.string()) }),
    annotations: IDEMPOTENT_WRITE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => ({
        document: reorderPages(document, args.page_ids),
        value: args.page_ids,
      }))
      return {
        data: { session: sessionState(result.session), page_ids: args.page_ids },
        text: mutationText(result.session, `Reordered ${args.page_ids.length} pages`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_archive_page',
    title: 'Archive page',
    description:
      'Remove a page and everything on it, writing the excised page to the managed trash as JSON so it can be recovered. Refused when it is the design\'s only page.',
    inputSchema: z.strictObject({
      design: designArg,
      page_id: pageArg,
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, page_id: z.string(), archived_to: z.string(), frame_count: z.int().nonnegative() }),
    annotations: DESTRUCTIVE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const next = archivePage(document, args.page_id)
        return { document: next.document, value: next.archived }
      })
      const archivedTo = await archiveFragment(args.design, `page-${args.page_id}`, result.value)
      return {
        data: {
          session: sessionState(result.session),
          page_id: args.page_id,
          archived_to: archivedTo,
          frame_count: result.value.frames.length,
        },
        text: mutationText(result.session, `Archived page ${args.page_id} (${result.value.frames.length} frames) to ${archivedTo}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_update_frame',
    title: 'Update frame',
    description:
      'Change a frame\'s name, position, lock/visibility, background, or ad format. Changing the format reflows the frame\'s layers according to their constraints; layers with no constraints scale proportionally with the frame.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: frameArg,
      name: z.string().max(200).optional(),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      locked: z.boolean().optional(),
      visible: z.boolean().optional(),
      format_id: z.string().optional().describe('New ad format. Layers reflow to fit.'),
      background_color: z.strictObject({ hex: z.string(), token: z.string().default('custom') }).optional(),
      background_fill: z.record(z.string(), z.unknown()).optional().describe('Full background fill object: solid, gradient, image, or shader.'),
      active: z.boolean().optional().describe('Set true to make this the active frame (and its page the active page).'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, frame_id: z.string() }),
    annotations: IDEMPOTENT_WRITE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => ({
        document: updateFrame(document, args.frame_id, {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.x !== undefined ? { x: args.x } : {}),
          ...(args.y !== undefined ? { y: args.y } : {}),
          ...(args.locked !== undefined ? { locked: args.locked } : {}),
          ...(args.visible !== undefined ? { visible: args.visible } : {}),
          ...(args.format_id !== undefined ? { formatId: args.format_id } : {}),
          ...(args.background_color !== undefined ? { backgroundColor: args.background_color } : {}),
          ...(args.background_fill !== undefined
            ? { backgroundFill: toSessionRefs(args.background_fill, buildRefIndex(document)) as never }
            : {}),
          ...(args.active !== undefined ? { active: args.active } : {}),
        }),
        value: args.frame_id,
      }))
      return {
        data: { session: sessionState(result.session), frame_id: args.frame_id },
        text: mutationText(result.session, `Updated frame ${args.frame_id}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_reorder_frames',
    title: 'Reorder frames',
    description:
      'Set the frame order within one page. Pass every frame id on that page exactly once, in the order you want. Read the current order from tela_get_design_summary first.',
    inputSchema: z.strictObject({
      design: designArg,
      page_id: pageArg,
      frame_ids: z.array(z.string().min(1)).min(1).describe('Every frame id on the page, in the desired order.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, page_id: z.string(), frame_ids: z.array(z.string()) }),
    annotations: IDEMPOTENT_WRITE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => ({
        document: reorderFrames(document, args.page_id, args.frame_ids),
        value: args.frame_ids,
      }))
      return {
        data: { session: sessionState(result.session), page_id: args.page_id, frame_ids: args.frame_ids },
        text: mutationText(result.session, `Reordered ${args.frame_ids.length} frames on page ${args.page_id}`),
      }
    },
  })

  defineTool(server, {
    name: 'tela_archive_frame',
    title: 'Archive frame',
    description: 'Remove a frame and its layers, writing the excised frame to the managed trash as JSON so it can be recovered.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: frameArg,
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, frame_id: z.string(), archived_to: z.string(), layer_count: z.int().nonnegative() }),
    annotations: DESTRUCTIVE,
    handler: async (args) => {
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const next = archiveFrame(document, args.frame_id)
        return { document: next.document, value: next.archived }
      })
      const archivedTo = await archiveFragment(args.design, `frame-${args.frame_id}`, result.value)
      return {
        data: {
          session: sessionState(result.session),
          frame_id: args.frame_id,
          archived_to: archivedTo,
          layer_count: result.value.layers.length,
        },
        text: mutationText(result.session, `Archived frame ${args.frame_id} (${result.value.layers.length} layers) to ${archivedTo}`),
      }
    },
  })
}
