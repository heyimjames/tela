import type { Layer, HorizontalAnchor, VerticalAnchor } from '@/types/design'
import { CONSTRAINTS_DEFAULT } from '@/types/design'

export interface Size {
  width: number
  height: number
}

/**
 * Reflow a frame's layers when its format changes (e.g. Instagram Story →
 * LinkedIn Feed). Pure: takes layers + old/new size, returns new layers.
 *
 * This is the *deterministic* reflow — predictable, instant, and it never
 * pushes content off-canvas. It's ideal for moderate format changes and for
 * honouring per-layer constraints a user has set. For drastic aspect changes
 * (portrait → wide banner) a proportional shrink is the safe result, but the
 * genuinely *nice* result comes from the AI "re-layout" pass, which composes
 * afresh. The two are complementary: constraints keep you safe, AI makes it good.
 */
export function reflowLayers(layers: Layer[], from: Size, to: Size): Layer[] {
  if (from.width === to.width && from.height === to.height) return layers
  const sx = to.width / from.width
  const sy = to.height / from.height
  const sMin = Math.min(sx, sy)

  return layers.map((l) => {
    // Background always fills the frame exactly.
    if (l.type === 'background') {
      return { ...l, x: 0, y: 0, width: to.width, height: to.height }
    }

    const c = l.constraints ?? CONSTRAINTS_DEFAULT

    // 1) Size. 'fixed' keeps the layer's pixel size (logos, CTAs); 'proportional'
    //    keeps aspect and fits; 'stretch' follows each axis independently.
    let w = l.width
    let h = l.height
    if (c.scale === 'proportional') {
      w = l.width * sMin
      h = l.height * sMin
    } else if (c.scale === 'stretch') {
      w = l.width * sx
      h = l.height * sy
    }

    // A stretch anchor overrides the box width/height to keep BOTH margins,
    // regardless of scale mode — that's what "pin both edges" means.
    if (c.horizontal === 'stretch') w = to.width - marginStart(l.x) - marginEnd(from.width, l.x, l.width)
    if (c.vertical === 'stretch') h = to.height - marginStart(l.y) - marginEnd(from.height, l.y, l.height)

    const x = placeAxis(c.horizontal, l.x, l.width, w, from.width, to.width)
    const y = placeAxis(c.vertical, l.y, l.height, h, from.height, to.height)

    const out = {
      ...l,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.max(1, Math.round(w)),
      height: Math.max(1, Math.round(h)),
    }

    // Scale text font size with the layer so type stays proportionate to its box
    // (unless the layer is pinned at a fixed size).
    if ('fontSize' in out && c.scale !== 'fixed') {
      ;(out as { fontSize: number }).fontSize = Math.max(1, Math.round((out as { fontSize: number }).fontSize * sMin))
    }

    return out as Layer
  })
}

const marginStart = (pos: number) => pos
const marginEnd = (frame: number, pos: number, size: number) => frame - (pos + size)

/**
 * Reposition one axis. `left`/`top` pin the start margin, `right`/`bottom` pin
 * the end margin, `center` preserves relative centre, `stretch` keeps the start
 * margin proportional (the box was already widened to keep both edges).
 */
function placeAxis(
  anchor: HorizontalAnchor | VerticalAnchor,
  oldPos: number,
  oldSize: number,
  newSize: number,
  oldFrame: number,
  newFrame: number,
): number {
  switch (anchor) {
    case 'left':
    case 'top':
      return oldPos
    case 'right':
    case 'bottom':
      return newFrame - marginEnd(oldFrame, oldPos, oldSize) - newSize
    case 'stretch':
      // Box already sized to keep both margins; pin the start margin as-is.
      return oldPos
    case 'center':
    default: {
      const relCentre = (oldPos + oldSize / 2) / oldFrame
      return relCentre * newFrame - newSize / 2
    }
  }
}
