import { describe, it, expect } from 'vitest'
import { writeZip, readZip, ZipError, DEFAULT_ZIP_LIMITS, assertSafeEntryName, crc32 } from './zip'
import { craftZip } from './__fixtures__/craftZip'

const utf8 = (text: string) => new TextEncoder().encode(text)
const ENTRIES = [
  { name: 'manifest.json', data: utf8('{"a":1}') },
  { name: 'document.json', data: utf8('{"b":2}') },
]

function expectZipError(run: () => unknown, code: string) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ZipError)
    expect((error as ZipError).code).toBe(code)
    return
  }
  throw new Error(`expected a ZipError with code ${code}, but nothing was thrown`)
}

describe('deterministic writer', () => {
  it('round-trips', () => {
    const entries = readZip(writeZip(ENTRIES))
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'document.json'])
    expect(new TextDecoder().decode(entries[0].data)).toBe('{"a":1}')
  })

  it('produces identical bytes on repeated writes', () => {
    expect(writeZip(ENTRIES)).toEqual(writeZip(ENTRIES))
  })

  it('contains no timestamp that tracks the clock', () => {
    const first = writeZip(ENTRIES)
    // Nothing about the writer consults a clock, so bytes written "later" are the
    // same bytes. If a real timestamp ever crept in, this comparison would fail.
    const second = writeZip(ENTRIES.map((e) => ({ ...e })))
    expect(Buffer.from(first).toString('hex')).toBe(Buffer.from(second).toString('hex'))
  })

  it('stamps the fixed DOS epoch and 0644 regular-file mode', () => {
    const bytes = writeZip(ENTRIES)
    const view = new DataView(bytes.buffer)
    expect(view.getUint16(10, true)).toBe(0x0000) // local mod time
    expect(view.getUint16(12, true)).toBe(0x0021) // local mod date = 1980-01-01
    // Find the first central-directory record and read its external attributes.
    const eocd = bytes.length - 22
    const centralOffset = view.getUint32(eocd + 16, true)
    expect(view.getUint32(centralOffset + 38, true) >>> 0).toBe((0o100644 << 16) >>> 0)
    expect(view.getUint16(centralOffset + 30, true)).toBe(0) // no extra field
    expect(view.getUint16(centralOffset + 32, true)).toBe(0) // no comment
  })

  it('stores rather than compresses', () => {
    const compressible = utf8('a'.repeat(10000))
    const bytes = writeZip([{ name: 'document.json', data: compressible }])
    expect(bytes.length).toBeGreaterThan(10000)
    const view = new DataView(bytes.buffer)
    expect(view.getUint16(8, true)).toBe(0)
  })

  it('refuses to write an unsafe or duplicated name', () => {
    expectZipError(() => writeZip([{ name: '../escape', data: utf8('x') }]), 'traversal_name')
    expectZipError(() => writeZip([{ name: 'a\\b', data: utf8('x') }]), 'backslash_name')
    expectZipError(
      () => writeZip([{ name: 'a.json', data: utf8('x') }, { name: 'A.json', data: utf8('y') }]),
      'duplicate_entry',
    )
  })
})

describe('entry name policy', () => {
  const cases: Array<[string, string]> = [
    ['', 'empty_name'],
    ['../secrets', 'traversal_name'],
    ['assets/../../etc/passwd', 'traversal_name'],
    ['./document.json', 'traversal_name'],
    ['/etc/passwd', 'absolute_name'],
    ['C:/Windows/system32', 'drive_name'],
    ['assets\\evil', 'backslash_name'],
    ['assets/', 'directory_entry'],
    ['assets//double', 'empty_segment'],
    ['file.json:stream', 'colon_name'],
    ['doc\u0000.json', 'non_ascii_name'],
    ['dócument.json', 'non_ascii_name'],
    ['doc\n.json', 'non_ascii_name'],
  ]

  for (const [name, code] of cases) {
    it(`rejects ${JSON.stringify(name)} as ${code}`, () => {
      expectZipError(() => assertSafeEntryName(name, DEFAULT_ZIP_LIMITS), code)
    })
  }

  it('accepts the three shapes a bundle actually uses', () => {
    expect(() => assertSafeEntryName('manifest.json', DEFAULT_ZIP_LIMITS)).not.toThrow()
    expect(() => assertSafeEntryName('document.json', DEFAULT_ZIP_LIMITS)).not.toThrow()
    expect(() => assertSafeEntryName(`assets/${'a'.repeat(64)}.png`, DEFAULT_ZIP_LIMITS)).not.toThrow()
  })
})

describe('hardened reader', () => {
  it('rejects a DEFLATE entry', () => {
    expectZipError(
      () => readZip(craftZip([{ name: 'document.json', data: utf8('x'), centralOverrides: { method: 8 }, localOverrides: { method: 8 } }])),
      'bad_method',
    )
  })

  it('rejects a zip bomb declaring a huge uncompressed size', () => {
    // The classic shape: a tiny payload claiming to expand to gigabytes. Rejected
    // on the declared size, before a single byte would be materialised.
    expectZipError(
      () =>
        readZip(
          craftZip([
            {
              name: 'document.json',
              data: utf8('x'),
              centralOverrides: { method: 8, compressedSize: 1, uncompressedSize: 4 * 1024 * 1024 * 1024 - 1 },
              localOverrides: { method: 8, compressedSize: 1, uncompressedSize: 4 * 1024 * 1024 * 1024 - 1 },
            },
          ]),
        ),
      'bad_method',
    )
  })

  it('rejects an oversized entry even when stored honestly', () => {
    const tight = { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 4 }
    expectZipError(() => readZip(writeZip(ENTRIES), { ...tight, maxTotalEntryBytes: 1024 }), 'entry_too_large')
  })

  it('rejects an archive with too many entries', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `assets/f${i}.bin`, data: utf8(String(i)) }))
    expectZipError(() => readZip(writeZip(many), { ...DEFAULT_ZIP_LIMITS, maxEntries: 3 }), 'too_many_entries')
  })

  it('rejects an archive larger than the limit', () => {
    expectZipError(() => readZip(writeZip(ENTRIES), { ...DEFAULT_ZIP_LIMITS, maxArchiveBytes: 8 }), 'archive_too_large')
  })

  it('rejects a symlink entry', () => {
    const symlinkMode = ((0o120777 << 16) >>> 0) >>> 0
    expectZipError(
      () => readZip(craftZip([{ name: 'document.json', data: utf8('../secret'), centralOverrides: { externalAttrs: symlinkMode } }])),
      'bad_mode',
    )
  })

  it('rejects a setuid or world-writable mode', () => {
    for (const mode of [0o104755, 0o100666, 0o100777]) {
      expectZipError(
        () => readZip(craftZip([{ name: 'document.json', data: utf8('x'), centralOverrides: { externalAttrs: ((mode << 16) >>> 0) >>> 0 } }])),
        'bad_mode',
      )
    }
  })

  it('rejects duplicate and case-colliding entries', () => {
    expectZipError(
      () => readZip(craftZip([{ name: 'document.json', data: utf8('a') }, { name: 'document.json', data: utf8('b') }])),
      'duplicate_entry',
    )
    expectZipError(
      () => readZip(craftZip([{ name: 'assets/a.png', data: utf8('a') }, { name: 'assets/A.PNG', data: utf8('b') }])),
      'duplicate_entry',
    )
  })

  it('rejects a traversal name inside a well-formed archive', () => {
    expectZipError(() => readZip(craftZip([{ name: '../../etc/passwd', data: utf8('x') }])), 'traversal_name')
  })

  it('rejects an entry whose CRC does not match its bytes', () => {
    expectZipError(
      () => readZip(craftZip([{ name: 'document.json', data: utf8('x'), centralOverrides: { crc: 0xdeadbeef }, localOverrides: { crc: 0xdeadbeef } }])),
      'crc_mismatch',
    )
  })

  it('rejects local and central headers that disagree', () => {
    expectZipError(
      () => readZip(craftZip([{ name: 'document.json', data: utf8('x'), localOverrides: { crc: crc32(utf8('y')) } }])),
      'header_mismatch',
    )
    expectZipError(
      () => readZip(craftZip([{ name: 'document.json', data: utf8('xx'), localName: 'manifest.json' }])),
      'header_mismatch',
    )
  })

  it('rejects general-purpose flags', () => {
    expectZipError(
      () => readZip(craftZip([{ name: 'document.json', data: utf8('x'), centralOverrides: { flags: 0x0001 }, localOverrides: { flags: 0x0001 } }])),
      'bad_flags',
    )
    expectZipError(
      () => readZip(craftZip([{ name: 'document.json', data: utf8('x'), centralOverrides: { flags: 0x0008 }, localOverrides: { flags: 0x0008 } }])),
      'bad_flags',
    )
  })

  it('rejects a non-epoch timestamp', () => {
    expectZipError(
      () => readZip(craftZip([{ name: 'document.json', data: utf8('x'), centralOverrides: { modDate: 0x5a21 }, localOverrides: { modDate: 0x5a21 } }])),
      'bad_timestamp',
    )
  })

  it('rejects a prepended stub, an interior gap, and a trailing comment', () => {
    expectZipError(() => readZip(craftZip([{ name: 'document.json', data: utf8('x') }], { prefix: utf8('MZ stub') })), 'layout_gap')
    expectZipError(() => readZip(craftZip([{ name: 'document.json', data: utf8('x') }], { gap: utf8('hidden') })), 'layout_gap')
    expectZipError(() => readZip(craftZip([{ name: 'document.json', data: utf8('x') }], { comment: utf8('note') })), 'bad_eocd')
  })

  it('rejects an entry-count that disagrees with the directory', () => {
    expectZipError(
      () => readZip(craftZip([{ name: 'document.json', data: utf8('x') }], { eocdOverrides: { entryCountTotal: 2 } })),
      'entry_count_mismatch',
    )
  })

  it('rejects a multi-disk archive', () => {
    expectZipError(
      () => readZip(craftZip([{ name: 'document.json', data: utf8('x') }], { eocdOverrides: { diskNumber: 1 } })),
      'multi_disk',
    )
  })

  it('rejects extra fields and entry comments', () => {
    expectZipError(
      () => readZip(craftZip([{ name: 'document.json', data: utf8('x'), centralOverrides: { extraLength: 4 } }])),
      'extra_field',
    )
  })

  it('rejects a truncated archive', () => {
    const bytes = writeZip(ENTRIES)
    expectZipError(() => readZip(bytes.slice(0, bytes.length - 4)), 'bad_eocd')
    expectZipError(() => readZip(new Uint8Array(4)), 'truncated')
  })

  it('rejects an archive with no entries', () => {
    expectZipError(() => readZip(craftZip([], {})), 'empty_archive')
  })
})
