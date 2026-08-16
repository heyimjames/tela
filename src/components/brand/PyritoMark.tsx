/**
 * The Pyrito D20 mark.
 *
 * This renders the supplied master asset — `src/assets/brand/pyrito-d20.svg`,
 * byte-identical to the kit's `pyrito-d20.svg` — and draws nothing itself. That
 * is the whole point: the kit's `identity.master-mark` (must) requires the
 * master asset, and `identity.fixed-mark-colors` (must_not) forbids recolouring,
 * redrawing, distorting, cropping, or altering the mark's internal geometry. A
 * component that re-typed the polygons would be a redraw the moment either file
 * moved, which is exactly what the version this replaces had become: a
 * hand-simplified silhouette with the interior facets removed.
 *
 * Referenced through `<img>` rather than inlined so the shipped bytes stay the
 * supplied file rather than a transcription of it. The mark carries its own
 * `<title>`, so the element is labelled by the asset and the wrapper stays
 * `alt=""` to avoid announcing the name twice.
 *
 * `data-no-outline` is required: `src/index.css` draws a hairline outline on
 * every chrome `<img>`, which around a transparent mark reads as a box the mark
 * does not have.
 */
import markUrl from '@/assets/brand/pyrito-d20.svg'

interface Props {
  /** Rendered size in px (the mark is square). */
  size?: number
  className?: string
}

export function PyritoMark({ size = 28, className }: Props) {
  return (
    <img
      src={markUrl}
      width={size}
      height={size}
      className={className}
      alt=""
      data-no-outline
      data-brand-mark="pyrito-d20"
      draggable={false}
    />
  )
}
