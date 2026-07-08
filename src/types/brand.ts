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
