/**
 * File lifecycle: create, open, close, save, import, duplicate, archive.
 *
 * The revision discipline lives here. `tela_save_design` is the only tool that
 * takes *two* expectations — the session revision (did anything change in this
 * process since you looked?) and the disk revision (did the file change outside
 * it?). Those answer different questions and neither implies the other, which is
 * why both are required rather than one being derived.
 *
 * Nothing in this module deletes. `tela_archive_design` moves the file into a
 * managed trash under the approved root; recovering it is a file move, not a
 * forensic exercise.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { DESIGN_TEMPLATES } from '../../brand/templates'
import type { TelaLayer } from '../../tela/schema'
import { toolError } from '../errors'
import { markdownRecord, responseFormatSchema } from '../format'
import { addLayers, createDocument, formatById, requireFrame } from '../documentOps'
import {
  archiveDesignFile,
  closeDesign,
  createDesignFile,
  duplicateDesignFile,
  importDesignFile,
  openDesign,
  saveDesign,
} from '../sessions'
import { ADDITIVE, DESTRUCTIVE, defineTool, IDEMPOTENT_WRITE } from '../tooling'
import { designArg, expectedSessionRevisionArg, sessionState, sessionStateSchema } from './common'

export function registerLifecycleTools(server: McpServer): void {
  defineTool(server, {
    name: 'tela_create_design',
    title: 'Create design',
    description:
      'Create a new .tela design at a root-relative path and open an editing session for it. Optionally seed it from a template (see tela_list_templates) or a named ad format. Refuses to overwrite an existing file.',
    inputSchema: z.strictObject({
      design: designArg,
      name: z.string().min(1).max(200).describe('Human-readable design name, stored in the document.'),
      format_id: z.string().optional().describe('Ad format for the first frame. See tela://formats. Defaults to linkedin-feed.'),
      template_id: z.string().optional().describe('Template to seed the first frame from. Mutually exclusive with an empty design.'),
      page_name: z.string().max(200).optional(),
      frame_name: z.string().max(200).optional(),
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({
      session: sessionStateSchema,
      design_name: z.string(),
      page_id: z.string(),
      frame_id: z.string().nullable(),
      seeded_from_template: z.string().nullable(),
    }),
    annotations: ADDITIVE,
    handler: async (args) => {
      const template = args.template_id ? DESIGN_TEMPLATES.find((candidate) => candidate.id === args.template_id) : undefined
      if (args.template_id && !template) {
        throw toolError(
          'not_found',
          `no template "${args.template_id}"`,
          `call tela_list_templates for the available ids (${DESIGN_TEMPLATES.slice(0, 4).map((t) => t.id).join(', ')}, …)`,
        )
      }

      let document = createDocument({
        name: args.name,
        formatId: args.format_id ?? template?.formatId,
        pageName: args.page_name,
        frameName: args.frame_name ?? (template ? template.name : undefined),
      })
      const frameId = document.pages[0].frames[0]?.id ?? null

      if (template && frameId) {
        // Templates are authored against the app's own layer type. They are run
        // through the same `addLayers` path as any other authoring input, so a
        // template that drifts from the persisted schema fails here rather than
        // producing a design that cannot be saved.
        const seeded = template.create()
        const inputs = seeded.layers.map((layer) => {
          const { id: _id, zIndex: _zIndex, ...rest } = layer as unknown as Record<string, unknown>
          return rest
        })
        document = addLayers(document, frameId, inputs as never).document
      }

      const created = await createDesignFile(args.design, document)
      const { session } = await openDesign(created.design)
      const data = {
        session: sessionState(session),
        design_name: document.name,
        page_id: document.pages[0].id,
        frame_id: frameId,
        seeded_from_template: template?.id ?? null,
      }
      return {
        data,
        text:
          args.response_format === 'markdown'
            ? `Created **${document.name}** at \`${created.design}\`.\n\n${markdownRecord(data.session as never)}`
            : `Created "${document.name}" at ${created.design}. Session revision 0. ${JSON.stringify(data)}`,
      }
    },
  })

  defineTool(server, {
    name: 'tela_open_design',
    title: 'Open design',
    description:
      'Open an existing .tela design and start an editing session. Reading an already-open design returns the existing session rather than a second copy, so two clients editing the same file share one authoritative state. Reports any schema migrations applied on the way in.',
    inputSchema: z.strictObject({ design: designArg, response_format: responseFormatSchema }),
    outputSchema: z.strictObject({
      session: sessionStateSchema,
      design_name: z.string(),
      reused_existing_session: z.boolean(),
      migrations_applied: z.array(z.string()),
      page_count: z.int().nonnegative(),
      frame_count: z.int().nonnegative(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (args) => {
      const { session, reused } = await openDesign(args.design)
      const data = {
        session: sessionState(session),
        design_name: session.document.name,
        reused_existing_session: reused,
        migrations_applied: session.migrationsApplied,
        page_count: session.document.pages.length,
        frame_count: session.document.pages.reduce((sum, page) => sum + page.frames.length, 0),
      }
      return {
        data,
        text:
          args.response_format === 'markdown'
            ? `Opened **${session.document.name}**${reused ? ' (existing session reused)' : ''}.\n\n${markdownRecord(data.session as never)}`
            : JSON.stringify(data),
      }
    },
  })

  defineTool(server, {
    name: 'tela_close_design',
    title: 'Close design',
    description:
      'Close an editing session. Refuses to close a design with unsaved changes unless discard_changes is true, so an unsaved edit is never lost by accident. The .tela file itself is untouched either way.',
    inputSchema: z.strictObject({
      design: designArg,
      discard_changes: z.boolean().default(false).describe('Close even when the session has unsaved changes, losing them. Save first unless you mean it.'),
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ design: z.string(), closed: z.boolean(), discarded_changes: z.boolean() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (args) => {
      const result = await closeDesign(args.design, args.discard_changes)
      const data = { design: args.design, closed: result.closed, discarded_changes: result.discardedChanges }
      return {
        data,
        text: result.closed
          ? `Closed ${args.design}${result.discardedChanges ? ' and discarded its unsaved changes' : ''}.`
          : `${args.design} was not open; nothing to close.`,
      }
    },
  })

  defineTool(server, {
    name: 'tela_save_design',
    title: 'Save design',
    description:
      'Write the session to its .tela file atomically. Requires both the session revision you last observed and the disk revision, so a save is refused if anything changed in this process OR on disk since you looked. On success it returns the new disk revision — carry that into your next save.',
    inputSchema: z.strictObject({
      design: designArg,
      expected_session_revision: expectedSessionRevisionArg,
      expected_disk_revision: z
        .string()
        .min(1)
        .describe('The disk_revision you last observed. Refused if the file changed outside this session, which prevents overwriting another writer.'),
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({
      session: sessionStateSchema,
      bytes_written: z.int().nonnegative(),
      document_sha256: z.string(),
      content_unchanged: z.boolean().describe('True when the save produced a semantically identical design — a no-op round trip.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (args) => {
      const result = await saveDesign(args.design, args.expected_session_revision, args.expected_disk_revision)
      const data = {
        session: sessionState(result.session),
        bytes_written: result.bytes,
        document_sha256: result.documentSha256,
        content_unchanged: result.unchanged,
      }
      return {
        data,
        text:
          args.response_format === 'markdown'
            ? `Saved \`${args.design}\` — ${result.bytes} bytes.\n\n${markdownRecord(data as never)}`
            : `Saved ${args.design} (${result.bytes} bytes). New disk_revision ${result.diskRevision}. ${JSON.stringify(data)}`,
      }
    },
  })

  defineTool(server, {
    name: 'tela_import_design',
    title: 'Import design',
    description:
      'Copy a .tela bundle from elsewhere under the approved root into the library at a new path, validating it on the way in. An invalid, oversized, or hostile bundle is refused before anything is written. Reports any migrations applied.',
    inputSchema: z.strictObject({
      source: z.string().min(1).max(1024).describe('Root-relative path of the .tela bundle to import.'),
      design: designArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ design: z.string(), bytes: z.int().nonnegative(), migrations_applied: z.array(z.string()) }),
    annotations: ADDITIVE,
    handler: async (args, context) => {
      await context.progress(1, 3, 'validating the source bundle')
      const result = await importDesignFile(args.source, args.design)
      await context.progress(3, 3, 'imported')
      const data = { design: result.design, bytes: result.bytes, migrations_applied: result.migrationsApplied }
      return { data, text: `Imported to ${result.design} (${result.bytes} bytes). Open it with tela_open_design.` }
    },
  })

  defineTool(server, {
    name: 'tela_duplicate_design',
    title: 'Duplicate design',
    description:
      'Copy a design to a new root-relative path. The copy is made from the saved file, not from any unsaved session state, so the duplicate is exactly what is on disk. Refuses to overwrite an existing target.',
    inputSchema: z.strictObject({ design: designArg, target_design: designArg, response_format: responseFormatSchema }),
    outputSchema: z.strictObject({ design: z.string(), bytes: z.int().nonnegative() }),
    annotations: ADDITIVE,
    handler: async (args) => {
      const result = await duplicateDesignFile(args.design, args.target_design)
      return { data: { design: result.design, bytes: result.bytes }, text: `Duplicated to ${result.design} (${result.bytes} bytes).` }
    },
  })

  defineTool(server, {
    name: 'tela_archive_design',
    title: 'Archive design',
    description:
      'Move a design into the managed trash under the approved root and close its session. Nothing is permanently deleted — the archived copy keeps its name plus a timestamp and can be moved back. Refuses while the session has unsaved changes.',
    inputSchema: z.strictObject({ design: designArg, response_format: responseFormatSchema }),
    outputSchema: z.strictObject({ design: z.string(), archived_as: z.string() }),
    annotations: DESTRUCTIVE,
    handler: async (args) => {
      const result = await archiveDesignFile(args.design)
      return {
        data: { design: result.design, archived_as: result.archivedAs },
        text: `Archived ${result.design} to ${result.archivedAs}. It was moved, not deleted.`,
      }
    },
  })

  defineTool(server, {
    name: 'tela_apply_layout',
    title: 'Apply layout to frame',
    description:
      'Drop a built-in composition into a frame as placeholder layers, sized to the frame\'s current dimensions. Existing layers are kept unless replace_existing is true, in which case they are archived to the trash first. See tela_list_layouts.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: z.string().min(1).max(128),
      layout_id: z.string().min(1).describe('Layout id from tela_list_layouts.'),
      replace_existing: z.boolean().default(false).describe('Archive the frame\'s current layers before applying. They go to the managed trash, not away.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({
      session: sessionStateSchema,
      frame_id: z.string(),
      layer_ids: z.array(z.string()),
      archived_layer_count: z.int().nonnegative(),
      archived_to: z.string().nullable(),
    }),
    // DESTRUCTIVE, not ADDITIVE: with replace_existing the whole frame's
    // composition is archived and removed. A host that auto-approves on
    // destructiveHint:false would strip a hand-authored frame without asking,
    // which is exactly what the hint exists to prevent. The annotation has to
    // cover the tool's worst argument, not its default one.
    annotations: DESTRUCTIVE,
    handler: async (args) => {
      const { applyLayoutToFrame } = await import('./layoutApply')
      return applyLayoutToFrame(args)
    },
  })

  defineTool(server, {
    name: 'tela_generate_format_variants',
    title: 'Generate format variants',
    description:
      'Copy a frame into one or more other ad formats, rescaling its composition (including font sizes) to the new dimensions. Omit format_ids to generate every format the source frame is not already in. The source frame is untouched.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: z.string().min(1).max(128),
      format_ids: z.array(z.string()).default([]).describe('Target format ids. Empty means every format other than the source frame\'s.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({
      session: sessionStateSchema,
      source_frame_id: z.string(),
      created: z.array(z.strictObject({ frame_id: z.string(), format_id: z.string() })),
    }),
    annotations: ADDITIVE,
    handler: async (args) => {
      const { mutateSession } = await import('../sessions')
      const { generateFormatVariants } = await import('../documentOps')
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const next = generateFormatVariants(document, args.frame_id, args.format_ids)
        return { document: next.document, value: next.created }
      })
      const data = {
        session: sessionState(result.session),
        source_frame_id: args.frame_id,
        created: result.value.map((entry) => ({ frame_id: entry.frameId, format_id: entry.formatId })),
      }
      return { data, text: `Generated ${result.value.length} format variant(s). Session revision is now ${result.session.sessionRevision}.` }
    },
  })

  defineTool(server, {
    name: 'tela_add_frame',
    title: 'Add frame',
    description:
      'Add an empty frame to a page in the named ad format, positioned to the right of the existing frames unless x/y are given. Returns the new frame id.',
    inputSchema: z.strictObject({
      design: designArg,
      page_id: z.string().min(1).max(128),
      name: z.string().max(200).optional(),
      format_id: z.string().optional().describe('Ad format. See tela://formats. Defaults to linkedin-feed.'),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, frame_id: z.string(), format_id: z.string() }),
    annotations: ADDITIVE,
    handler: async (args) => {
      const { mutateSession } = await import('../sessions')
      const { addFrame } = await import('../documentOps')
      const format = formatById(args.format_id ?? 'linkedin-feed')
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const next = addFrame(document, args.page_id, {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.format_id !== undefined ? { formatId: args.format_id } : {}),
          ...(args.x !== undefined ? { x: args.x } : {}),
          ...(args.y !== undefined ? { y: args.y } : {}),
        })
        return { document: next.document, value: next.frameId }
      })
      return {
        data: { session: sessionState(result.session), frame_id: result.value, format_id: format.id },
        text: `Added frame ${result.value} (${format.id}, ${format.width}×${format.height}). Session revision is now ${result.session.sessionRevision}.`,
      }
    },
  })

  defineTool(server, {
    name: 'tela_duplicate_frame',
    title: 'Duplicate frame',
    description: 'Copy a frame, its layers, and its auto-layouts within the same page. Every copied layer gets a fresh id and group references are rewritten to match.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: z.string().min(1).max(128),
      name: z.string().max(200).optional(),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, frame_id: z.string(), source_frame_id: z.string() }),
    annotations: ADDITIVE,
    handler: async (args) => {
      const { mutateSession } = await import('../sessions')
      const { duplicateFrame } = await import('../documentOps')
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const next = duplicateFrame(document, args.frame_id, args.name)
        return { document: next.document, value: next.frameId }
      })
      return {
        data: { session: sessionState(result.session), frame_id: result.value, source_frame_id: args.frame_id },
        text: `Duplicated frame ${args.frame_id} as ${result.value}. Session revision is now ${result.session.sessionRevision}.`,
      }
    },
  })

  defineTool(server, {
    name: 'tela_save_version',
    title: 'Save version',
    description:
      'Capture a named snapshot of one frame inside the design. Snapshots travel with the .tela file, so restoring one needs no external history. Use before a risky change.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: z.string().min(1).max(128),
      name: z.string().min(1).max(200).describe('Label for the snapshot, e.g. "before headline rewrite".'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, version_id: z.string(), frame_id: z.string() }),
    annotations: ADDITIVE,
    handler: async (args) => {
      const { mutateSession } = await import('../sessions')
      const { saveVersion } = await import('../documentOps')
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const next = saveVersion(document, args.frame_id, args.name)
        return { document: next.document, value: next.versionId }
      })
      return {
        data: { session: sessionState(result.session), version_id: result.value, frame_id: args.frame_id },
        text: `Saved version "${args.name}" (${result.value}). Session revision is now ${result.session.sessionRevision}.`,
      }
    },
  })

  defineTool(server, {
    name: 'tela_restore_version',
    title: 'Restore version',
    description:
      'Replace a frame\'s format, layers, and auto-layouts with a saved snapshot. Destructive to the frame\'s current content — save a version of the current state first if you may want it back. Defaults to the frame the snapshot came from.',
    inputSchema: z.strictObject({
      design: designArg,
      version_id: z.string().min(1).max(128),
      frame_id: z.string().min(1).max(128).optional().describe('Frame to restore onto. Defaults to the frame the version was captured from.'),
      expected_session_revision: expectedSessionRevisionArg,
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({ session: sessionStateSchema, version_id: z.string(), frame_id: z.string(), layer_count: z.int().nonnegative() }),
    annotations: DESTRUCTIVE,
    handler: async (args) => {
      const { mutateSession } = await import('../sessions')
      const { restoreVersion } = await import('../documentOps')
      const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
        const next = restoreVersion(document, args.version_id, args.frame_id)
        const { frame } = requireFrame(next.document, next.frameId)
        return { document: next.document, value: { frameId: next.frameId, layerCount: frame.layers.length } }
      })
      return {
        data: {
          session: sessionState(result.session),
          version_id: args.version_id,
          frame_id: result.value.frameId,
          layer_count: result.value.layerCount,
        },
        text: `Restored version ${args.version_id} onto frame ${result.value.frameId} (${result.value.layerCount} layers). Session revision is now ${result.session.sessionRevision}.`,
      }
    },
  })
}

/** Exported for the layout applier, which needs the same layer widening. */
export type { TelaLayer }
export { IDEMPOTENT_WRITE }
