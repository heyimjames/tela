/**
 * The semantic content revision.
 *
 * `manifest.document.sha256` covers the document byte for byte and answers "is this
 * the same file". `contentRevision` answers a different and more useful question:
 * "is this the same *design*". It is computed over creative content only, so
 * switching the active page, toggling frame labels, or renaming the document does
 * not make downstream consumers believe the artwork changed.
 *
 * Both are recorded. A no-op open/save/reopen must preserve both, which is the
 * stronger statement and the one the acceptance criteria ask for.
 */

import { canonicalBytes } from './canonicalJson'
import { sha256Hex } from './sha256'
import type { TelaDocument } from './schema'

/**
 * Fields excluded from the semantic revision, with the reason each is excluded:
 *
 * - `schemaVersion`  — a storage concern; migrating a file does not redesign it.
 * - `id`, `name`     — identity and title, not content.
 * - `createdAt`, `updatedAt` — bookkeeping.
 * - `activePageId`, `activeFrameId`, `settings` — editor session/view state.
 *
 * Everything else (`pages`, `versions`, `brand`, `assets`, `fonts`) is content.
 */
export function semanticProjection(document: TelaDocument) {
  return {
    pages: document.pages,
    versions: document.versions,
    brand: document.brand,
    assets: document.assets,
    fonts: document.fonts,
  }
}

export function computeContentRevision(document: TelaDocument): string {
  return sha256Hex(canonicalBytes(semanticProjection(document)))
}
