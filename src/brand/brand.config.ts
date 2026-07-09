/**
 * Central brand identity.
 *
 * These defaults describe Tela itself so the demo, previews, and templates look
 * cohesive out of the box. Fork it and change everything here to make it yours —
 * the sidebar, document titles, exports, live post preview, starter templates,
 * and AI seed context all read from this file. Colours live in `palette.ts`.
 */
export const BRAND = {
  /** Product name shown in the header, document titles, and exports. */
  productName: 'Tela',

  /** Social handle used in the live post preview (no leading @). */
  socialHandle: 'tela',

  /** Display name used in the live post preview and templates. */
  displayName: 'Tela',

  /** Public website shown on starter templates. */
  website: 'tela.design',

  /** Seed context for the optional AI Assist feature. */
  ai: {
    productDescription: 'A local-first design canvas for social and ad creatives.',
    targetAudience: 'Designers, marketers, and founders who ship creatives fast.',
    brandVoice: 'Clear, confident, and human — no jargon.',
    callToAction: 'Start designing',
  },
} as const
