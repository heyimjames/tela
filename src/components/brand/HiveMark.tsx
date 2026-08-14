/**
 * The HiveMind d20 mark.
 *
 * Inlined rather than loaded from `/d20-flat.svg` so it survives a non-root
 * Vite `base` (the Pages build serves from `/tela/`) without any URL rewriting,
 * and so it paints on the first frame with no network round-trip.
 *
 * Geometry and colours are the flat master from the supplied favicon pack
 * (`d20-flat.svg`): faces on hive-900/hive-700 with a mid tone, edges in the
 * pack's edge cyan `#46E5DA`. Do not hand-tune the polygons — regenerate from
 * the pack if the mark changes.
 */
const FACES: Array<{ points: string; fill: string }> = [
  { points: '371.5,189.3 140.5,189.3 256.0,389.4', fill: '#0B333A' },
  { points: '371.5,189.3 140.5,189.3 256.0,22.0', fill: '#0F4A52' },
  { points: '140.5,189.3 256.0,389.4 53.4,373.0', fill: '#07262B' },
  { points: '256.0,389.4 371.5,189.3 458.6,373.0', fill: '#07262B' },
  { points: '458.6,139.0 256.0,22.0 371.5,189.3', fill: '#07262B' },
  { points: '256.0,22.0 53.4,139.0 140.5,189.3', fill: '#07262B' },
  { points: '53.4,139.0 53.4,373.0 140.5,189.3', fill: '#0F4A52' },
  { points: '53.4,373.0 256.0,490.0 256.0,389.4', fill: '#0B333A' },
  { points: '256.0,490.0 458.6,373.0 256.0,389.4', fill: '#0F4A52' },
  { points: '458.6,373.0 458.6,139.0 371.5,189.3', fill: '#0B333A' },
]

/** Outer silhouette edges — heavier stroke than the interior facet edges. */
const OUTER_EDGES: Array<[number, number, number, number]> = [
  [458.6, 139.0, 256.0, 22.0],
  [256.0, 22.0, 53.4, 139.0],
  [53.4, 139.0, 53.4, 373.0],
  [53.4, 373.0, 256.0, 490.0],
  [256.0, 490.0, 458.6, 373.0],
  [458.6, 373.0, 458.6, 139.0],
]

const INNER_EDGES: Array<[number, number, number, number]> = [
  [371.5, 189.3, 140.5, 189.3],
  [140.5, 189.3, 256.0, 389.4],
  [256.0, 389.4, 371.5, 189.3],
  [371.5, 189.3, 458.6, 139.0],
  [371.5, 189.3, 458.6, 373.0],
  [371.5, 189.3, 256.0, 22.0],
  [140.5, 189.3, 53.4, 139.0],
  [140.5, 189.3, 256.0, 22.0],
  [140.5, 189.3, 53.4, 373.0],
  [256.0, 389.4, 256.0, 490.0],
  [256.0, 389.4, 53.4, 373.0],
  [256.0, 389.4, 458.6, 373.0],
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
      {FACES.map((f, i) => (
        <polygon key={`f${i}`} points={f.points} fill={f.fill} />
      ))}
      {OUTER_EDGES.map(([x1, y1, x2, y2], i) => (
        <line key={`o${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={EDGE} strokeWidth={10} strokeLinecap="round" />
      ))}
      {INNER_EDGES.map(([x1, y1, x2, y2], i) => (
        <line key={`i${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={EDGE} strokeWidth={8} strokeLinecap="round" />
      ))}
    </svg>
  )
}
