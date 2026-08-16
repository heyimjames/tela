/**
 * Central brand identity.
 *
 * These defaults describe Pyrito Design itself so the demo, previews, and
 * templates look cohesive out of the box. Fork it and change everything here to
 * make it yours — the sidebar, document titles, exports, live post preview,
 * starter templates, and AI seed context all read from this file. Colours live
 * in `palette.ts`.
 *
 * Pyrito is a standalone brand: the kit forbids an endorsement, attribution, or
 * ownership subline anywhere in the signature or the copy
 * (`identity.no-endorsement`, `identity.no-subline`). `productName` is therefore
 * a plain two-word name and not a `parent | child` lockup — the surface
 * identifier ("DESIGN") lives inside the supplied Register asset, which is the
 * one governed exception, and is not assembled here from a delimiter.
 *
 * Note: this is *product identity only*. The MCP contract surface (server name
 * `tela-design-mcp-server`, external id `clickt-tela-design`, the `tela_*` tool
 * names, and the `.tela` format) is protocol and is deliberately untouched.
 */
export const BRAND = {
  /** Product name shown in the header, document titles, and exports. */
  productName: 'Pyrito Design',

  /** Social handle used in the live post preview (no leading @). */
  socialHandle: 'pyrito',

  /** Display name used in the live post preview and templates. */
  displayName: 'Pyrito Design',

  /** Public website shown on starter templates. */
  website: 'clickt.ca',

  /** Seed context for the optional AI Assist feature. */
  ai: {
    productDescription: 'A local-first design canvas for social and ad creatives.',
    targetAudience: 'Designers, marketers, and founders who ship creatives fast.',
    brandVoice: 'Clear, confident, and human — no jargon.',
    callToAction: 'Start designing',
  },
} as const
