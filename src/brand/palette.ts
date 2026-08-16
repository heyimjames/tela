import type { BrandToken } from '@/types/brand'

/**
 * Pyrito Design brand palette.
 *
 * The "Brand" group is the Pyrito core teal ramp, taken verbatim from the brand
 * kit (`teal-50 … teal-700` plus `abyss`); the ramp's values are unchanged by
 * the rebrand — the kit's teal ramp and the ramp this group already carried are
 * the same six colours — so no saved document shifts hue. Only the labels move
 * from the retired division names to the kit's own token names.
 *
 * Token *keys* are deliberately unchanged (`brand-primary`, `brand-dark`,
 * `brand-accent`): documents, MCP `tela_set_brand_context` calls, and saved
 * `.tela` bundles address colours by key, so re-keying the ramp would silently
 * orphan every existing document.
 *
 * The same constraint governs retirement. `accent-1` and `accent-2` carried
 * sibling-division colours, and a standalone Pyrito has no siblings to point at
 * (`identity.standalone`, `identity.no-endorsement`) — but deleting the keys
 * would throw `Unknown brand token` for any document already using them, and
 * repointing them at a Pyrito colour would silently repaint that document. They
 * are therefore moved to a `legacy` group: still resolvable by key, no longer
 * listed in `BRAND_GROUPS`, so the picker stops offering them and the AI roster
 * (which selects by group) stops naming them. Existing artwork is untouched;
 * new artwork cannot reach them.
 */
export const BRAND_PALETTE: Record<string, BrandToken> = {
  // --- Neutrals ---
  'charcoal':     { label: 'Ink',           hex: '#0b0f0e', group: 'neutrals' },
  'charcoal-60':  { label: 'Ink 60',        hex: '#0b0f0e99', group: 'neutrals' },
  'white':        { label: 'White',         hex: '#ffffff', group: 'neutrals' },
  'cloud':        { label: 'Cloud',         hex: '#f3f4f6', group: 'neutrals' },
  'paper':        { label: 'Off-white',     hex: '#f4f6f5', group: 'neutrals' },
  'stone':        { label: 'Mist',          hex: '#e7eaed', group: 'neutrals' },
  'slate':        { label: 'Slate',         hex: '#5c6470', group: 'neutrals' },

  // --- Brand --- (Pyrito core ramp)
  'brand-wash':    { label: 'Teal 50',      hex: '#dae9e6', group: 'brand' },
  'brand-accent':  { label: 'Teal 100',     hex: '#97c4bd', group: 'brand' },
  'brand-mid':     { label: 'Teal 300',     hex: '#5ba89a', group: 'brand' },
  'brand-primary': { label: 'Teal',         hex: '#1f7a82', group: 'brand' },
  'brand-dark':    { label: 'Teal 700',     hex: '#0f4a52', group: 'brand' },
  'brand-ink':     { label: 'Abyss',        hex: '#07262b', group: 'brand' },

  // --- Accent --- (the kit allows exactly two general accents, Teal and Ember;
  // Teal is the Brand group above, so Ember is the whole of this one. Slate is a
  // neutral kept here for the picker's convenience, not a brand accent.)
  'accent-3':      { label: 'Ember',  hex: '#f86b3c', group: 'accent' },
  'accent-4':      { label: 'Slate',  hex: '#5c6470', group: 'accent' },

  // --- Legacy --- (resolvable for documents that already reference them;
  // deliberately absent from BRAND_GROUPS, so nothing offers them again)
  'accent-1':      { label: 'Perf',   hex: '#b4e01f', group: 'legacy' },
  'accent-2':      { label: 'Studio', hex: '#4e4060', group: 'legacy' },

  // --- Traffic ---
  'green':   { label: 'Green',   hex: '#78d55c', group: 'traffic' },
  'orange':  { label: 'Orange',  hex: '#ffb051', group: 'traffic' },
  'red':     { label: 'Red',     hex: '#ef3737', group: 'traffic' },

  // --- Earths ---
  'olive':      { label: 'Olive',      hex: '#a3b0a0', group: 'earths' },
  'terracotta': { label: 'Terracotta', hex: '#a38a80', group: 'earths' },
  'clay':       { label: 'Clay',       hex: '#c2bcae', group: 'earths' },

  // --- Waters ---
  'sea':    { label: 'Sea',    hex: '#80a1a6', group: 'waters' },
  'straw':  { label: 'Straw',  hex: '#d5d3ae', group: 'waters' },
  'squash': { label: 'Squash', hex: '#d9c59b', group: 'waters' },

  // --- Pastels ---
  'sky':     { label: 'Sky',     hex: '#c5e4e9', group: 'pastels' },
  'lime':    { label: 'Lime',    hex: '#eaffd6', group: 'pastels' },
  'sherbet': { label: 'Sherbet', hex: '#f3f0b5', group: 'pastels' },

  // --- Ember scale ---
  'ember-50':  { label: 'Ember 50',  hex: '#FFF2EE', group: 'ember' },
  'ember-100': { label: 'Ember 100', hex: '#FFDFD5', group: 'ember' },
  'ember-200': { label: 'Ember 200', hex: '#FFC2AF', group: 'ember' },
  'ember-300': { label: 'Ember 300', hex: '#FF9B7F', group: 'ember' },
  'ember-400': { label: 'Ember 400', hex: '#FC7754', group: 'ember' },
  // The scale's anchor is the kit's Ember exactly, so CHROME_SIGNAL and every
  // starter-template CTA resolve to a documented brand value rather than to the
  // editor's own near-miss (#F56139) that predated the kit.
  'ember-500': { label: 'Ember 500', hex: '#F86B3C', group: 'ember' },
  'ember-600': { label: 'Ember 600', hex: '#D24825', group: 'ember' },
  'ember-700': { label: 'Ember 700', hex: '#A73920', group: 'ember' },
  'ember-800': { label: 'Ember 800', hex: '#822D1D', group: 'ember' },
  'ember-900': { label: 'Ember 900', hex: '#5E2218', group: 'ember' },
  'ember-950': { label: 'Ember 950', hex: '#37120D', group: 'ember' },

  // --- Gold scale ---
  'gold-50':  { label: 'Gold 50',  hex: '#FBF7EC', group: 'gold' },
  'gold-100': { label: 'Gold 100', hex: '#F6EDD3', group: 'gold' },
  'gold-200': { label: 'Gold 200', hex: '#EFDFB3', group: 'gold' },
  'gold-300': { label: 'Gold 300', hex: '#E7CF8E', group: 'gold' },
  'gold-400': { label: 'Gold 400', hex: '#E2C580', group: 'gold' },
  'gold-500': { label: 'Gold 500', hex: '#d9c59b', group: 'gold' },
  'gold-600': { label: 'Gold 600', hex: '#C4A95F', group: 'gold' },
  'gold-700': { label: 'Gold 700', hex: '#9A833F', group: 'gold' },
  'gold-800': { label: 'Gold 800', hex: '#6F5E29', group: 'gold' },
  'gold-900': { label: 'Gold 900', hex: '#4C3F1A', group: 'gold' },
  'gold-950': { label: 'Gold 950', hex: '#2E260F', group: 'gold' },

  // --- Teal scale --- (interpolated through the Pyrito core-ramp anchors:
  // 100/300/400 are teal-50/100/300, 600/800/950 are teal/teal-700/abyss. The
  // pre-re-skin scale slid off-hue into indigo at 800–950, which is why
  // gradients built on `teal-800` + `brand-dark` used to match; they now share
  // the brand hue.)
  'teal-50':  { label: 'Teal 50',  hex: '#F1F8F7', group: 'teal' },
  'teal-100': { label: 'Teal 100', hex: '#DAE9E6', group: 'teal' },
  'teal-200': { label: 'Teal 200', hex: '#B9D8D3', group: 'teal' },
  'teal-300': { label: 'Teal 300', hex: '#97C4BD', group: 'teal' },
  'teal-400': { label: 'Teal 400', hex: '#5BA89A', group: 'teal' },
  'teal-500': { label: 'Teal 500', hex: '#2F8E90', group: 'teal' },
  'teal-600': { label: 'Teal 600', hex: '#1F7A82', group: 'teal' },
  'teal-700': { label: 'Teal 700', hex: '#17636B', group: 'teal' },
  'teal-800': { label: 'Teal 800', hex: '#0F4A52', group: 'teal' },
  'teal-900': { label: 'Teal 900', hex: '#0A363C', group: 'teal' },
  'teal-950': { label: 'Teal 950', hex: '#07262B', group: 'teal' },
} as const

export const BRAND_GROUPS = [
  { id: 'neutrals', label: 'Neutrals' },
  { id: 'brand',    label: 'Brand' },
  { id: 'accent',   label: 'Accent' },
  { id: 'traffic',  label: 'Traffic' },
  { id: 'earths',   label: 'Earths' },
  { id: 'waters',   label: 'Waters' },
  { id: 'pastels',  label: 'Pastels' },
  { id: 'ember',    label: 'Ember' },
  { id: 'gold',     label: 'Gold' },
  { id: 'teal',     label: 'Teal' },
] as const

export function getBrandColor(token: string): { token: string; hex: string } {
  const t = BRAND_PALETTE[token]
  if (!t) throw new Error(`Unknown brand token: ${token}`)
  return { token, hex: t.hex }
}

export function getTokensByGroup(group: string) {
  return Object.entries(BRAND_PALETTE)
    .filter(([, t]) => t.group === group)
    .map(([key, t]) => ({ token: key, ...t }))
}

/**
 * The colour roster offered to the LLM — the single source for *every*
 * model-facing prompt (the AI panel and the `useAIStore` design/relayout
 * prompts). Hand-maintained copies of this list silently drift from the brand
 * the moment it is re-skinned, and a prompt that names a retired hex invites
 * the model to emit a literal colour that is not in the palette at all.
 *
 * `ember-500` is included explicitly rather than by group: it is the CTA colour
 * every starter template uses (and `CHROME_SIGNAL`), but the other ten ember
 * shades are noise in a prompt. Alpha hexes are excluded — the model cannot
 * reason about an 8-digit hex, and layers address the token anyway.
 *
 * Ordering is deterministic: `Object.entries` preserves the literal declaration
 * order of `BRAND_PALETTE`, so the same build always renders the same prompt.
 */
const AI_COLOR_GROUPS = ['neutrals', 'brand', 'accent'] as const
const AI_COLOR_EXTRA_TOKENS = ['ember-500'] as const

export const AI_BRAND_COLORS = [
  ...AI_COLOR_GROUPS.flatMap((group) => getTokensByGroup(group)),
  ...AI_COLOR_EXTRA_TOKENS.map((token) => ({ token, ...BRAND_PALETTE[token] })),
].filter((t) => /^#[0-9a-fA-F]{6}$/.test(t.hex))

/** `token (#hex), …` — for prompts that show the model the actual colours. */
export const AI_BRAND_COLOR_LIST = AI_BRAND_COLORS
  .map((t) => `${t.token} (${t.hex})`)
  .join(', ')

/** `token, …` — for prompts that only need the legal `colorToken` values. */
export const AI_BRAND_COLOR_TOKENS = AI_BRAND_COLORS
  .map((t) => t.token)
  .join(', ')
