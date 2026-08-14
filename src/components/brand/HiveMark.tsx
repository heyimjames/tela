/**
 * The HiveMind d20 mark.
 *
 * Inlined rather than loaded from an SVG in `public/` so it survives a non-root
 * Vite `base` (the Pages build serves from `/tela/`) without any URL rewriting,
 * and so it paints on the first frame with no network round-trip.
 *
 * Geometry and colours are the **bold** master from the supplied favicon pack
 * (`public/d20-flat-bold.svg`), not the flat one. The flat master facets the
 * body in hive-900/hive-700, which sat fine on the old light chrome but is
 * within a couple of points of `--ground` (#06191c) now that the app is dark:
 * the silhouette dissolves and only the cyan edging survives, which at the 18px
 * and 26px the lockup actually uses reads as a smudge. `index.html` already
 * ships this same variant as the dark-scheme favicon for exactly that reason —
 * this keeps the in-app mark and the tab icon telling the same story.
 *
 * Do not hand-tune the polygons — regenerate from the pack if the mark changes.
 */

/** Solid body — one silhouette polygon, a hair above the ground it sits on. */
const BODY = '451.7,143.0 256.0,30.0 60.3,143.0 60.3,369.0 256.0,482.0 451.7,369.0'
const BODY_FILL = '#0B333A'

/** Outer silhouette edges — heavier stroke than the interior facet edges. */
const OUTER_EDGES: Array<[number, number, number, number]> = [
  [451.7, 143.0, 256.0, 30.0],
  [256.0, 30.0, 60.3, 143.0],
  [60.3, 143.0, 60.3, 369.0],
  [60.3, 369.0, 256.0, 482.0],
  [256.0, 482.0, 451.7, 369.0],
  [451.7, 369.0, 451.7, 143.0],
]

const INNER_EDGES: Array<[number, number, number, number]> = [
  [367.6, 191.6, 144.4, 191.6],
  [144.4, 191.6, 256.0, 384.8],
  [256.0, 384.8, 367.6, 191.6],
  [367.6, 191.6, 451.7, 143.0],
  [144.4, 191.6, 60.3, 143.0],
  [256.0, 384.8, 256.0, 482.0],
]

const EDGE = '#46E5DA'

interface Props {
  /** Rendered size in px (the mark is square). */
  size?: number
  className?: string
}

export function HiveMark({ size = 28, className }: Props) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="HiveMind"
      data-no-outline
    >
      <polygon points={BODY} fill={BODY_FILL} />
      {OUTER_EDGES.map(([x1, y1, x2, y2], i) => (
        <line key={`o${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={EDGE} strokeWidth={30} strokeLinecap="round" />
      ))}
      {INNER_EDGES.map(([x1, y1, x2, y2], i) => (
        <line key={`i${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={EDGE} strokeWidth={26} strokeLinecap="round" />
      ))}
    </svg>
  )
}
