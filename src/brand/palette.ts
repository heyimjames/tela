import type { BrandToken } from '@/types/brand'

export const BRAND_PALETTE: Record<string, BrandToken> = {
  // --- Neutrals ---
  'charcoal':     { label: 'Charcoal',     hex: '#100f0f', group: 'neutrals' },
  'charcoal-60':  { label: 'Charcoal 60',  hex: '#100f0f99', group: 'neutrals' },
  'white':        { label: 'White',         hex: '#ffffff', group: 'neutrals' },
  'cloud':        { label: 'Cloud',         hex: '#f8f8f3', group: 'neutrals' },
  'paper':        { label: 'Paper',         hex: '#f2f2eb', group: 'neutrals' },
  'stone':        { label: 'Stone',         hex: '#ebe9e1', group: 'neutrals' },

  // --- Brand ---
  'brand-dark':    { label: 'Brand Dark',    hex: '#3e4576', group: 'brand' },
  'brand-primary': { label: 'Brand Primary', hex: '#0017c7', group: 'brand' },
  'brand-accent':  { label: 'Brand Accent',  hex: '#d0e6e8', group: 'brand' },

  // --- Accent --- (swap these for your own brand accents)
  'accent-1':      { label: 'Accent 1', hex: '#dddde2', group: 'accent' },
  'accent-2':      { label: 'Accent 2', hex: '#4c5ce0', group: 'accent' },
  'accent-3':      { label: 'Accent 3', hex: '#e9e0c0', group: 'accent' },
  'accent-4':      { label: 'Accent 4', hex: '#e75901', group: 'accent' },

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
  'ember-500': { label: 'Ember 500', hex: '#F56139', group: 'ember' },
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

  // --- Teal scale ---
  'teal-50':  { label: 'Teal 50',  hex: '#EFF8F9', group: 'teal' },
  'teal-100': { label: 'Teal 100', hex: '#D5EEF0', group: 'teal' },
  'teal-200': { label: 'Teal 200', hex: '#AADCE1', group: 'teal' },
  'teal-300': { label: 'Teal 300', hex: '#70C3CC', group: 'teal' },
  'teal-400': { label: 'Teal 400', hex: '#3FA8B4', group: 'teal' },
  'teal-500': { label: 'Teal 500', hex: '#268A96', group: 'teal' },
  'teal-600': { label: 'Teal 600', hex: '#1A6B75', group: 'teal' },
  'teal-700': { label: 'Teal 700', hex: '#12525B', group: 'teal' },
  'teal-800': { label: 'Teal 800', hex: '#4A5289', group: 'teal' },
  'teal-900': { label: 'Teal 900', hex: '#3E4576', group: 'teal' },
  'teal-950': { label: 'Teal 950', hex: '#2E3359', group: 'teal' },
} as const

export const BRAND_GROUPS = [
  { id: 'neutrals', label: 'Neutrals' },
  { id: 'brand',    label: 'Brand' },
  { id: 'agents',   label: 'Agents' },
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
