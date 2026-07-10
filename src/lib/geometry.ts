/** Shortest distance from a point to a polyline (min over each segment). Used to
 *  hit-test and erase freehand strokes against the actual ink, not their bbox. */
export function distToPolyline(px: number, py: number, pts: readonly (readonly [number, number])[]): number {
  if (pts.length === 0) return Infinity
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1])
  let min = Infinity
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1]
    const [x2, y2] = pts[i]
    const dx = x2 - x1
    const dy = y2 - y1
    const l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0
    const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
    if (d < min) min = d
  }
  return min
}
