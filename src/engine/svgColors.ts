/**
 * SVG colour extraction + remapping.
 *
 * Imported SVGs can carry colour in several places — presentation attributes
 * (`fill`, `stroke`, `stop-color`…), inline `style="fill:…"`, and `<style>`
 * blocks — and in several notations (#rgb, #rrggbb, rgb(), named). To recolour
 * faithfully we parse the document, normalise each colour to a canonical key,
 * collect the distinct set, and remap each one independently. This preserves
 * multi-colour artwork instead of flattening it to a single tint.
 */

// Attributes (and matching CSS properties) that carry a paint colour.
const COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'] as const

// Minimal CSS named-colour map for the few that show up in real-world SVGs.
// Anything not here still works as a raw key — it just won't merge with its hex.
const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
}

/**
 * Canonicalise a colour string so equal colours written differently collapse to
 * one key. Returns null for non-colours we shouldn't expose (none, transparent,
 * currentColor, url(#…) paint-server references).
 */
export function normalizeColor(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  if (!v || v === 'none' || v === 'transparent' || v === 'currentcolor' || v.startsWith('url(')) {
    return null
  }
  if (NAMED_COLORS[v]) return NAMED_COLORS[v]

  // #rgb / #rgba → #rrggbb (drop alpha nibble; canvas tint is opaque anyway)
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(v)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`

  // #rrggbb / #rrggbbaa → #rrggbb
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v)
  if (long) return `#${long[1]}`

  // rgb()/rgba() → #rrggbb
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(v)
  if (rgb) {
    const toHex = (n: string) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0')
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`
  }

  // Unknown but plausibly a named colour — keep as-is so it's still editable.
  return v
}

function parseSvg(svg: string): Document {
  return new DOMParser().parseFromString(svg, 'image/svg+xml')
}

function readStyleColor(style: string, prop: string): string | null {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style)
  return m ? normalizeColor(m[1]) : null
}

/**
 * Distinct, normalised colours used anywhere in the SVG, in document order of
 * first appearance.
 */
export function extractSvgColors(svg: string): string[] {
  const doc = parseSvg(svg)
  if (doc.querySelector('parsererror')) return []

  const seen = new Set<string>()
  const ordered: string[] = []
  const add = (c: string | null) => {
    if (c && !seen.has(c)) { seen.add(c); ordered.push(c) }
  }

  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of COLOR_ATTRS) add(normalizeColor(el.getAttribute(attr) ?? ''))
    const style = el.getAttribute('style')
    if (style) for (const attr of COLOR_ATTRS) add(readStyleColor(style, attr))
  })

  doc.querySelectorAll('style').forEach((s) => {
    const css = s.textContent ?? ''
    const re = /(?:fill|stroke|stop-color|flood-color|lighting-color)\s*:\s*([^;}\s]+)/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(css))) add(normalizeColor(m[1]))
  })

  return ordered
}

/**
 * Return a new SVG string with each original colour replaced by its override
 * (a `normalizedOriginal -> newHex` map). Colours without an override are left
 * untouched, so multi-colour artwork keeps the colours the user didn't change.
 */
export function applySvgColorOverrides(svg: string, overrides: Record<string, string>): string {
  const entries = Object.entries(overrides).filter(([, v]) => !!v)
  if (entries.length === 0) return svg

  const map = new Map(entries.map(([k, v]) => [normalizeColor(k) ?? k.toLowerCase(), v]))
  const doc = parseSvg(svg)
  if (doc.querySelector('parsererror')) return svg

  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of COLOR_ATTRS) {
      const norm = normalizeColor(el.getAttribute(attr) ?? '')
      if (norm && map.has(norm)) el.setAttribute(attr, map.get(norm)!)
    }
    const style = el.getAttribute('style')
    if (style) {
      const next = rewriteStyleColors(style, map)
      if (next !== style) el.setAttribute('style', next)
    }
  })

  doc.querySelectorAll('style').forEach((s) => {
    s.textContent = rewriteStyleColors(s.textContent ?? '', map)
  })

  return new XMLSerializer().serializeToString(doc.documentElement)
}

function rewriteStyleColors(css: string, map: Map<string, string>): string {
  return css.replace(
    /((?:fill|stroke|stop-color|flood-color|lighting-color)\s*:\s*)([^;}\s]+)/gi,
    (full, prop: string, value: string) => {
      const norm = normalizeColor(value)
      return norm && map.has(norm) ? `${prop}${map.get(norm)}` : full
    },
  )
}

export interface SvgColorRole {
  color: string
  roles: ('fill' | 'stroke')[]
}

/**
 * Distinct colours with the paint role(s) they appear in — so the UI can group
 * "fill" colours separately from "stroke" colours. A colour used for both is
 * tagged with both roles (recolouring still remaps it everywhere).
 */
export function extractSvgColorRoles(svg: string): SvgColorRole[] {
  const doc = parseSvg(svg)
  if (doc.querySelector('parsererror')) return []
  const roleMap = new Map<string, Set<'fill' | 'stroke'>>()
  const add = (c: string | null, role: 'fill' | 'stroke') => {
    if (!c) return
    if (!roleMap.has(c)) roleMap.set(c, new Set())
    roleMap.get(c)!.add(role)
  }
  doc.querySelectorAll('*').forEach((el) => {
    add(normalizeColor(el.getAttribute('fill') ?? ''), 'fill')
    add(normalizeColor(el.getAttribute('stroke') ?? ''), 'stroke')
    const style = el.getAttribute('style')
    if (style) {
      add(readStyleColor(style, 'fill'), 'fill')
      add(readStyleColor(style, 'stroke'), 'stroke')
    }
  })
  // Preserve first-appearance order (extractSvgColors) and attach roles.
  return extractSvgColors(svg).map((color) => ({
    color,
    roles: [...(roleMap.get(color) ?? [])],
  }))
}

/** True when the artwork paints any stroke, so a stroke-width control applies. */
export function svgHasStroke(svg: string): boolean {
  const doc = parseSvg(svg)
  if (doc.querySelector('parsererror')) return false
  return [...doc.querySelectorAll('*')].some((el) => {
    const s = el.getAttribute('stroke')
    if (s && s !== 'none') return true
    const style = el.getAttribute('style') ?? ''
    return /(?:^|;)\s*stroke\s*:\s*(?!none)[^;]/i.test(style)
  })
}

/**
 * Scale every stroke width in the artwork by `factor` (1 = unchanged). Stroked
 * elements with no explicit width inherit the SVG default of 1. Scaling (rather
 * than setting one absolute width) preserves relative thick/thin strokes.
 */
export function applySvgStrokeWidth(svg: string, factor: number): string {
  if (!factor || factor === 1) return svg
  const doc = parseSvg(svg)
  if (doc.querySelector('parsererror')) return svg
  doc.querySelectorAll('*').forEach((el) => {
    const stroke = el.getAttribute('stroke')
    const style = el.getAttribute('style') ?? ''
    const paintsStroke =
      (!!stroke && stroke !== 'none') ||
      /(?:^|;)\s*stroke\s*:\s*(?!none)[^;]/i.test(style)
    if (!paintsStroke) return
    const cur = parseFloat(el.getAttribute('stroke-width') ?? '') || 1
    el.setAttribute('stroke-width', String(+(cur * factor).toFixed(3)))
  })
  return new XMLSerializer().serializeToString(doc.documentElement)
}
