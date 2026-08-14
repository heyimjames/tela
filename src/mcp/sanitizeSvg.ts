/**
 * SVG sanitization.
 *
 * An SVG is a document that can execute script, fetch remote resources, and
 * embed arbitrary HTML. Every one of those is a way for imported artwork to
 * reach outside the approved root and outside the "no external network"
 * guarantee, so imported SVG is refused rather than rewritten.
 *
 * **Refuse, do not strip.** A sanitizer that edits its input has to be right
 * about every construct it did not think of; a sanitizer that rejects only has
 * to recognize danger. A refused import tells the caller exactly what to fix. A
 * silently rewritten one leaves them with artwork that does not match the file
 * they handed over.
 *
 * This runs on a plain string with no DOM, because it runs in the MCP process
 * before any browser exists.
 */

import { toolError } from './errors'

export interface SvgLimits {
  maxBytes: number
  maxElements: number
}

export const DEFAULT_SVG_LIMITS: SvgLimits = {
  maxBytes: 2 * 1024 * 1024,
  maxElements: 20_000,
}

const FORBIDDEN_ELEMENTS = ['script', 'foreignobject', 'iframe', 'embed', 'object', 'audio', 'video', 'animate', 'set', 'handler']

/** `xlink:href` is the legacy spelling and is just as capable of loading a remote document. */
const HREF_ATTRIBUTES = /(?:\bhref|\bxlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi

const EVENT_HANDLER = /\son[a-z]+\s*=/i

/** Only these URL schemes may appear in a reference. Everything else — http, file, blob — is refused. */
function isAllowedReference(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return true
  if (trimmed.startsWith('#')) return true
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(trimmed)) return true
  return false
}

export function sanitizeSvg(source: string, limits: SvgLimits = DEFAULT_SVG_LIMITS): string {
  const bytes = Buffer.byteLength(source, 'utf8')
  if (bytes > limits.maxBytes) {
    throw toolError(
      'policy_refused',
      `the SVG is ${bytes} bytes, over the ${limits.maxBytes}-byte limit`,
      'simplify or rasterize the artwork before importing it',
    )
  }

  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '')

  if (!/<svg[\s>]/i.test(withoutComments)) {
    throw toolError('invalid_input', 'the content does not contain an <svg> element', 'pass the SVG markup itself, not a path or a wrapper document')
  }

  if (/<!DOCTYPE/i.test(withoutComments) || /<!ENTITY/i.test(withoutComments)) {
    throw toolError(
      'policy_refused',
      'the SVG declares a DOCTYPE or entity',
      'remove the DOCTYPE and any ENTITY declarations; they are refused because entity expansion can read local files and amplify size',
    )
  }

  const tags = withoutComments.match(/<[a-zA-Z][^\s/>]*/g) ?? []
  if (tags.length > limits.maxElements) {
    throw toolError(
      'policy_refused',
      `the SVG has ${tags.length} elements, over the ${limits.maxElements}-element limit`,
      'simplify the artwork or import it as a raster image instead',
    )
  }
  for (const tag of tags) {
    const name = tag.slice(1).toLowerCase().replace(/^.*:/, '')
    if (FORBIDDEN_ELEMENTS.includes(name)) {
      throw toolError(
        'policy_refused',
        `the SVG contains a <${name}> element`,
        `remove every <${name}> element; scripting, embedded documents, and foreignObject are refused in imported artwork`,
      )
    }
  }

  if (EVENT_HANDLER.test(withoutComments)) {
    throw toolError('policy_refused', 'the SVG has an inline event handler attribute', 'remove every on* attribute (onload, onclick, …) before importing')
  }

  if (/javascript\s*:/i.test(withoutComments)) {
    throw toolError('policy_refused', 'the SVG contains a javascript: URL', 'remove the javascript: reference before importing')
  }

  for (const match of withoutComments.matchAll(HREF_ATTRIBUTES)) {
    const value = match[1] ?? match[2] ?? match[3] ?? ''
    if (!isAllowedReference(value)) {
      throw toolError(
        'policy_refused',
        'the SVG references an external resource',
        'inline the referenced asset as a data: URL, or use an internal #fragment reference; remote references are refused because this runtime makes no outbound requests',
      )
    }
  }

  // `<style>` can carry `@import` and `url()`, which are references by another
  // name and would slip past the attribute scan above.
  for (const style of withoutComments.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const body = style[1] ?? ''
    if (/@import/i.test(body)) {
      throw toolError('policy_refused', 'the SVG has a CSS @import', 'inline the imported styles into the SVG before importing it')
    }
    for (const url of body.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
      if (!isAllowedReference(url[2] ?? '')) {
        throw toolError('policy_refused', 'the SVG has a CSS url() pointing outside the document', 'inline the referenced asset as a data: URL before importing')
      }
    }
  }

  return withoutComments
}
