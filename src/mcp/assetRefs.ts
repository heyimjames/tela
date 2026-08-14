/**
 * The portable-reference boundary.
 *
 * There are two legitimate forms of an asset reference and they belong to
 * different layers of the system:
 *
 *  - **`asset://<sha256>`** — the portable form. It is what a `.tela` file
 *    contains, and it is what crosses the MCP boundary in both directions.
 *  - **`data:<mime>;base64,…`** — the session form. It is what the editing
 *    session and the renderer hold, because they need the actual bytes.
 *
 * Without a boundary the two leak into each other: a caller that put an
 * `asset://` reference on a layer would read back a `data:` URL after a save and
 * reopen (because the bundle reader inlines payloads), so the same layer would
 * appear to change without anyone editing it — and comparing a layer to itself
 * across a round trip would fail. Worse, every read would drip whole base64
 * payloads through the transport.
 *
 * So this module translates at the edge: portable in, portable out, session form
 * only ever inside. Payloads never cross the MCP boundary.
 */

import { hashFromRef } from '../tela/assets'
import { sha256Hex } from '../tela/sha256'
import type { TelaDocument } from '../tela/schema'
import { toolError } from './errors'

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.*)$/i

/** Content hash of a `data:` URL's payload, or `null` when it is not one. */
function hashOfDataUrl(value: string): string | null {
  const match = DATA_URL.exec(value)
  if (!match) return null
  try {
    return sha256Hex(new Uint8Array(Buffer.from(match[2], 'base64')))
  } catch {
    return null
  }
}

export interface RefIndex {
  /** `asset://<sha>` → the session `data:` URL holding those bytes. */
  toSession: Map<string, string>
  /** session `data:` URL → `asset://<sha>`. */
  toPortable: Map<string, string>
}

/**
 * Build the translation table from everything the document currently holds.
 *
 * Every payload in a valid document is reachable from the asset table, the font
 * table, or a layer, so walking those three is exhaustive. Hashing is done once
 * per call rather than cached: an index built from a stale document would
 * translate a reference to bytes that are no longer there, which is a far worse
 * failure than the cost of hashing a handful of small payloads.
 */
export function buildRefIndex(document: TelaDocument): RefIndex {
  const toSession = new Map<string, string>()
  const toPortable = new Map<string, string>()

  const record = (value: string | undefined): void => {
    if (!value || toPortable.has(value)) return
    const hash = hashOfDataUrl(value)
    if (!hash) return
    const portable = `asset://${hash}`
    toPortable.set(value, portable)
    if (!toSession.has(portable)) toSession.set(portable, value)
  }

  for (const asset of document.assets) record(asset.ref)
  for (const font of document.fonts) record(font.ref)
  for (const page of document.pages) {
    for (const frame of page.frames) {
      if (frame.backgroundFill.type === 'image') record(frame.backgroundFill.imageUrl)
      for (const layer of [...frame.layers, ...page.looseElements]) {
        if (layer.type === 'image') record(layer.imageUrl)
        else if (layer.type === 'background' && layer.fill.type === 'image') record(layer.fill.imageUrl)
      }
    }
  }

  return { toSession, toPortable }
}

/** Reference-bearing keys. Kept in one place so a new one is added once, not per call site. */
const REFERENCE_FIELDS = ['imageUrl', 'ref'] as const

/**
 * Rewrite every asset reference in a value, leaving everything else untouched.
 *
 * Structural rather than field-by-field: a nested fill inside a background layer
 * is as much a reference as a top-level `imageUrl`, and a hand-written list of
 * paths would miss it the first time the schema grows.
 */
function rewrite<T>(value: T, translate: (reference: string) => string): T {
  if (Array.isArray(value)) return value.map((item) => rewrite(item, translate)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] =
        typeof item === 'string' && (REFERENCE_FIELDS as readonly string[]).includes(key) ? translate(item) : rewrite(item, translate)
    }
    return out as T
  }
  return value
}

/** Session form → portable form, for anything about to be returned to a client. */
export function toPortableRefs<T>(value: T, index: RefIndex): T {
  return rewrite(value, (reference) => {
    if (reference === '' || reference.startsWith('asset://')) return reference
    return index.toPortable.get(reference) ?? hashFallback(reference)
  })
}

/**
 * A payload with no index entry still must not be emitted verbatim.
 *
 * Returning the raw `data:` URL would leak the whole payload through the
 * transport, which is the thing this boundary exists to prevent, so it is hashed
 * into a portable reference on the spot.
 */
function hashFallback(reference: string): string {
  const hash = hashOfDataUrl(reference)
  return hash ? `asset://${hash}` : ''
}

/**
 * Portable form → session form, for anything arriving from a client.
 *
 * An `asset://` reference naming bytes the design does not hold is refused with
 * the fix in the message. Accepting it would produce a document that fails its
 * own invariants at save time, several calls later, with no clue as to which
 * layer caused it.
 */
export function toSessionRefs<T>(value: T, index: RefIndex): T {
  return rewrite(value, (reference) => {
    if (reference === '' || !reference.startsWith('asset://')) return reference
    const resolved = index.toSession.get(reference)
    if (!resolved) {
      const hash = hashFromRef(reference)
      throw toolError(
        'not_found',
        `this design holds no asset ${hash ? `with hash ${hash.slice(0, 12)}…` : `for reference "${reference}"`}`,
        'import the file with tela_import_asset first and use the ref it returns; tela_list_assets shows what this design already holds',
      )
    }
    return resolved
  })
}
