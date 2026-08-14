/**
 * MIME determination by content, never by declaration.
 *
 * A `data:` URL's declared type, a file's extension, and a manifest's `mime` field
 * are all attacker-controlled. The only trustworthy signal is the bytes, so every
 * asset entering or leaving a bundle is sniffed and the declared type is checked
 * *against* the sniff rather than trusted in its place.
 */

import { SUPPORTED_ASSET_MIME, type SupportedAssetMime } from './schema'

const EXTENSION_BY_MIME: Record<SupportedAssetMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'font/woff2': 'woff2',
}

export function extensionForMime(mime: SupportedAssetMime): string {
  return EXTENSION_BY_MIME[mime]
}

export function isSupportedMime(value: string): value is SupportedAssetMime {
  return (SUPPORTED_ASSET_MIME as readonly string[]).includes(value)
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false
  }
  return true
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]
const WOFF2 = [0x77, 0x4f, 0x46, 0x32]

/**
 * SVG has no magic number, so it is recognised structurally and only after every
 * binary signature has been ruled out. The check is intentionally narrow: the text
 * must parse as UTF-8 and its first non-whitespace, non-comment, non-prolog token
 * must be an `<svg` element. Sanitization of that SVG's *contents* is a separate
 * concern owned by the renderer lane; this function only answers "what is it".
 */
/**
 * The end of a prefix that does not split a UTF-8 sequence.
 *
 * Cutting an arbitrary file at a fixed byte offset can land in the middle of a
 * multi-byte character, which a strict decoder rejects — that would make a perfectly
 * valid SVG (a Japanese `<title>`, an accented font name) unsupported and block the
 * save. Backing up to the last sequence boundary keeps the decode strict without
 * penalising the payload for where the window happened to fall.
 */
function utf8SafeEnd(bytes: Uint8Array, end: number): number {
  for (let i = end - 1; i >= end - 3 && i >= 0; i--) {
    const byte = bytes[i]
    if ((byte & 0xc0) === 0x80) continue // continuation byte; keep walking back
    if (byte < 0x80) return end // ASCII: the sequence before `end` is complete
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2
    return i + length <= end ? end : i
  }
  return end
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  if (bytes.length > 4 * 1024 * 1024) return false
  let text: string
  try {
    const end = Math.min(bytes.length, 4096)
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, utf8SafeEnd(bytes, end)))
  } catch {
    return false
  }
  // Strip a UTF-8 BOM if present (written as an escape so the source stays ASCII).
  let rest = text.replace(/^\uFEFF/, '').trimStart()
  // Skip any number of XML prologs, DOCTYPEs and comments before the root element.
  for (let guard = 0; guard < 16; guard++) {
    if (rest.startsWith('<?')) {
      const end = rest.indexOf('?>')
      if (end === -1) return false
      rest = rest.slice(end + 2).trimStart()
    } else if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->')
      if (end === -1) return false
      rest = rest.slice(end + 3).trimStart()
    } else if (rest.startsWith('<!')) {
      const end = rest.indexOf('>')
      if (end === -1) return false
      rest = rest.slice(end + 1).trimStart()
    } else {
      break
    }
  }
  return /^<svg[\s>]/i.test(rest)
}

/** The content type of these bytes, or `null` if it is not an accepted asset type. */
export function sniffMime(bytes: Uint8Array): SupportedAssetMime | null {
  if (startsWith(bytes, PNG)) return 'image/png'
  if (startsWith(bytes, JPEG)) return 'image/jpeg'
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return 'image/gif'
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp'
  if (startsWith(bytes, WOFF2)) return 'font/woff2'
  if (looksLikeSvg(bytes)) return 'image/svg+xml'
  return null
}
