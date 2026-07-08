// Sizing for imported SVG files. A raw <svg> file has no relationship to our
// canvas units, and its viewBox often has whitespace padding around the artwork
// (or a non-square aspect ratio). Dropping it into a fixed 200×200 box leaves
// the selection box far larger than the visible art. This measures the *tight*
// content bounding box, rewrites the viewBox to it (so the art fills the layer),
// and returns a layer size that matches the art's real aspect ratio.

const MAX_SIDE = 200

export interface SvgIntrinsic {
  svgContent: string
  width: number
  height: number
}

const round = (n: number): number => Math.round(n * 100) / 100

/** Fit an intrinsic w×h into MAX_SIDE on its longest side, preserving aspect. */
function fitToBox(w: number, h: number): { width: number; height: number } {
  const scale = MAX_SIDE / Math.max(w, h)
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/** Aspect from an explicit viewBox, else width/height attributes. */
function declaredSize(svg: SVGSVGElement): [number, number] | null {
  const vb = svg.getAttribute('viewBox')
  if (vb) {
    const p = vb.split(/[\s,]+/).map(Number)
    if (p.length === 4 && p[2] > 0 && p[3] > 0) return [p[2], p[3]]
  }
  const w = parseFloat(svg.getAttribute('width') ?? '')
  const h = parseFloat(svg.getAttribute('height') ?? '')
  if (w > 0 && h > 0) return [w, h]
  return null
}

/**
 * Size an imported SVG to its artwork rather than a fixed square. Measures the
 * tight content bbox in a hidden container and rewrites the viewBox to it, so
 * the art fills the layer with no phantom padding. Falls back to the declared
 * viewBox/size, then to a square, if live measurement isn't available.
 */
export function measureImportedSvg(svgContent: string): SvgIntrinsic {
  const fallback = (): SvgIntrinsic => ({ svgContent, width: MAX_SIDE, height: MAX_SIDE })
  if (typeof document === 'undefined') return fallback()

  let svgEl: SVGSVGElement
  try {
    const doc = new DOMParser().parseFromString(svgContent, 'image/svg+xml')
    if (doc.querySelector('parsererror')) return fallback()
    const root = doc.documentElement
    if (root.tagName.toLowerCase() !== 'svg') return fallback()
    svgEl = document.importNode(root, true) as unknown as SVGSVGElement
  } catch {
    return fallback()
  }

  const declared = declaredSize(svgEl)

  // Measure tight content bounds: the element must be laid out, so mount it
  // off-screen (display:none yields an empty bbox in some engines).
  const holder = document.createElement('div')
  holder.setAttribute('style', 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;')
  svgEl.removeAttribute('width')
  svgEl.removeAttribute('height')
  holder.appendChild(svgEl)
  document.body.appendChild(holder)

  let box: { x: number; y: number; width: number; height: number } | null = null
  try {
    const b = svgEl.getBBox()
    if (b.width > 0.01 && b.height > 0.01) box = { x: b.x, y: b.y, width: b.width, height: b.height }
  } catch {
    /* getBBox can throw before layout — fall through to declared size */
  }
  document.body.removeChild(holder)

  if (box) {
    // Reframe the viewBox to the tight content box so the art fills the layer.
    svgEl.setAttribute('viewBox', `${round(box.x)} ${round(box.y)} ${round(box.width)} ${round(box.height)}`)
    const out = new XMLSerializer().serializeToString(svgEl)
    return { svgContent: out, ...fitToBox(box.width, box.height) }
  }

  if (declared) {
    // Keep markup as-is (its viewBox already frames the art); just match aspect.
    return { svgContent, ...fitToBox(declared[0], declared[1]) }
  }

  return fallback()
}
