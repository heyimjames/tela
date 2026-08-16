export interface BrandToken {
  label: string
  hex: string
  group: BrandGroup
}

export type BrandGroup =
  | 'neutrals'
  | 'brand'
  | 'accent'
  | 'traffic'
  | 'earths'
  | 'waters'
  | 'pastels'
  | 'ember'
  | 'gold'
  | 'teal'
  /**
   * Retired tokens: still resolvable by key so documents that already reference
   * them keep rendering, but deliberately absent from `BRAND_GROUPS`, so no
   * picker or AI roster offers them again. See `BRAND_PALETTE`.
   */
  | 'legacy'
