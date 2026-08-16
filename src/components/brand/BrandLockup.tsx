/**
 * The product lockup — the Pyrito Design *Register* asset, rendered verbatim.
 *
 * Nothing here composes a lockup. The version this replaces assembled one from
 * parts (mark + wordmark + hairline separator + endorsing name, with its own
 * font weights and tracking), and the kit forbids exactly that: `surface.
 * register-canonical` (must) makes the Register system the only surface lockup,
 * `surface.no-alternate-treatment` (must_not) rules out divider-rail and badge
 * treatments as canonical, and the asset policy says "Do not reconstruct or
 * rearrange the lockup." So the component's whole job is to choose the right
 * supplied file and size it.
 *
 * Everything the lockup needs travels inside the asset: the fixed D20, the
 * "Pyrito" wordmark in Cal Sans Heading, the Teal rule, the uppercase Paper Mono
 * "DESIGN" identifier, and the Ember terminal square. The two typefaces are
 * embedded in the SVG as base64 `data:` URIs, so the brand type renders with no
 * font installed and — importantly for the payload's zero-network contract — no
 * request of any kind. `tests/brand/brand.spec.ts` proves the embedded faces
 * actually render, by contrast against the same asset with its `@font-face`
 * rules stripped; if the two ever match, the type silently fell back and the
 * test goes red.
 *
 * Both variants are imported so the choice is a value, not a build flag, and
 * the choice itself lives in `ACTIVE_BRAND_THEME` — one seam for a future light
 * mode to flip.
 */
import darkLockupUrl from '@/assets/brand/pyrito-design-register-dark.svg'
import lightLockupUrl from '@/assets/brand/pyrito-design-register-light.svg'
import { ACTIVE_BRAND_THEME, type BrandTheme } from '@/brand/theme'

/**
 * Light goes on white and light surfaces, dark on Ink and Abyss — the kit's
 * `surface_lockups.variants`. Naming both here (rather than a ternary at the
 * point of use) is what makes the unused one a deliberate import instead of an
 * oversight.
 */
const LOCKUP_BY_THEME: Record<BrandTheme, string> = {
  light: lightLockupUrl,
  dark: darkLockupUrl,
}

/** The asset's own geometry, from its viewBox — used only to preserve ratio. */
const ASSET_WIDTH = 340
const ASSET_HEIGHT = 108
/** The D20's height inside that box, so `size` keeps meaning "mark size". */
const MARK_HEIGHT = 96

interface Props {
  /**
   * Mark size in px. The rest of the lockup scales from it, so a call site that
   * previously sized the composed lockup by its mark keeps its proportions.
   */
  size?: number
  className?: string
}

export function BrandLockup({ size = 28, className }: Props) {
  const height = (size * ASSET_HEIGHT) / MARK_HEIGHT
  const width = (height * ASSET_WIDTH) / ASSET_HEIGHT

  return (
    <img
      src={LOCKUP_BY_THEME[ACTIVE_BRAND_THEME]}
      width={width}
      height={height}
      className={className}
      alt="Pyrito Design"
      data-no-outline
      data-brand-lockup={ACTIVE_BRAND_THEME}
      draggable={false}
    />
  )
}
