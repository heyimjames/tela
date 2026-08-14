/**
 * Browser-side `.tela` I/O.
 *
 * The browser cannot make the durability guarantees `nodeIo.ts` does — there is no
 * `fsync`, and a download is a hand-off to the browser rather than a write this
 * code controls. What it *can* guarantee is the other half: the bytes handed over
 * are produced by the same writer, so a file saved from the editor and a file
 * saved by the MCP server are byte-identical for the same document.
 *
 * Nothing here touches the network. The bundle is built in memory and handed to a
 * download or to a File System Access handle the user picked.
 */

import { writeBundle, readBundleForEditing } from './bundle'
import { captureSession, applySession } from './session'
import { TelaError, telaError } from './errors'
import type { TelaDocument, TelaManifest } from './schema'

const MIME = 'application/vnd.clickt.tela+zip'

export function bundleFileName(documentName: string): string {
  // Replace the characters Windows forbids in a filename, plus control characters
  // and any whitespace, rather than trusting the OS to cope with a design named
  // "Q3/Q4: final". Written as an explicit list — a character range like `[ -<]`
  // here would silently swallow every digit.
  const forbidden = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
  let safe = ''
  for (const character of documentName) {
    const code = character.codePointAt(0) ?? 0
    safe += forbidden.has(character) || code < 0x20 || code === 0x7f ? ' ' : character
  }
  safe = safe.replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[. ]+$/, '')
  return `${safe || 'Untitled'}.tela`
}

/** Serialize the live editing session to bundle bytes. */
export function exportSessionBundle(): Uint8Array {
  return writeBundle(captureSession())
}

/** Serialize the session and hand the bytes to the browser as a download. */
export function downloadSessionBundle(documentName: string): void {
  const bytes = exportSessionBundle()
  const blob = new Blob([bytes as BlobPart], { type: MIME })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = bundleFileName(documentName)
    anchor.rel = 'noopener'
    anchor.click()
  } finally {
    // Revoking on the next task lets the click's navigation start first while
    // still guaranteeing the blob is released.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export interface OpenedBundle {
  document: TelaDocument
  manifest: TelaManifest
  migrationsApplied: string[]
}

/**
 * Read a user-chosen file and apply it to the session.
 *
 * Validation happens inside `readBundleForEditing`, so a rejected file leaves the
 * current session completely untouched — the user does not lose the design they
 * had open because they tried to open a corrupt one.
 */
export async function openBundleFile(file: File): Promise<OpenedBundle> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch (cause) {
    throw telaError('io_failed', `could not read ${file.name}`, cause instanceof Error ? cause.message : String(cause))
  }

  const opened = readBundleForEditing(bytes)
  applySession(opened.document)
  return opened
}

/** A message safe to show a user: actionable, and free of internal paths. */
export function describeTelaError(error: unknown): string {
  if (error instanceof TelaError) {
    return error.detail ? `${error.message} (${error.detail})` : error.message
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}
