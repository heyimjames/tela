/**
 * Content addressing: turning embedded payloads into `asset://<sha256>` references
 * and back again.
 *
 * The walk is driven by a *key* allow-list rather than a hand-written traversal of
 * the document shape. That matters for correctness: saved versions embed whole
 * historical documents, each with their own layers and fills, and a hand-written
 * traversal would forget one of them the first time the shape changed. Walking by
 * key reaches every reference wherever it lives, now and after the schema grows.
 */

import { sha256Hex, isSha256Hex } from './sha256'
import { sniffMime, extensionForMime } from './mime'
import { telaError } from './errors'
import { ASSET_REF_PATTERN, type SupportedAssetMime } from './schema'

/** Every document key whose string value is an asset reference. */
export const REFERENCE_KEYS = new Set(['imageUrl', 'ref'])

export interface AssetBlob {
  sha256: string
  bytes: Uint8Array
  mime: SupportedAssetMime
  ext: string
}

// --- base64 -------------------------------------------------------------------
// Hand-rolled rather than `atob`/`Buffer`: `atob` does not exist in Node's default
// globals on every supported version and `Buffer` does not exist in the browser.
// One implementation avoids a conditional that could behave differently per host.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INVERSE = (() => {
  const table = new Int16Array(256).fill(-1)
  for (let i = 0; i < B64.length; i++) table[B64.charCodeAt(i)] = i
  // Accept the URL-safe alphabet on input; we only ever *emit* standard base64.
  table['-'.charCodeAt(0)] = 62
  table['_'.charCodeAt(0)] = 63
  return table
})()

export function base64Encode(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63]
  }
  const remaining = bytes.length - i
  if (remaining === 1) {
    const n = bytes[i] << 16
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + '=='
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + '='
  }
  return out
}

/** The 6-bit value of a base64 character, or -1 if it is not one. */
function sextet(code: number): number {
  // The table only covers Latin-1; anything above it is not base64 and must fail
  // closed. Indexing past the table yields `undefined`, which compares false against
  // -1 and would otherwise be accepted and contribute zero bits — silent corruption.
  return code < 256 ? B64_INVERSE[code] : -1
}

export function base64Decode(input: string): Uint8Array {
  const values: number[] = []
  let padding = 0
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    // Strip whitespace, which data: URLs from real-world sources often contain.
    if (code === 32 || code === 9 || code === 10 || code === 13) continue
    if (code === 61 /* = */) {
      // Padding is only meaningful at the very end, and never more than two of it.
      padding++
      if (padding > 2) throw new Error('invalid base64 input')
      continue
    }
    if (padding > 0) throw new Error('invalid base64 input')
    const value = sextet(code)
    if (value === -1) throw new Error('invalid base64 input')
    values.push(value)
  }
  // A group of a single character carries fewer than 8 bits and cannot be valid.
  if (values.length % 4 === 1) throw new Error('invalid base64 input')

  const out = new Uint8Array(Math.floor((values.length * 3) / 4))
  let acc = 0
  let bits = 0
  let index = 0
  for (const value of values) {
    acc = (acc << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[index++] = (acc >>> bits) & 0xff
    }
  }
  return out.subarray(0, index)
}

// --- data: URLs ---------------------------------------------------------------

const DATA_URL = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/

function decodeDataUrl(value: string): Uint8Array {
  const match = DATA_URL.exec(value)
  if (!match) throw telaError('asset_mime_invalid', 'malformed data: URL')
  const parameters = match[2]
  const payload = match[3]
  if (/;base64/i.test(parameters)) {
    try {
      return base64Decode(payload)
    } catch {
      throw telaError('asset_mime_invalid', 'data: URL has an invalid base64 payload')
    }
  }
  // Percent-encoded textual payload (how inline SVG normally arrives).
  return new TextEncoder().encode(decodeURIComponent(payload))
}

export function makeAssetBlob(bytes: Uint8Array): AssetBlob {
  const mime = sniffMime(bytes)
  if (!mime) {
    throw telaError(
      'asset_mime_invalid',
      'asset content does not match any accepted type (png, jpeg, gif, webp, svg, woff2)',
    )
  }
  return { sha256: sha256Hex(bytes), bytes, mime, ext: extensionForMime(mime) }
}

export function assetRefFor(sha256: string): string {
  return `asset://${sha256}`
}

export function hashFromRef(ref: string): string | null {
  if (!ARef.test(ref)) return null
  return ref.slice('asset://'.length)
}

const ARef = ASSET_REF_PATTERN

// --- Walking ------------------------------------------------------------------

type Plain = Record<string, unknown>

function isPlainObject(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapReferences(value: unknown, path: string, transform: (raw: string, path: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => mapReferences(item, `${path}[${index}]`, transform))
  }
  if (isPlainObject(value)) {
    const out: Plain = {}
    for (const key of Object.keys(value)) {
      const child = value[key]
      const childPath = path ? `${path}.${key}` : key
      if (REFERENCE_KEYS.has(key) && typeof child === 'string') {
        out[key] = transform(child, childPath)
      } else {
        out[key] = mapReferences(child, childPath, transform)
      }
    }
    return out
  }
  return value
}

export interface PackResult<T> {
  document: T
  assets: AssetBlob[]
}

/**
 * Replace every embedded payload with an `asset://` reference and collect the blobs.
 *
 * Anything that is not already a reference, an empty string, or an inlinable
 * `data:` URL is refused. That includes `blob:` (session-scoped and meaningless in
 * a portable file), `file:` (host-specific and a read-outside-the-bundle vector),
 * and `http(s):` (would make opening a design perform a network fetch — forbidden
 * by the v1 runtime contract).
 */
export function packAssets<T>(document: T): PackResult<T> {
  const byHash = new Map<string, AssetBlob>()

  const packed = mapReferences(document, '', (raw, path) => {
    if (raw === '' || ARef.test(raw)) return raw
    if (raw.startsWith('data:')) {
      const blob = makeAssetBlob(decodeDataUrl(raw))
      if (!byHash.has(blob.sha256)) byHash.set(blob.sha256, blob)
      return assetRefFor(blob.sha256)
    }
    throw telaError(
      'unresolved_reference',
      `unresolved reference at ${path}: a portable bundle cannot carry blob:, file:, or remote references`,
      raw.slice(0, 64),
    )
  }) as T

  // Ascending by hash. The bundle's entry order is defined in terms of this list,
  // so sorting here rather than at write time keeps one source of truth for order.
  const assets = [...byHash.values()].sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0))
  return { document: packed, assets }
}

/** Resolve every `asset://` reference back to a `data:` URL for the editing session. */
export function unpackAssets<T>(document: T, blobs: Map<string, AssetBlob>): T {
  return mapReferences(document, '', (raw, path) => {
    if (raw === '') return raw
    const hash = hashFromRef(raw)
    if (hash === null) {
      throw telaError('unresolved_reference', `reference at ${path} is not an asset:// URL`, raw.slice(0, 64))
    }
    const blob = blobs.get(hash)
    if (!blob) {
      throw telaError('asset_missing', `reference at ${path} points at an asset that is not in the bundle`, hash)
    }
    return `data:${blob.mime};base64,${base64Encode(blob.bytes)}`
  }) as T
}

/**
 * Assert that every reference in a document is in the *portable* form.
 *
 * The schema deliberately also accepts `data:` so one document type can describe
 * both a file and a live session. This is the check that keeps the file contract
 * absolute: a written bundle, and a bundle being read, may contain nothing but
 * `asset://<sha256>` and the empty string. Called on both paths, so neither a bug
 * in the packer nor a hand-edited document can smuggle an inline payload — or a
 * remote URL that would turn "open a design" into a network fetch — into a master.
 */
export function assertPortableReferences(document: unknown): void {
  mapReferences(document, '', (raw, path) => {
    if (raw === '' || ARef.test(raw)) return raw
    throw telaError(
      'unresolved_reference',
      `reference at ${path} is not portable; a bundle may only contain asset://<sha256> references`,
      raw.slice(0, 64),
    )
  })
}

/** Every hash referenced anywhere in the document. */
export function collectReferencedHashes(document: unknown): Set<string> {
  const hashes = new Set<string>()
  mapReferences(document, '', (raw) => {
    const hash = hashFromRef(raw)
    if (hash !== null && isSha256Hex(hash)) hashes.add(hash)
    return raw
  })
  return hashes
}
