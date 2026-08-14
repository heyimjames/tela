/**
 * Editor chrome colours.
 *
 * Selection, hover, grid and text-edit affordances are painted into inline SVG
 * and inline styles, where a CSS custom property is not reliably resolved as a
 * presentation attribute. They therefore need literal hex — but exactly once,
 * here, derived from the brand palette rather than re-typed at each call site.
 *
 * `CHROME_ACCENT` is the hive-500 primary: selection outlines, handles, the
 * text-edit ring, grid guides. `CHROME_SIGNAL` stays ember on purpose — smart
 * guides and distance measurements have to read as a *different* signal from
 * "this is selected", and ember against hive teal is the highest-contrast pair
 * the brand system offers.
 */
import { BRAND_PALETTE } from '@/brand/palette'

/** Primary editor accent (hive-500) — selection, handles, focus rings. */
export const CHROME_ACCENT = BRAND_PALETTE['brand-primary'].hex

/** Secondary signal (ember) — smart guides, distance measurements, layout hints. */
export const CHROME_SIGNAL = BRAND_PALETTE['ember-500'].hex
