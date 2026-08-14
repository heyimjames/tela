import { describe, it, expect } from 'vitest'
import { writeBundle, readBundle, readBundleForEditing, MANIFEST_ENTRY, DOCUMENT_ENTRY } from './bundle'
import { readZip } from './zip'
import { canonicalize } from './canonicalJson'
import { sha256Hex } from './sha256'
import { computeContentRevision } from './contentRevision'
import { TelaError } from './errors'
import { makeFullCoverageDocument, PNG_BYTES, PNG_DATA_URL } from './__fixtures__/fullCoverage'

/**
 * Deeply reorder every object's keys, so the *same document* arrives with a
 * different insertion order. Canonicalization is the only thing standing between
 * that and different bytes.
 */
function shuffleKeys<T>(value: T, seed = { n: 1 }): T {
  if (Array.isArray(value)) return value.map((item) => shuffleKeys(item, seed)) as T
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const keys = Object.keys(source)
    // Deterministic pseudo-shuffle, so a failure is reproducible.
    keys.sort((a, b) => {
      seed.n = (seed.n * 1103515245 + 12345) & 0x7fffffff
      return seed.n % 2 === 0 ? (a < b ? 1 : -1) : a < b ? -1 : 1
    })
    const out: Record<string, unknown> = {}
    for (const key of keys) out[key] = shuffleKeys(source[key], seed)
    return out as T
  }
  return value
}

describe('bundle structure', () => {
  const bytes = writeBundle(makeFullCoverageDocument())
  const entries = readZip(bytes)

  it('holds exactly manifest, document, and content-addressed assets, in that order', () => {
    expect(entries[0].name).toBe(MANIFEST_ENTRY)
    expect(entries[1].name).toBe(DOCUMENT_ENTRY)
    const assetNames = entries.slice(2).map((e) => e.name)
    expect(assetNames.length).toBeGreaterThan(0)
    for (const name of assetNames) expect(name).toMatch(/^assets\/[0-9a-f]{64}\.(png|jpg|gif|webp|svg|woff2)$/)
    expect([...assetNames]).toEqual([...assetNames].sort())
  })

  it('names each asset after the hash of its own bytes', () => {
    for (const entry of entries.slice(2)) {
      expect(entry.name).toBe(`assets/${sha256Hex(entry.data)}.${entry.name.split('.').pop()}`)
    }
  })

  it('stores a payload once even when it is referenced twice', () => {
    // The fixture points both `rich-image.imageUrl` and the `asset-png` record at
    // the same PNG. Content addressing must collapse them into one entry.
    const pngHash = sha256Hex(PNG_BYTES)
    const matching = entries.filter((e) => e.name.includes(pngHash))
    expect(matching).toHaveLength(1)
    const document = new TextDecoder().decode(entries[1].data)
    expect(document.split(`asset://${pngHash}`).length - 1).toBeGreaterThanOrEqual(2)
  })

  it('writes canonical JSON for both the manifest and the document', () => {
    for (const entry of [entries[0], entries[1]]) {
      const text = new TextDecoder().decode(entry.data)
      expect(canonicalize(JSON.parse(text))).toBe(text)
    }
  })

  it('carries no save-time timestamp in the manifest', () => {
    const manifest = JSON.parse(new TextDecoder().decode(entries[0].data))
    const text = JSON.stringify(manifest)
    expect(Object.keys(manifest)).not.toContain('savedAt')
    expect(Object.keys(manifest)).not.toContain('timestamp')
    // Every ISO timestamp in the manifest would have to come from the clock.
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })

  it('records producer, hashes, limits, migration metadata, and a semantic revision', () => {
    const { manifest, document } = readBundle(bytes)
    expect(manifest.format).toBe('tela-bundle')
    expect(manifest.producer.name).toBe('tela-design')
    expect(manifest.producer.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(manifest.document.sha256).toBe(sha256Hex(entries[1].data))
    expect(manifest.document.size).toBe(entries[1].data.length)
    expect(manifest.assets).toHaveLength(entries.length - 2)
    expect(manifest.migration).toEqual({ originalDocumentSchemaVersion: 1, applied: [] })
    expect(manifest.contentRevision).toBe(computeContentRevision(document))
    expect(manifest.limits.maxEntries).toBeGreaterThan(0)
  })
})

describe('lossless round trip', () => {
  it('preserves every field through export → import → export', () => {
    const original = makeFullCoverageDocument()
    const first = writeBundle(original)
    const reopened = readBundleForEditing(first)
    const second = writeBundle(reopened.document)

    expect(Buffer.from(second)).toEqual(Buffer.from(first))
  })

  it('returns a session document semantically identical to the input', () => {
    const original = makeFullCoverageDocument()
    const reopened = readBundleForEditing(writeBundle(original))
    // Compare canonically: the fixture and the reopened document may differ in key
    // order, which is exactly the difference the format is allowed to erase.
    expect(canonicalize(reopened.document)).toBe(canonicalize(original))
  })

  it('keeps the three frame fields the legacy DesignFile path dropped', () => {
    const reopened = readBundleForEditing(writeBundle(makeFullCoverageDocument()))
    const frame = reopened.document.pages[0].frames[0]
    expect(frame.backgroundColor).toEqual({ token: 'cloud', hex: '#f5f5f7' })
    expect(frame.locked).toBe(true)
    expect(frame.visible).toBe(false)
  })

  it('keeps loose elements, which the legacy path had nowhere to store', () => {
    const reopened = readBundleForEditing(writeBundle(makeFullCoverageDocument()))
    expect(reopened.document.pages[0].looseElements.map((l) => l.id)).toEqual(['loose-note', 'loose-sketch'])
  })

  it('keeps nested auto-layout, active ids, settings, versions, brand, and fonts', () => {
    const { document } = readBundleForEditing(writeBundle(makeFullCoverageDocument()))
    expect(document.pages[0].frames[0].autoLayouts?.['group-inner'].parentGroupId).toBe('group-outer')
    expect(document.activePageId).toBe('page-one')
    expect(document.activeFrameId).toBe('frame-rich')
    expect(document.settings).toEqual({ showFrameLabels: false, snapFrames: true })
    expect(document.versions[0].document.layers[0].id).toBe('version-image')
    expect(document.brand.ai.callToAction).toBe('Start designing')
    expect(document.fonts[0].license).toContain('seat 4211')
  })

  it('restores asset payloads byte-for-byte', () => {
    const { document } = readBundleForEditing(writeBundle(makeFullCoverageDocument()))
    const image = document.pages[0].frames[0].layers.find((l) => l.id === 'rich-image')
    expect(image && 'imageUrl' in image ? image.imageUrl : '').toBe(PNG_DATA_URL)
  })

  it('preserves an empty reference as empty rather than inventing an asset', () => {
    const { document } = readBundleForEditing(writeBundle(makeFullCoverageDocument()))
    const image = document.pages[1].frames[0]
    expect(image.backgroundFill.type).toBe('image')
    const plain = document.pages[0].frames[1].layers.find((l) => l.id === 'plain-image')
    expect(plain && 'imageUrl' in plain ? plain.imageUrl : 'x').toBe('')
  })
})

describe('byte determinism', () => {
  it('is insensitive to key insertion order', () => {
    const original = makeFullCoverageDocument()
    const shuffled = shuffleKeys(original)
    expect(JSON.stringify(Object.keys(shuffled))).not.toBe(JSON.stringify(Object.keys(original)))
    expect(Buffer.from(writeBundle(shuffled))).toEqual(Buffer.from(writeBundle(original)))
  })

  it('orders asset entries by hash, not by the order they were encountered', () => {
    // Reversing the asset records changes which payload the packer meets first.
    // Entry order is defined by content address, so the archive layout must not
    // follow the document's own ordering. (The document bytes legitimately differ
    // here — the asset list is content — but the entry *order* must not.)
    const reversed = makeFullCoverageDocument()
    ;(reversed.assets as unknown[]).reverse()

    const forwardNames = readZip(writeBundle(makeFullCoverageDocument())).slice(2).map((e) => e.name)
    const reversedNames = readZip(writeBundle(reversed)).slice(2).map((e) => e.name)
    expect(reversedNames).toEqual(forwardNames)
    expect(reversedNames).toEqual([...reversedNames].sort())
  })

  it('is insensitive to the process timezone and locale', () => {
    const original = makeFullCoverageDocument()
    const baseline = writeBundle(original)
    const previousTz = process.env.TZ
    for (const tz of ['UTC', 'Pacific/Kiritimati', 'America/St_Johns', 'Asia/Kathmandu']) {
      process.env.TZ = tz
      expect(Buffer.from(writeBundle(makeFullCoverageDocument()))).toEqual(Buffer.from(baseline))
    }
    process.env.TZ = previousTz
  })

  it('contains no byte that could differ between macOS and Windows', () => {
    // The determinism claim across platforms rests on there being no
    // platform-derived input at all. These are the three ways one could sneak in.
    const bytes = writeBundle(makeFullCoverageDocument())
    const entries = readZip(bytes)

    // Entry names are forward-slash only; a Windows writer must not emit `\`.
    for (const entry of entries) expect(entry.name).not.toContain('\\')

    // The JSON entries hold no line endings at all — canonical JSON is one line —
    // so there is no CRLF/LF divergence to worry about.
    const manifestText = new TextDecoder().decode(entries[0].data)
    const documentText = new TextDecoder().decode(entries[1].data)
    expect(manifestText).not.toMatch(/[\r\n]/)
    expect(documentText).not.toMatch(/[\r\n]/)

    const view = new DataView(bytes.buffer)
    const eocd = bytes.length - 22
    const centralOffset = view.getUint32(eocd + 16, true)
    expect(view.getUint16(centralOffset + 12, true)).toBe(0x0000)
    expect(view.getUint16(centralOffset + 14, true)).toBe(0x0021)
  })

  it('produces the same bundle from an independently rebuilt fixture', () => {
    expect(Buffer.from(writeBundle(makeFullCoverageDocument()))).toEqual(
      Buffer.from(writeBundle(makeFullCoverageDocument())),
    )
  })
})

describe('no-op open/save/reopen', () => {
  it('preserves the semantic revision and the bundle bytes', () => {
    const first = writeBundle(makeFullCoverageDocument())
    const firstRead = readBundle(first)

    const opened = readBundleForEditing(first)
    const second = writeBundle(opened.document)
    const secondRead = readBundle(second)

    expect(secondRead.manifest.contentRevision).toBe(firstRead.manifest.contentRevision)
    expect(secondRead.manifest.document.sha256).toBe(firstRead.manifest.document.sha256)
    expect(Buffer.from(second)).toEqual(Buffer.from(first))

    // And again, to catch a drift that only appears on the second cycle.
    const third = writeBundle(readBundleForEditing(second).document)
    expect(Buffer.from(third)).toEqual(Buffer.from(first))
  })

  it('ignores session-only changes in the semantic revision but not in the bytes', () => {
    const base = makeFullCoverageDocument()
    const moved = makeFullCoverageDocument()
    moved.activeFrameId = 'frame-plain'
    ;(moved.settings as Record<string, unknown>).showFrameLabels = true

    const a = readBundle(writeBundle(base))
    const b = readBundle(writeBundle(moved))
    expect(b.manifest.contentRevision).toBe(a.manifest.contentRevision)
    expect(b.manifest.document.sha256).not.toBe(a.manifest.document.sha256)
  })

  it('changes the semantic revision when the artwork changes', () => {
    const edited = makeFullCoverageDocument()
    const pages = edited.pages as Array<{ frames: Array<{ layers: Array<Record<string, unknown>> }> }>
    pages[0].frames[0].layers[1].content = 'A different headline'

    const a = readBundle(writeBundle(makeFullCoverageDocument()))
    const b = readBundle(writeBundle(edited))
    expect(b.manifest.contentRevision).not.toBe(a.manifest.contentRevision)
  })
})

describe('write-side refusals', () => {
  function expectTelaError(run: () => unknown, code: string) {
    try {
      run()
    } catch (error) {
      expect(error).toBeInstanceOf(TelaError)
      expect((error as TelaError).code).toBe(code)
      return
    }
    throw new Error(`expected a TelaError with code ${code}, but nothing was thrown`)
  }

  it('refuses unresolved blob:, file:, and remote references', () => {
    for (const url of ['blob:http://localhost/9f2b', 'file:///Users/someone/photo.png', 'https://cdn.example.com/a.png']) {
      const document = makeFullCoverageDocument()
      const pages = document.pages as Array<{ frames: Array<{ layers: Array<Record<string, unknown>> }> }>
      pages[0].frames[0].layers[2].imageUrl = url
      expectTelaError(() => writeBundle(document), 'unresolved_reference')
    }
  })

  it('refuses an unsupported asset type', () => {
    const document = makeFullCoverageDocument()
    const pages = document.pages as Array<{ frames: Array<{ layers: Array<Record<string, unknown>> }> }>
    // A PDF: a real file type, but not one this format accepts.
    pages[0].frames[0].layers[2].imageUrl = 'data:application/pdf;base64,JVBERi0xLjQK'
    expectTelaError(() => writeBundle(document), 'asset_mime_invalid')
  })

  it('refuses a payload whose declared type is a lie', () => {
    const document = makeFullCoverageDocument()
    const pages = document.pages as Array<{ frames: Array<{ layers: Array<Record<string, unknown>> }> }>
    // Declared PNG, actually an ELF binary. Sniffing is what catches this.
    pages[0].frames[0].layers[2].imageUrl = 'data:image/png;base64,f0VMRgIBAQAAAAAAAAAAAAA='
    expectTelaError(() => writeBundle(document), 'asset_mime_invalid')
  })

  it('refuses a document that fails schema validation', () => {
    const document = makeFullCoverageDocument()
    ;(document as Record<string, unknown>).unexpectedField = true
    expectTelaError(() => writeBundle(document), 'document_invalid')
  })

  it('refuses NaN geometry rather than writing null', () => {
    const document = makeFullCoverageDocument()
    const pages = document.pages as Array<{ frames: Array<{ layers: Array<Record<string, unknown>> }> }>
    pages[0].frames[0].layers[1].x = NaN
    expectTelaError(() => writeBundle(document), 'document_invalid')
  })
})
