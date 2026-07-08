/**
 * Central brand identity.
 *
 * Rebrand the entire product by editing this one file. Colours live alongside it
 * in `palette.ts`; everything user-visible (titles, the live post preview,
 * starter templates, AI seed context) reads from here.
 */
export const BRAND = {
  /** Product name shown in the header, document titles, and exports. */
  productName: 'Canvas Studio',

  /** Social handle used in the live post preview (no leading @). */
  socialHandle: 'yourbrand',

  /** Display name used in the live post preview and templates. */
  displayName: 'Your Brand',

  /** Public website shown on starter templates. */
  website: 'yourbrand.com',

  /** Seed context for the optional AI Assist feature. */
  ai: {
    productDescription: 'A short description of your product or offer.',
    targetAudience: 'The people this creative is for.',
    brandVoice: 'Clear, confident, and human.',
    callToAction: 'Get started',
  },
} as const
