/**
 * The bytes the storage gate puts in, built on the Node side.
 *
 * Built with the repo's own `writeBundle` over the same maximally-populated fixture
 * the bundle and adapter suites use, so the subject is a real `.tela` archive that
 * `putDocument`'s validation accepts — not a blob shaped to slip past it. The test
 * owning these bytes is what makes byte-identity assertable at all: bytes produced by
 * the app and compared to bytes produced by the app would only prove the app is
 * self-consistent.
 *
 * The large body is a real image asset, because that is the actual shape of the
 * problem CLI-527 solved — one design carrying a couple of photographs exceeds what
 * `localStorage` can hold. The archive stores entries uncompressed (`zip.ts` accepts
 * only STORE), so an asset of N bytes yields a bundle of a little over N.
 */

import { writeBundle } from '@/tela/bundle'
import { base64Encode } from '@/tela/assets'
import { sha256Hex } from '@/tela/sha256'
import { makeFullCoverageDocument } from '@/tela/__fixtures__/fullCoverage'

/** The size the issue names: a body no `localStorage` origin budget could hold. */
export const LARGE_BODY_BYTES = 6 * 1024 * 1024

/**
 * PNG-signature bytes followed by a deterministic pseudo-random tail.
 *
 * Deterministic so a failure's logged sha256 means something across runs, and
 * pseudo-random rather than a constant run so nothing downstream can produce a
 * correct-looking result by collapsing a repeated pattern. The PNG signature is what
 * `sniffMime` reads; the bundle writer never decodes the image.
 */
function pngBytes(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  let state = 0x9e3779b9
  for (let index = 8; index < byteLength; index += 1) {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    bytes[index] = state & 0xff
  }
  return bytes
}

/**
 * Point the fixture's empty image layer at `dataUrl`.
 *
 * Walks for the layer by id rather than indexing a path into the fixture: a path
 * would break silently into "patched nothing" the first time the fixture's shape
 * changed, and the bundle would quietly shrink back to a few kilobytes while every
 * assertion about a 6 MB body kept passing. Throwing is the alternative to that.
 */
function withImagePayload(document: Record<string, unknown>, dataUrl: string): Record<string, unknown> {
  let patched = 0
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (record.id === 'plain-image' && record.type === 'image') {
      record.imageUrl = dataUrl
      patched += 1
    }
    for (const value of Object.values(record)) visit(value)
  }
  visit(document)
  if (patched !== 1) {
    throw new Error(`expected exactly one 'plain-image' layer to patch, patched ${patched}`)
  }
  return document
}

export interface Fixture {
  readonly bytes: Uint8Array
  readonly sha256: string
}

/** A bundle whose body is at least `LARGE_BODY_BYTES`. */
export function largeBundle(): Fixture {
  const dataUrl = `data:image/png;base64,${base64Encode(pngBytes(LARGE_BODY_BYTES))}`
  const bytes = writeBundle(withImagePayload(makeFullCoverageDocument(), dataUrl))
  if (bytes.length < LARGE_BODY_BYTES) {
    // The asset is stored uncompressed, so this can only mean the payload never
    // reached the archive — a fixture that silently stopped being large.
    throw new Error(`large bundle is only ${bytes.length} bytes; the image payload did not land`)
  }
  return { bytes, sha256: sha256Hex(bytes) }
}

/**
 * A small bundle, for the paths that must fit in `localStorage`.
 *
 * The migration fixture has to be seeded as base64 under a `tela-bundle:` key, and
 * base64 of a 6 MB body is 8 MB of UTF-16 — several times the whole origin budget.
 * A legacy body was always a small one; that is the point of the issue.
 */
export function smallBundle(): Fixture {
  const bytes = writeBundle(makeFullCoverageDocument())
  return { bytes, sha256: sha256Hex(bytes) }
}
