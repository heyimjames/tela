/**
 * Deterministic ZIP container: a STORE-only writer and a hardened, fail-closed reader.
 *
 * A general-purpose zip library is the wrong tool here for two reasons. First,
 * determinism: libraries write the current time, host-dependent external attributes,
 * extra fields, and data descriptors, all of which make the same document produce
 * different bytes on different machines. Second, safety: a `.tela` file is untrusted
 * input, and general readers are permissive by design — they follow paths, accept
 * duplicate entries, and happily inflate a 4 GB entry from 20 KB of DEFLATE.
 *
 * Every byte this writer emits is a constant or a function of the entry data. There
 * is no clock, no locale, no path separator, no host identity, and no `process`
 * anywhere in this file.
 */

// --- Fixed container constants ------------------------------------------------

/** 1980-01-01 00:00:00, the earliest representable DOS timestamp. */
const DOS_EPOCH_TIME = 0x0000
const DOS_EPOCH_DATE = 0x0021

/** UNIX host (3) so the 0644 mode in the external attributes is meaningful. */
const VERSION_MADE_BY = 0x0314
/** 2.0 — the minimum that covers STORE with no extensions. */
const VERSION_NEEDED = 0x0014
const METHOD_STORE = 0
/** `S_IFREG | 0644` in the high 16 bits, exactly as the format specifies. */
const EXTERNAL_ATTRS = ((0o100644 << 16) >>> 0) >>> 0

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const EOCD_SIZE = 22

// --- Limits (zip-bomb and resource exhaustion defence) ------------------------

export interface ZipLimits {
  /** Cap on the whole `.tela` file. */
  maxArchiveBytes: number
  /** Cap on any single entry's payload. */
  maxEntryBytes: number
  /** Cap on the sum of all entry payloads. */
  maxTotalEntryBytes: number
  /** Cap on the number of entries. */
  maxEntries: number
  /** Cap on an entry name's length in bytes. */
  maxNameBytes: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalEntryBytes: 256 * 1024 * 1024,
  maxEntries: 4096,
  maxNameBytes: 200,
}

export class ZipError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZipError'
    this.code = code
  }
}

export interface ZipEntry {
  name: string
  data: Uint8Array
}

// --- CRC-32 -------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// --- Entry-name policy --------------------------------------------------------

/**
 * Names are validated structurally, before anything is ever interpreted as a path.
 * The rule is an allow-list: ASCII, forward slashes only, no relative segments, no
 * roots, no trailing slash. Anything that could become a traversal, a UNC path, an
 * NTFS alternate data stream, or a Windows drive reference after some later
 * `path.join` is rejected here, in the one place every entry passes through.
 */
export function assertSafeEntryName(name: string, limits: ZipLimits): void {
  const bytes = new TextEncoder().encode(name)
  if (bytes.length === 0) throw new ZipError('empty_name', 'entry name is empty')
  if (bytes.length > limits.maxNameBytes) {
    throw new ZipError('name_too_long', `entry name exceeds ${limits.maxNameBytes} bytes`)
  }
  // Reject anything outside printable ASCII: no control bytes, no NUL truncation
  // tricks, no Unicode look-alikes or normalization ambiguity in the archive index.
  if (!/^[\x20-\x7e]+$/.test(name)) {
    throw new ZipError('non_ascii_name', `entry name has non-printable-ASCII bytes: ${JSON.stringify(name)}`)
  }
  if (name.includes('\\')) {
    throw new ZipError('backslash_name', `entry name contains a backslash: ${JSON.stringify(name)}`)
  }
  if (name.startsWith('/')) {
    throw new ZipError('absolute_name', `entry name is absolute: ${JSON.stringify(name)}`)
  }
  if (/^[A-Za-z]:/.test(name)) {
    throw new ZipError('drive_name', `entry name has a drive letter: ${JSON.stringify(name)}`)
  }
  if (name.endsWith('/')) {
    throw new ZipError('directory_entry', `directory entries are not allowed: ${JSON.stringify(name)}`)
  }
  if (name.includes(':')) {
    throw new ZipError('colon_name', `entry name contains a colon: ${JSON.stringify(name)}`)
  }
  for (const segment of name.split('/')) {
    if (segment === '') {
      throw new ZipError('empty_segment', `entry name has an empty path segment: ${JSON.stringify(name)}`)
    }
    if (segment === '.' || segment === '..') {
      throw new ZipError('traversal_name', `entry name has a relative segment: ${JSON.stringify(name)}`)
    }
  }
}

// --- Writer -------------------------------------------------------------------

/**
 * Write a deterministic STORE-mode archive. Entries are emitted in the order given;
 * the caller owns ordering policy because the bundle spec fixes it (manifest,
 * document, then assets ascending by hash) and this layer should not second-guess it.
 */
export function writeZip(entries: ZipEntry[], limits: ZipLimits = DEFAULT_ZIP_LIMITS): Uint8Array {
  if (entries.length === 0) throw new ZipError('empty_archive', 'refusing to write an empty archive')
  if (entries.length > limits.maxEntries) {
    throw new ZipError('too_many_entries', `archive would hold ${entries.length} entries (max ${limits.maxEntries})`)
  }

  const seen = new Set<string>()
  let totalPayload = 0
  for (const entry of entries) {
    assertSafeEntryName(entry.name, limits)
    // Case-folded uniqueness, not just exact uniqueness: two entries differing only
    // in case are indistinguishable once written to a case-insensitive filesystem,
    // which is a silent overwrite waiting to happen.
    const folded = entry.name.toLowerCase()
    if (seen.has(folded)) {
      throw new ZipError('duplicate_entry', `duplicate (case-insensitive) entry name: ${entry.name}`)
    }
    seen.add(folded)
    if (entry.data.length > limits.maxEntryBytes) {
      throw new ZipError('entry_too_large', `entry ${entry.name} exceeds ${limits.maxEntryBytes} bytes`)
    }
    totalPayload += entry.data.length
    if (totalPayload > limits.maxTotalEntryBytes) {
      throw new ZipError('archive_too_large', `entry payloads exceed ${limits.maxTotalEntryBytes} bytes`)
    }
  }

  const encoder = new TextEncoder()
  const prepared = entries.map((entry) => ({
    nameBytes: encoder.encode(entry.name),
    data: entry.data,
    crc: crc32(entry.data),
  }))

  const localSize = prepared.reduce((sum, e) => sum + LOCAL_HEADER_SIZE + e.nameBytes.length + e.data.length, 0)
  const centralSize = prepared.reduce((sum, e) => sum + CENTRAL_HEADER_SIZE + e.nameBytes.length, 0)
  const total = localSize + centralSize + EOCD_SIZE
  if (total > limits.maxArchiveBytes) {
    throw new ZipError('archive_too_large', `archive would be ${total} bytes (max ${limits.maxArchiveBytes})`)
  }

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let offset = 0
  const localOffsets: number[] = []

  for (const entry of prepared) {
    localOffsets.push(offset)
    view.setUint32(offset, SIG_LOCAL, true)
    view.setUint16(offset + 4, VERSION_NEEDED, true)
    view.setUint16(offset + 6, 0, true) // flags: no encryption, no data descriptor
    view.setUint16(offset + 8, METHOD_STORE, true)
    view.setUint16(offset + 10, DOS_EPOCH_TIME, true)
    view.setUint16(offset + 12, DOS_EPOCH_DATE, true)
    view.setUint32(offset + 14, entry.crc, true)
    view.setUint32(offset + 18, entry.data.length, true)
    view.setUint32(offset + 22, entry.data.length, true)
    view.setUint16(offset + 26, entry.nameBytes.length, true)
    view.setUint16(offset + 28, 0, true) // no extra field
    offset += LOCAL_HEADER_SIZE
    out.set(entry.nameBytes, offset)
    offset += entry.nameBytes.length
    out.set(entry.data, offset)
    offset += entry.data.length
  }

  const centralOffset = offset
  for (let i = 0; i < prepared.length; i++) {
    const entry = prepared[i]
    view.setUint32(offset, SIG_CENTRAL, true)
    view.setUint16(offset + 4, VERSION_MADE_BY, true)
    view.setUint16(offset + 6, VERSION_NEEDED, true)
    view.setUint16(offset + 8, 0, true)
    view.setUint16(offset + 10, METHOD_STORE, true)
    view.setUint16(offset + 12, DOS_EPOCH_TIME, true)
    view.setUint16(offset + 14, DOS_EPOCH_DATE, true)
    view.setUint32(offset + 16, entry.crc, true)
    view.setUint32(offset + 20, entry.data.length, true)
    view.setUint32(offset + 24, entry.data.length, true)
    view.setUint16(offset + 28, entry.nameBytes.length, true)
    view.setUint16(offset + 30, 0, true) // extra
    view.setUint16(offset + 32, 0, true) // comment
    view.setUint16(offset + 34, 0, true) // disk number
    view.setUint16(offset + 36, 0, true) // internal attrs
    view.setUint32(offset + 38, EXTERNAL_ATTRS, true)
    view.setUint32(offset + 42, localOffsets[i], true)
    offset += CENTRAL_HEADER_SIZE
    out.set(entry.nameBytes, offset)
    offset += entry.nameBytes.length
  }

  view.setUint32(offset, SIG_EOCD, true)
  view.setUint16(offset + 4, 0, true) // this disk
  view.setUint16(offset + 6, 0, true) // disk with central directory
  view.setUint16(offset + 8, prepared.length, true)
  view.setUint16(offset + 10, prepared.length, true)
  view.setUint32(offset + 12, centralSize, true)
  view.setUint32(offset + 16, centralOffset, true)
  view.setUint16(offset + 20, 0, true) // no archive comment

  return out
}

// --- Reader -------------------------------------------------------------------

/** File-type bits of a UNIX mode, masked out of the external attributes. */
const S_IFMT = 0o170000
const S_IFREG = 0o100000

/**
 * Parse an archive under the same rules the writer obeys. Anything the writer
 * would never emit is treated as hostile rather than tolerated, so a bundle that
 * round-trips through a third-party zip tool will be rejected — which is the
 * intent: only bundles this project produced are accepted as masters.
 */
export function readZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  if (bytes.length > limits.maxArchiveBytes) {
    throw new ZipError('archive_too_large', `archive is ${bytes.length} bytes (max ${limits.maxArchiveBytes})`)
  }
  if (bytes.length < EOCD_SIZE) throw new ZipError('truncated', 'archive is shorter than an end-of-central-directory record')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // The EOCD must be the very last record: we do not scan backwards for a
  // signature. Scanning is how readers get tricked into honouring a second,
  // attacker-chosen central directory while another tool reads the first one.
  const eocdOffset = bytes.length - EOCD_SIZE
  if (view.getUint32(eocdOffset, true) !== SIG_EOCD) {
    throw new ZipError('bad_eocd', 'end-of-central-directory record is missing, or an archive comment is present')
  }
  if (view.getUint16(eocdOffset + 4, true) !== 0 || view.getUint16(eocdOffset + 6, true) !== 0) {
    throw new ZipError('multi_disk', 'multi-disk archives are not supported')
  }
  if (view.getUint16(eocdOffset + 20, true) !== 0) {
    throw new ZipError('archive_comment', 'archive comments are not allowed')
  }

  const entryCount = view.getUint16(eocdOffset + 8, true)
  if (view.getUint16(eocdOffset + 10, true) !== entryCount) {
    throw new ZipError('entry_count_mismatch', 'central directory entry counts disagree')
  }
  if (entryCount === 0) throw new ZipError('empty_archive', 'archive holds no entries')
  if (entryCount > limits.maxEntries) {
    throw new ZipError('too_many_entries', `archive holds ${entryCount} entries (max ${limits.maxEntries})`)
  }

  const centralSize = view.getUint32(eocdOffset + 12, true)
  const centralOffset = view.getUint32(eocdOffset + 16, true)
  if (centralOffset + centralSize !== eocdOffset) {
    throw new ZipError('central_directory_mismatch', 'central directory does not end where the EOCD begins')
  }

  const decoder = new TextDecoder('utf-8', { fatal: true })
  const entries: ZipEntry[] = []
  const seen = new Set<string>()
  let totalPayload = 0
  let cursor = centralOffset
  // Payload regions must tile the archive from byte 0 with no gaps, which forbids
  // hidden data between entries and any prepended self-extracting stub.
  let expectedLocalOffset = 0

  for (let i = 0; i < entryCount; i++) {
    if (cursor + CENTRAL_HEADER_SIZE > eocdOffset) throw new ZipError('truncated', 'central directory is truncated')
    if (view.getUint32(cursor, true) !== SIG_CENTRAL) throw new ZipError('bad_central_header', `entry ${i} has a bad central header signature`)

    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const modTime = view.getUint16(cursor + 12, true)
    const modDate = view.getUint16(cursor + 14, true)
    const crc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const diskStart = view.getUint16(cursor + 34, true)
    const externalAttrs = view.getUint32(cursor + 38, true)
    const localOffset = view.getUint32(cursor + 42, true)

    if (flags !== 0) throw new ZipError('bad_flags', `entry ${i} sets general-purpose flags (0x${flags.toString(16)}); encryption and data descriptors are rejected`)
    if (method !== METHOD_STORE) throw new ZipError('bad_method', `entry ${i} uses compression method ${method}; only STORE is accepted`)
    if (modTime !== DOS_EPOCH_TIME || modDate !== DOS_EPOCH_DATE) {
      throw new ZipError('bad_timestamp', `entry ${i} does not carry the fixed DOS-epoch timestamp`)
    }
    if (extraLength !== 0) throw new ZipError('extra_field', `entry ${i} carries an extra field`)
    if (commentLength !== 0) throw new ZipError('entry_comment', `entry ${i} carries a comment`)
    if (diskStart !== 0) throw new ZipError('multi_disk', `entry ${i} lives on another disk`)
    if (compressedSize !== uncompressedSize) {
      throw new ZipError('size_mismatch', `entry ${i} declares different compressed and uncompressed sizes under STORE`)
    }
    if (externalAttrs !== EXTERNAL_ATTRS) {
      // Catches symlinks, directories, devices, and setuid bits in one comparison:
      // anything other than a regular 0644 file is refused outright.
      const mode = (externalAttrs >>> 16) & 0xffff
      const kind = (mode & S_IFMT) === S_IFREG ? `mode 0${(mode & 0o7777).toString(8)}` : `file type 0${(mode & S_IFMT).toString(8)}`
      throw new ZipError('bad_mode', `entry ${i} has non-canonical external attributes (${kind}); only regular 0644 files are accepted`)
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new ZipError('entry_too_large', `entry ${i} declares ${uncompressedSize} bytes (max ${limits.maxEntryBytes})`)
    }
    totalPayload += uncompressedSize
    if (totalPayload > limits.maxTotalEntryBytes) {
      throw new ZipError('archive_too_large', `entry payloads exceed ${limits.maxTotalEntryBytes} bytes`)
    }

    if (nameLength === 0 || nameLength > limits.maxNameBytes) {
      throw new ZipError('bad_name_length', `entry ${i} has a name of ${nameLength} bytes`)
    }
    const nameStart = cursor + CENTRAL_HEADER_SIZE
    if (nameStart + nameLength > eocdOffset) throw new ZipError('truncated', 'central directory is truncated')
    let name: string
    try {
      name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength))
    } catch {
      throw new ZipError('bad_name_encoding', `entry ${i} has a name that is not valid UTF-8`)
    }
    assertSafeEntryName(name, limits)

    const folded = name.toLowerCase()
    if (seen.has(folded)) throw new ZipError('duplicate_entry', `duplicate (case-insensitive) entry name: ${name}`)
    seen.add(folded)

    // --- local header ---
    if (localOffset !== expectedLocalOffset) {
      throw new ZipError('layout_gap', `entry ${i} is not contiguous with the previous entry; hidden or overlapping data`)
    }
    if (localOffset + LOCAL_HEADER_SIZE > centralOffset) throw new ZipError('truncated', `entry ${i} local header runs past the central directory`)
    if (view.getUint32(localOffset, true) !== SIG_LOCAL) throw new ZipError('bad_local_header', `entry ${i} has a bad local header signature`)
    if (view.getUint16(localOffset + 6, true) !== flags) throw new ZipError('header_mismatch', `entry ${i} local and central flags disagree`)
    if (view.getUint16(localOffset + 8, true) !== method) throw new ZipError('header_mismatch', `entry ${i} local and central methods disagree`)
    if (view.getUint16(localOffset + 10, true) !== modTime || view.getUint16(localOffset + 12, true) !== modDate) {
      throw new ZipError('header_mismatch', `entry ${i} local and central timestamps disagree`)
    }
    if (view.getUint32(localOffset + 14, true) !== crc) throw new ZipError('header_mismatch', `entry ${i} local and central CRCs disagree`)
    if (view.getUint32(localOffset + 18, true) !== compressedSize || view.getUint32(localOffset + 22, true) !== uncompressedSize) {
      throw new ZipError('header_mismatch', `entry ${i} local and central sizes disagree`)
    }
    if (view.getUint16(localOffset + 26, true) !== nameLength) throw new ZipError('header_mismatch', `entry ${i} local and central name lengths disagree`)
    if (view.getUint16(localOffset + 28, true) !== 0) throw new ZipError('extra_field', `entry ${i} local header carries an extra field`)

    const localNameStart = localOffset + LOCAL_HEADER_SIZE
    const localName = bytes.subarray(localNameStart, localNameStart + nameLength)
    const centralName = bytes.subarray(nameStart, nameStart + nameLength)
    for (let b = 0; b < nameLength; b++) {
      if (localName[b] !== centralName[b]) throw new ZipError('header_mismatch', `entry ${i} local and central names disagree`)
    }

    const dataStart = localNameStart + nameLength
    if (dataStart + uncompressedSize > centralOffset) throw new ZipError('truncated', `entry ${i} payload runs past the central directory`)
    const data = bytes.slice(dataStart, dataStart + uncompressedSize)
    if (crc32(data) !== crc) throw new ZipError('crc_mismatch', `entry ${i} (${name}) fails its CRC check`)

    entries.push({ name, data })
    expectedLocalOffset = dataStart + uncompressedSize
    cursor = nameStart + nameLength
  }

  if (cursor !== eocdOffset) throw new ZipError('central_directory_mismatch', 'trailing bytes after the central directory')
  if (expectedLocalOffset !== centralOffset) throw new ZipError('layout_gap', 'unreferenced bytes between the last entry and the central directory')

  return entries
}
