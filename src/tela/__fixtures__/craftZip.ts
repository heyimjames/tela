/**
 * A deliberately *malleable* ZIP writer, for tests only.
 *
 * The production writer in `zip.ts` cannot express a hostile archive — that is the
 * point of it. To prove the reader rejects hostile archives we need a writer that
 * can produce them: wrong methods, symlink modes, duplicate names, gaps between
 * entries, prepended stubs, trailing comments, lying sizes. Every knob here
 * corresponds to a rejection the reader is expected to make.
 */

import { crc32 } from '../zip'

export interface CraftedEntry {
  name: string
  data: Uint8Array
  /** Overrides the central-directory record only, leaving the local header honest. */
  centralOverrides?: Partial<{
    flags: number
    method: number
    modTime: number
    modDate: number
    crc: number
    compressedSize: number
    uncompressedSize: number
    externalAttrs: number
    localOffset: number
    extraLength: number
    commentLength: number
    diskStart: number
  }>
  localOverrides?: Partial<{
    flags: number
    method: number
    modTime: number
    modDate: number
    crc: number
    compressedSize: number
    uncompressedSize: number
  }>
  /** Name written into the local header, when it should differ from the central one. */
  localName?: string
}

export interface CraftOptions {
  /** Bytes inserted before the first local header (self-extracting stub). */
  prefix?: Uint8Array
  /** Bytes inserted between the last entry and the central directory. */
  gap?: Uint8Array
  /** Archive comment appended after the EOCD. */
  comment?: Uint8Array
  /** Overrides the EOCD record. */
  eocdOverrides?: Partial<{
    entryCount: number
    entryCountTotal: number
    centralSize: number
    centralOffset: number
    diskNumber: number
    centralDiskNumber: number
  }>
}

const DOS_TIME = 0x0000
const DOS_DATE = 0x0021
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0

export function craftZip(entries: CraftedEntry[], options: CraftOptions = {}): Uint8Array {
  const encoder = new TextEncoder()
  const prefix = options.prefix ?? new Uint8Array(0)
  const gap = options.gap ?? new Uint8Array(0)
  const comment = options.comment ?? new Uint8Array(0)

  const prepared = entries.map((entry) => {
    const centralName = encoder.encode(entry.name)
    const localName = encoder.encode(entry.localName ?? entry.name)
    return { entry, centralName, localName, crc: crc32(entry.data) }
  })

  const localSize = prepared.reduce((sum, p) => sum + 30 + p.localName.length + p.entry.data.length, 0)
  const centralSize = prepared.reduce((sum, p) => sum + 46 + p.centralName.length, 0)
  const total = prefix.length + localSize + gap.length + centralSize + 22 + comment.length

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let offset = 0
  out.set(prefix, offset)
  offset += prefix.length

  const localOffsets: number[] = []
  for (const p of prepared) {
    const o = p.entry.localOverrides ?? {}
    localOffsets.push(offset)
    view.setUint32(offset, 0x04034b50, true)
    view.setUint16(offset + 4, 0x0014, true)
    view.setUint16(offset + 6, o.flags ?? 0, true)
    view.setUint16(offset + 8, o.method ?? 0, true)
    view.setUint16(offset + 10, o.modTime ?? DOS_TIME, true)
    view.setUint16(offset + 12, o.modDate ?? DOS_DATE, true)
    view.setUint32(offset + 14, o.crc ?? p.crc, true)
    view.setUint32(offset + 18, o.compressedSize ?? p.entry.data.length, true)
    view.setUint32(offset + 22, o.uncompressedSize ?? p.entry.data.length, true)
    view.setUint16(offset + 26, p.localName.length, true)
    view.setUint16(offset + 28, 0, true)
    offset += 30
    out.set(p.localName, offset)
    offset += p.localName.length
    out.set(p.entry.data, offset)
    offset += p.entry.data.length
  }

  out.set(gap, offset)
  offset += gap.length

  const centralOffset = offset
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i]
    const c = p.entry.centralOverrides ?? {}
    view.setUint32(offset, 0x02014b50, true)
    view.setUint16(offset + 4, 0x0314, true)
    view.setUint16(offset + 6, 0x0014, true)
    view.setUint16(offset + 8, c.flags ?? 0, true)
    view.setUint16(offset + 10, c.method ?? 0, true)
    view.setUint16(offset + 12, c.modTime ?? DOS_TIME, true)
    view.setUint16(offset + 14, c.modDate ?? DOS_DATE, true)
    view.setUint32(offset + 16, c.crc ?? p.crc, true)
    view.setUint32(offset + 20, c.compressedSize ?? p.entry.data.length, true)
    view.setUint32(offset + 24, c.uncompressedSize ?? p.entry.data.length, true)
    view.setUint16(offset + 28, p.centralName.length, true)
    view.setUint16(offset + 30, c.extraLength ?? 0, true)
    view.setUint16(offset + 32, c.commentLength ?? 0, true)
    view.setUint16(offset + 34, c.diskStart ?? 0, true)
    view.setUint16(offset + 36, 0, true)
    view.setUint32(offset + 38, c.externalAttrs ?? EXTERNAL_ATTRS, true)
    view.setUint32(offset + 42, c.localOffset ?? localOffsets[i], true)
    offset += 46
    out.set(p.centralName, offset)
    offset += p.centralName.length
  }

  const e = options.eocdOverrides ?? {}
  view.setUint32(offset, 0x06054b50, true)
  view.setUint16(offset + 4, e.diskNumber ?? 0, true)
  view.setUint16(offset + 6, e.centralDiskNumber ?? 0, true)
  view.setUint16(offset + 8, e.entryCount ?? prepared.length, true)
  view.setUint16(offset + 10, e.entryCountTotal ?? prepared.length, true)
  view.setUint32(offset + 12, e.centralSize ?? centralSize, true)
  view.setUint32(offset + 16, e.centralOffset ?? centralOffset, true)
  view.setUint16(offset + 20, comment.length, true)
  offset += 22
  out.set(comment, offset)

  return out
}
