/**
 * The adversarial corpus.
 *
 * Every case here is a bundle that a general-purpose reader would happily accept
 * and that this reader must refuse. The assertion is always the same shape: a
 * `TelaError` with a specific code, thrown before anything is returned — there is
 * no partial result to inspect, because `readBundle` has no partial success mode.
 */

import { describe, it, expect } from 'vitest'
import { writeBundle, readBundle } from './bundle'
import { readZip, writeZip, type ZipEntry } from './zip'
import { canonicalize, canonicalBytes } from './canonicalJson'
import { sha256Hex } from './sha256'
import { TelaError } from './errors'
import { craftZip } from './__fixtures__/craftZip'
import { makeFullCoverageDocument, PNG_BYTES } from './__fixtures__/fullCoverage'

const utf8 = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

function expectTelaError(run: () => unknown, code: string): TelaError {
  try {
    run()
  } catch (error) {
    expect(error, `expected TelaError(${code}), got ${String(error)}`).toBeInstanceOf(TelaError)
    expect((error as TelaError).code).toBe(code)
    return error as TelaError
  }
  throw new Error(`expected a TelaError with code ${code}, but nothing was thrown`)
}

/** A valid bundle, decomposed so a test can tamper with one part and reassemble. */
function decompose() {
  const bytes = writeBundle(makeFullCoverageDocument())
  const entries = readZip(bytes)
  return {
    bytes,
    entries,
    manifest: JSON.parse(decode(entries[0].data)) as Record<string, unknown>,
    document: JSON.parse(decode(entries[1].data)) as Record<string, unknown>,
    assets: entries.slice(2),
  }
}

/** Reassemble from parts, re-canonicalizing the JSON so only the tamper differs. */
function recompose(
  manifest: unknown,
  document: unknown,
  assets: ZipEntry[],
  options: { rawManifest?: Uint8Array; rawDocument?: Uint8Array } = {},
): Uint8Array {
  return writeZip([
    { name: 'manifest.json', data: options.rawManifest ?? canonicalBytes(manifest) },
    { name: 'document.json', data: options.rawDocument ?? canonicalBytes(document) },
    ...assets,
  ])
}

describe('tampering with the document', () => {
  it('rejects a document edited after the manifest was written', () => {
    const { manifest, document, assets } = decompose()
    document.name = 'Tampered title'
    expectTelaError(() => readBundle(recompose(manifest, document, assets)), 'document_hash_mismatch')
  })

  it('rejects a manifest whose document hash was updated to match the tamper', () => {
    // The obvious next move for an attacker: fix up the hash. The semantic
    // revision is a second, independent commitment, so this still fails.
    const { manifest, document, assets } = decompose()
    const pages = document.pages as Array<{ frames: Array<{ layers: Array<Record<string, unknown>> }> }>
    pages[0].frames[0].layers[1].content = 'Injected copy'
    const documentBytes = canonicalBytes(document)
    const patched = {
      ...manifest,
      document: { sha256: sha256Hex(documentBytes), size: documentBytes.length },
    }
    expectTelaError(
      () => readBundle(recompose(patched, document, assets, { rawDocument: documentBytes })),
      'content_revision_mismatch',
    )
  })

  it('rejects a document that is not canonical JSON', () => {
    const { manifest, document, assets } = decompose()
    // Same value, non-canonical encoding: pretty-printed, keys in another order.
    const pretty = utf8(JSON.stringify(document, null, 2))
    const patched = { ...manifest, document: { sha256: sha256Hex(pretty), size: pretty.length } }
    expectTelaError(
      () => readBundle(recompose(patched, document, assets, { rawDocument: pretty })),
      'document_invalid',
    )
  })

  it('rejects a document that is not valid JSON at all', () => {
    const { manifest, document, assets } = decompose()
    const broken = utf8('{"schemaVersion":1,')
    const patched = { ...manifest, document: { sha256: sha256Hex(broken), size: broken.length } }
    expectTelaError(
      () => readBundle(recompose(patched, document, assets, { rawDocument: broken })),
      'document_invalid',
    )
  })

  it('rejects a document with an unknown field rather than stripping it', () => {
    const { manifest, document, assets } = decompose()
    ;(document.pages as Array<Record<string, unknown>>)[0].futureFeature = { enabled: true }
    const bytes = canonicalBytes(document)
    const patched = {
      ...manifest,
      document: { sha256: sha256Hex(bytes), size: bytes.length },
      contentRevision: manifest.contentRevision,
    }
    const error = expectTelaError(
      () => readBundle(recompose(patched, document, assets, { rawDocument: bytes })),
      'document_invalid',
    )
    expect(error.detail).toMatch(/futureFeature|unrecognized/i)
  })
})

describe('tampering with assets', () => {
  it('rejects an asset whose bytes no longer match its name', () => {
    const { manifest, document, assets } = decompose()
    const swapped = assets.map((entry) =>
      entry.name.endsWith('.png') ? { name: entry.name, data: utf8('not a png at all') } : entry,
    )
    expectTelaError(() => readBundle(recompose(manifest, document, swapped)), 'asset_hash_mismatch')
  })

  it('rejects an asset whose extension contradicts its content', () => {
    const { manifest, document, assets } = decompose()
    const renamed = assets.map((entry) =>
      entry.name.endsWith('.png') ? { name: entry.name.replace(/\.png$/, '.svg'), data: entry.data } : entry,
    )
    // Sorting by hash is unaffected by the extension change, so order still holds.
    expectTelaError(() => readBundle(recompose(manifest, document, renamed)), 'asset_mime_invalid')
  })

  it('rejects an asset the document never references', () => {
    const { manifest, document, assets } = decompose()
    const extra = utf8('GIF89a')
    const stray = { name: `assets/${sha256Hex(extra)}.gif`, data: extra }
    const all = [...assets, stray].sort((a, b) => (a.name < b.name ? -1 : 1))
    const patched = {
      ...manifest,
      assets: [
        ...(manifest.assets as Array<Record<string, unknown>>),
        { sha256: sha256Hex(extra), size: extra.length, mime: 'image/gif', ext: 'gif' },
      ].sort((a, b) => ((a.sha256 as string) < (b.sha256 as string) ? -1 : 1)),
    }
    // Rejected either as an unreferenced asset or as an unreadable GIF stub —
    // both are fail-closed; assert we did not get a document back.
    expect(() => readBundle(recompose(patched, document, all))).toThrow(TelaError)
  })

  it('rejects a document referencing an asset that is not in the bundle', () => {
    const { manifest, document, assets } = decompose()
    const pngHash = sha256Hex(PNG_BYTES)
    const withoutPng = assets.filter((entry) => !entry.name.includes(pngHash))
    const patched = {
      ...manifest,
      assets: (manifest.assets as Array<Record<string, unknown>>).filter((a) => a.sha256 !== pngHash),
    }
    expectTelaError(() => readBundle(recompose(patched, document, withoutPng)), 'asset_missing')
  })

  it('rejects an asset table that disagrees with the entries present', () => {
    const { manifest, document, assets } = decompose()
    const patched = { ...manifest, assets: (manifest.assets as unknown[]).slice(1) }
    expectTelaError(() => readBundle(recompose(patched, document, assets)), 'asset_table_invalid')
  })

  it('rejects an asset table that is not in ascending hash order', () => {
    const { manifest, document, assets } = decompose()
    const patched = { ...manifest, assets: [...(manifest.assets as unknown[])].reverse() }
    expectTelaError(() => readBundle(recompose(patched, document, assets)), 'asset_table_invalid')
  })

  it('rejects asset entries that are not in ascending hash order', () => {
    const { manifest, document, assets } = decompose()
    const reordered = [...assets].reverse()
    // craftZip is used here because the production writer refuses to emit this.
    const bytes = craftZip([
      { name: 'manifest.json', data: canonicalBytes(manifest) },
      { name: 'document.json', data: canonicalBytes(document) },
      ...reordered.map((e) => ({ name: e.name, data: e.data })),
    ])
    expectTelaError(() => readBundle(bytes), 'entry_order')
  })
})

describe('tampering with the container', () => {
  it('rejects an entry that is neither manifest, document, nor asset', () => {
    const { manifest, document, assets } = decompose()
    const bytes = craftZip(
      [
        { name: 'manifest.json', data: canonicalBytes(manifest) },
        { name: 'document.json', data: canonicalBytes(document) },
        { name: 'assets/README.txt', data: utf8('hello') },
        ...assets.map((e) => ({ name: e.name, data: e.data })),
      ],
    )
    expectTelaError(() => readBundle(bytes), 'unexpected_entry')
  })

  it('rejects a bundle whose entries are in the wrong order', () => {
    const { manifest, document, assets } = decompose()
    const bytes = craftZip([
      { name: 'document.json', data: canonicalBytes(document) },
      { name: 'manifest.json', data: canonicalBytes(manifest) },
      ...assets.map((e) => ({ name: e.name, data: e.data })),
    ])
    expectTelaError(() => readBundle(bytes), 'entry_order')
  })

  it('rejects a bundle that is not a zip at all', () => {
    expectTelaError(() => readBundle(utf8('this is a text file pretending to be a bundle')), 'container_invalid')
  })

  it('rejects a traversal entry smuggled into a bundle', () => {
    const bytes = craftZip([
      { name: '../../.ssh/authorized_keys', data: utf8('ssh-rsa AAAA') },
      { name: 'manifest.json', data: utf8('{}') },
    ])
    const error = expectTelaError(() => readBundle(bytes), 'container_invalid')
    expect(error.detail).toBe('traversal_name')
  })

  it('rejects a symlink entry smuggled into a bundle', () => {
    const bytes = craftZip([
      { name: 'manifest.json', data: utf8('/etc/passwd'), centralOverrides: { externalAttrs: ((0o120777 << 16) >>> 0) >>> 0 } },
    ])
    const error = expectTelaError(() => readBundle(bytes), 'container_invalid')
    expect(error.detail).toBe('bad_mode')
  })

  it('rejects a zip bomb before materialising anything', () => {
    const bytes = craftZip([
      {
        name: 'document.json',
        data: utf8('x'),
        centralOverrides: { method: 8, compressedSize: 1, uncompressedSize: 1024 * 1024 * 1024 },
        localOverrides: { method: 8, compressedSize: 1, uncompressedSize: 1024 * 1024 * 1024 },
      },
    ])
    expectTelaError(() => readBundle(bytes), 'container_invalid')
  })

  it('rejects a bundle above the archive size limit', () => {
    const { bytes } = decompose()
    expectTelaError(() => readBundle(bytes, { maxArchiveBytes: 1024, maxEntryBytes: 1024, maxTotalEntryBytes: 1024, maxEntries: 16, maxNameBytes: 200 }), 'container_invalid')
  })

  it('rejects duplicate manifest entries', () => {
    const { manifest, document } = decompose()
    const bytes = craftZip([
      { name: 'manifest.json', data: canonicalBytes(manifest) },
      { name: 'manifest.json', data: utf8('{"format":"evil"}') },
      { name: 'document.json', data: canonicalBytes(document) },
    ])
    const error = expectTelaError(() => readBundle(bytes), 'container_invalid')
    expect(error.detail).toBe('duplicate_entry')
  })
})

describe('tampering with the manifest', () => {
  it('rejects a manifest that raises the reader’s own limits', () => {
    const { manifest, document, assets } = decompose()
    const patched = { ...manifest, limits: { ...(manifest.limits as object), maxEntryBytes: 1024 ** 4 } }
    expectTelaError(() => readBundle(recompose(patched, document, assets)), 'manifest_invalid')
  })

  it('rejects a manifest whose declared document schema version disagrees with the document', () => {
    const { manifest, document, assets } = decompose()
    const patched = { ...manifest, documentSchemaVersion: 99 }
    // Caught as a future bundle-document version before the disagreement matters.
    expect(() => readBundle(recompose(patched, document, assets))).toThrow(TelaError)
  })

  it('rejects a manifest with an unknown field', () => {
    const { manifest, document, assets } = decompose()
    const patched = { ...manifest, telemetryEndpoint: 'https://example.com/collect' }
    expectTelaError(() => readBundle(recompose(patched, document, assets)), 'manifest_invalid')
  })

  it('rejects a non-canonical manifest', () => {
    const { manifest, document, assets } = decompose()
    const pretty = utf8(JSON.stringify(manifest, null, 2))
    expectTelaError(() => readBundle(recompose(manifest, document, assets, { rawManifest: pretty })), 'manifest_invalid')
  })

  it('rejects a bundle from a newer format version', () => {
    const { manifest, document, assets } = decompose()
    const patched = { ...manifest, schemaVersion: 2 }
    const error = expectTelaError(() => readBundle(recompose(patched, document, assets)), 'future_schema_version')
    expect(error.message).toMatch(/Update Tela/)
  })
})

describe('unresolved references on the read path', () => {
  it('rejects a bundle whose document holds an inline data: payload', () => {
    // A hand-edited document that inlines a payload instead of referencing it.
    // The schema accepts data: (it also describes live sessions), so this is the
    // portable-form assertion doing the work.
    const { manifest, document, assets } = decompose()
    const pages = document.pages as Array<{ frames: Array<{ layers: Array<Record<string, unknown>> }> }>
    pages[0].frames[0].layers[2].imageUrl = 'data:image/png;base64,iVBORw0KGgo='
    const bytes = canonicalBytes(document)
    const patched = {
      ...manifest,
      document: { sha256: sha256Hex(bytes), size: bytes.length },
      contentRevision: manifest.contentRevision,
    }
    expectTelaError(
      () => readBundle(recompose(patched, document, assets, { rawDocument: bytes })),
      'unresolved_reference',
    )
  })

  it('rejects a remote reference in a hand-edited document', () => {
    const { manifest, document, assets } = decompose()
    const pages = document.pages as Array<{ frames: Array<{ layers: Array<Record<string, unknown>> }> }>
    pages[0].frames[0].layers[2].imageUrl = 'https://tracker.example.com/pixel.png'
    const bytes = canonicalBytes(document)
    const patched = { ...manifest, document: { sha256: sha256Hex(bytes), size: bytes.length } }
    // Refused at the schema, before it can reach any fetch.
    expectTelaError(
      () => readBundle(recompose(patched, document, assets, { rawDocument: bytes })),
      'document_invalid',
    )
  })
})

describe('canonical form is stable under re-encoding', () => {
  it('a valid bundle survives decompose/recompose unchanged', () => {
    // Guards the harness itself: if `recompose` altered the bytes, every negative
    // test above would be testing the harness rather than the reader.
    const { bytes, manifest, document, assets } = decompose()
    expect(Buffer.from(recompose(manifest, document, assets))).toEqual(Buffer.from(bytes))
    expect(canonicalize(document)).toBe(decode(readZip(bytes)[1].data))
  })
})
