/**
 * Editor chrome colours.
 *
 * Selection, hover, grid and text-edit affordances are painted into inline SVG
 * and inline styles, where a CSS custom property is not reliably resolved as a
 * presentation attribute. They therefore need literal hex — but exactly once,
 * here, derived from the brand palette rather than re-typed at each call site.
 *
 * `CHROME_ACCENT` is Teal, the brand's primary interaction colour: selection
 * outlines, handles, the text-edit ring, grid guides — `color.teal-leads` says
 * selection and focus are Teal's job. `CHROME_SIGNAL` stays Ember on purpose —
 * smart guides and distance measurements have to read as a *different* signal
 * from "this is selected", and Teal and Ember are the only two general accents
 * the kit allows, so they are also the highest-contrast pair available. Ember
 * here is hairlines and numerals, never a filled field
 * (`color.ember-no-fields`).
 */
import { BRAND_PALETTE } from '@/brand/palette'

/** Primary editor accent (Teal) — selection, handles, focus rings. */
export const CHROME_ACCENT = BRAND_PALETTE['brand-primary'].hex

/** Secondary signal (Ember) — smart guides, distance measurements, layout hints. */
export const CHROME_SIGNAL = BRAND_PALETTE['ember-500'].hex
