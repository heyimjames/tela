/**
 * Rendering, export, and the editor window.
 *
 * These are the only four tools that need a browser, and they are the reason the
 * bridge is lazy: everything else — the whole authoring surface — works with no
 * browser at all, so a client that never renders never pays for Chromium.
 *
 * `tela_render_preview` returns an image *inline* for a model to look at.
 * `tela_export_frames` writes files and returns paths. The split is deliberate:
 * a preview that wrote to disk would litter the approved root with throwaway
 * images, and an export that returned base64 would put megabytes through the
 * transport for no reason.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { markdownTable, responseFormatSchema } from '../format'
import { requireFrame } from '../documentOps'
import { defaultExportDirectory, readSession, requireSession } from '../sessions'
import { resolveInRoot } from '../paths'
import { renderFrames, writeExports } from '../bridge/render'
import { bridgeStatus, stopBridge } from '../bridge/browser'
import { toolError } from '../errors'
import { defineTool, READ_ONLY } from '../tooling'
import { designArg, frameArg } from './common'

const MAX_PREVIEW_BYTES = 4 * 1024 * 1024

export function registerOutputTools(server: McpServer): void {
  defineTool(server, {
    name: 'tela_render_preview',
    title: 'Render preview',
    description:
      'Render one frame and return the image inline so it can be looked at. Use a small scale (0.25–0.5) for a quick visual check; use tela_export_frames when you want files on disk. Starts the private browser on first use. Reports progress and honours cancellation.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_id: frameArg,
      format: z.enum(['png', 'jpg', 'webp']).default('png').describe('Preview encoding. PNG is lossless; JPG/WebP are smaller for a quick look.'),
      scale: z.number().positive().max(2).default(0.5).describe('Scale factor relative to the frame\'s native size. Keep it small — the image is returned inline.'),
      quality: z.number().min(0.1).max(1).default(0.9).describe('Encoder quality for jpg/webp. Ignored for png.'),
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({
      design: z.string(),
      frame_id: z.string(),
      frame_name: z.string(),
      format: z.string(),
      mime: z.string(),
      width: z.int().positive(),
      height: z.int().positive(),
      bytes: z.int().nonnegative(),
      image_base64: z.string().describe('The rendered image, base64-encoded.'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (args, context) => {
      const document = await readSession(args.design, (current) => current)
      // Fail before launching a browser if the frame does not exist: booting
      // Chromium to discover a typo is a slow way to say "not found".
      requireFrame(document, args.frame_id)

      await context.progress(1, 3, 'starting the renderer')
      const [image] = await renderFrames(
        {
          document,
          frameIds: [args.frame_id],
          format: args.format,
          quality: args.quality,
          dpr: args.scale,
          onProgress: async (done, total) => context.progress(1 + done, 2 + total, 'rendering'),
        },
        context.signal,
      )
      await context.progress(3, 3, 'rendered')

      if (image.bytes > MAX_PREVIEW_BYTES) {
        throw toolError(
          'policy_refused',
          `the preview is ${image.bytes} bytes, over the ${MAX_PREVIEW_BYTES}-byte inline limit`,
          'lower `scale`, or switch to format "jpg", or use tela_export_frames to write the full-size image to disk instead',
        )
      }

      return {
        data: {
          design: args.design,
          frame_id: image.frameId,
          frame_name: image.frameName,
          format: image.format,
          mime: image.mime,
          width: image.width,
          height: image.height,
          bytes: image.bytes,
          image_base64: image.base64,
        },
        text: `Rendered "${image.frameName}" at ${image.width}×${image.height} (${image.format}, ${image.bytes} bytes).`,
      }
    },
  })

  defineTool(server, {
    name: 'tela_export_frames',
    title: 'Export frames',
    description:
      'Render one or more frames to PNG, JPG, WebP, or browser-faithful SVG and write them into a directory under the approved root. Filenames are deterministic — the same frame, format, and scale always produce the same name — so a re-export replaces its own output instead of accumulating copies. Reports progress per frame and honours cancellation.',
    inputSchema: z.strictObject({
      design: designArg,
      frame_ids: z.array(z.string().min(1)).min(1).max(100).describe('Frames to export, in order.'),
      format: z.enum(['png', 'jpg', 'webp', 'svg']).default('png'),
      dpr: z.number().positive().max(4).default(2).describe('Device pixel ratio multiplier. 2 is the usual retina export; ignored for svg.'),
      quality: z.number().min(0.1).max(1).default(0.92).describe('Encoder quality for jpg/webp. Ignored for png and svg.'),
      destination: z
        .string()
        .max(1024)
        .optional()
        .describe('Root-relative output directory. Defaults to a "<design-name>-exports" directory beside the design.'),
      response_format: responseFormatSchema,
    }),
    outputSchema: z.strictObject({
      design: z.string(),
      destination: z.string(),
      format: z.string(),
      dpr: z.number(),
      files: z.array(
        z.strictObject({
          frame_id: z.string(),
          frame_name: z.string(),
          format_id: z.string(),
          path: z.string().describe('Root-relative path of the written file.'),
          mime: z.string(),
          width: z.int().positive(),
          height: z.int().positive(),
          bytes: z.int().nonnegative(),
        }),
      ),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (args, context) => {
      const document = await readSession(args.design, (current) => current)
      for (const frameId of args.frame_ids) requireFrame(document, frameId)

      const destination = args.destination ?? defaultExportDirectory(args.design)
      // Confinement is checked before the browser is launched. A refused
      // destination should cost a millisecond, not a Chromium boot, and a
      // policy failure that only surfaces after the work is done reads as a
      // flaky renderer rather than the deliberate refusal it is.
      await resolveInRoot(destination, 'destination', { forWrite: true })

      const total = args.frame_ids.length + 1
      await context.progress(1, total + 1, 'starting the renderer')

      const images = await renderFrames(
        {
          document,
          frameIds: args.frame_ids,
          format: args.format,
          quality: args.quality,
          // SVG has no raster scale; forcing 1 keeps the filename honest rather
          // than stamping a meaningless "2x" on a vector file.
          dpr: args.format === 'svg' ? 1 : args.dpr,
          onProgress: async (done, count, frameName) => context.progress(1 + done, total + 1, `rendered ${frameName} (${done}/${count})`),
        },
        context.signal,
      )

      const written = await writeExports(images, destination, args.format === 'svg' ? 1 : args.dpr)
      await context.progress(total + 1, total + 1, 'written')

      const files = written.map((file) => ({
        frame_id: file.frameId,
        frame_name: file.frameName,
        format_id: file.formatId,
        path: file.path,
        mime: file.mime,
        width: file.width,
        height: file.height,
        bytes: file.bytes,
      }))
      const data = { design: args.design, destination, format: args.format, dpr: args.format === 'svg' ? 1 : args.dpr, files }
      return {
        data,
        text:
          args.response_format === 'markdown'
            ? `### Exported ${files.length} frame(s) to \`${destination}\`\n\n${markdownTable(['frame_name', 'path', 'width', 'height', 'bytes'], files as never)}`
            : `Exported ${files.length} frame(s) to ${destination}: ${files.map((file) => file.path).join(', ')}`,
      }
    },
  })

  defineTool(server, {
    name: 'tela_open_editor',
    title: 'Open editor',
    description:
      'Load the design into the private editor session so it can be rendered and inspected as the app sees it. This is the bridge to the running Tela application; it does not open a window on the user\'s desktop and does not use the user\'s browser. Starts the browser on first use.',
    inputSchema: z.strictObject({ design: designArg, response_format: responseFormatSchema }),
    outputSchema: z.strictObject({ design: z.string(), loaded: z.boolean(), page_count: z.int().nonnegative(), session_revision: z.int() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (args, context) => {
      const session = requireSession(args.design)
      const document = await readSession(args.design, (current) => current)
      await context.progress(1, 2, 'starting the editor session')
      const { openEditor } = await import('../bridge/render')
      const result = await openEditor(document, context.signal)
      await context.progress(2, 2, 'loaded')
      return {
        data: { design: args.design, loaded: true, page_count: result.pages, session_revision: session.sessionRevision },
        text: `Loaded ${args.design} into the editor session (${result.pages} page(s)). The canonical state is still the .tela file; edits made here are not written back.`,
      }
    },
  })

  defineTool(server, {
    name: 'tela_close_editor',
    title: 'Close editor',
    description:
      'Shut down the private browser and the loopback application server, releasing their memory. Everything else keeps working; the next render simply starts them again. Safe to call when they were never started.',
    inputSchema: z.strictObject({ response_format: responseFormatSchema }),
    outputSchema: z.strictObject({ was_running: z.boolean(), stopped: z.boolean() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async () => {
      const wasRunning = bridgeStatus().running
      await stopBridge()
      return {
        data: { was_running: wasRunning, stopped: true },
        text: wasRunning ? 'Stopped the private browser and the loopback server.' : 'The browser bridge was not running; nothing to stop.',
      }
    },
  })
}

export { READ_ONLY }
