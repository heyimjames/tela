/**
 * The real `DocumentBridge`, wired to the editor's existing `.tela` I/O.
 *
 * Kept apart from `documentBridge.ts` so the interface can be imported by the
 * session controller and its Node tests without dragging `Blob`, `document` and
 * `URL.createObjectURL` along with it. Only React code imports this file.
 *
 * Every operation reuses `src/tela/browserIo.ts` rather than reimplementing it. A
 * second serializer would be a second chance to disagree with the one the MCP
 * payload ships, and the whole point of that module is that a file saved from the
 * editor and one saved by the MCP server are byte-identical.
 */

import { readBundleForEditing } from '@/tela/bundle'
import { applySession } from '@/tela/session'
import { downloadSessionBundle, exportSessionBundle } from '@/tela/browserIo'
import type { DocumentBridge } from './documentBridge'

export function createBrowserDocumentBridge(): DocumentBridge {
  return {
    capture: exportSessionBundle,

    async apply(bundle: Uint8Array): Promise<void> {
      // Validation runs first, inside `readBundleForEditing`. A bundle the reader
      // refuses therefore leaves the session untouched — which matters most on the
      // conflict path, where the user has just chosen to discard local edits in
      // favour of the server's copy: a refusal there must not leave them with
      // neither version.
      const opened = readBundleForEditing(bundle)
      applySession(opened.document)
    },

    download: downloadSessionBundle,
  }
}
