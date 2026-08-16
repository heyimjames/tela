/**
 * The app's active brand theme — the single seam between "which theme is the
 * chrome painted in" and "which brand asset variant goes with it".
 *
 * The application ships exactly one theme today. `src/index.css` says so at
 * length: dark is not a mode here, it is the base `:root` ramp, and nothing ever
 * sets a `.dark` class. This constant exists so that fact is stated ONCE, in a
 * place a light mode can flip, instead of being re-derived by every component
 * that needs to pick a light-or-dark asset.
 *
 * The Pyrito kit ships a light and a dark variant of every Register lockup, and
 * both are imported (see `BrandLockup`). Only the variant naming the active
 * theme is rendered. When a light mode lands it should flip the tokens in
 * `index.css` and the value here — and every brand asset follows, with no call
 * site to hunt down.
 *
 * Deliberately a plain constant and not a hook or a media query: a
 * `prefers-color-scheme` read would report the *viewer's* preference, which the
 * chrome does not honour, and the lockup would then go light on a light-mode
 * machine while the panels behind it stayed Ink — off-brand and unreadable.
 */
export type BrandTheme = 'light' | 'dark'

/**
 * The theme the chrome is actually painted in. Keep in step with the `:root`
 * ramp in `src/index.css`; `src/brand/brand.test.ts` asserts they agree.
 */
export const ACTIVE_BRAND_THEME: BrandTheme = 'dark'
