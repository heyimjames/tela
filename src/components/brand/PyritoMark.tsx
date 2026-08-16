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
 * supplied file rather than a transcription of it.
 *
 * `alt=""` marks it decorative, and that is a deliberate choice rather than an
 * omission: an `<img>` is an opaque replaced element, so the `<title>` *inside*
 * the SVG is not exposed to assistive technology and cannot label it. Every
 * place this component is used sits directly beside the product name in real
 * text, so the accessible name is already there; giving the image one too would
 * announce the brand twice. A future use with no adjacent name needs a real
 * `alt`, not a reliance on the asset.
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
