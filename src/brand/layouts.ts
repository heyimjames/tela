import { getBrandColor } from '@/brand/palette'
import type { Layer, TextLayer, ShapeLayer, FontWeight } from '@/types/design'

// A layout drops a set of well-placed *placeholder* layers — a composition you
// fill in — rather than a finished design. Every layout is a function of the
// frame's width/height, so it adapts to any aspect ratio (landscape banner,
// square post, portrait story). This is the macro-level guardrail: pick a good
// structure and you can't end up with a lopsided, unaligned mess.

export type LayoutLayer = Omit<Layer, 'id' | 'zIndex'>
export type LayoutFit = 'any' | 'landscape' | 'portrait' | 'square'

export interface DesignLayout {
  id: string
  name: string
  description: string
  /** Which aspect ratios this composition is designed for (used to sort/hint). */
  fits: LayoutFit
  build: (w: number, h: number) => LayoutLayer[]
}

// --- placeholder builders ---------------------------------------------------

const base = { visible: true, locked: false, opacity: 1, rotation: 0 } as const

function t(
  name: string,
  content: string,
  x: number, y: number, w: number,
  fontSize: number,
  opts: { weight?: FontWeight; align?: 'left' | 'center' | 'right'; color?: string; lines?: number; upper?: boolean } = {},
): Omit<TextLayer, 'id' | 'zIndex'> {
  const lineHeight = 1.2
  return {
    ...base,
    type: 'text',
    name,
    x: Math.round(x), y: Math.round(y), width: Math.round(w),
    height: Math.round(fontSize * lineHeight * (opts.lines ?? 1) + 2),
    content,
    fontSize: Math.round(fontSize),
    fontWeight: opts.weight ?? 400,
    textAlign: opts.align ?? 'left',
    color: getBrandColor(opts.color ?? 'charcoal'),
    letterSpacing: fontSize >= 40 ? -0.02 : 0,
    lineHeight,
    textTransform: opts.upper ? 'uppercase' : 'none',
  }
}

/** A soft placeholder box — stands in for an image or a media area. */
function media(name: string, x: number, y: number, w: number, h: number, radius = 12): Omit<ShapeLayer, 'id' | 'zIndex'> {
  return {
    ...base, type: 'shape', name,
    x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h),
    shape: 'rectangle', fill: getBrandColor('stone'), borderRadius: radius,
  }
}

/** A CTA button (pill) + its label, returned as two layers. */
function cta(x: number, y: number, w: number, h: number, label = 'Get started'): LayoutLayer[] {
  const pill: Omit<ShapeLayer, 'id' | 'zIndex'> = {
    ...base, type: 'shape', name: 'Button',
    x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h),
    shape: 'pill', fill: getBrandColor('ember-500'), borderRadius: 9999,
  }
  return [pill, t('Button label', label, x, y + h * 0.28, w, h * 0.42, { weight: 600, align: 'center', color: 'white' })]
}

// --- the layouts ------------------------------------------------------------

export const DESIGN_LAYOUTS: DesignLayout[] = [
  {
    id: 'centered',
    name: 'Centered',
    description: 'Headline, subhead and button stacked in the middle.',
    fits: 'any',
    build: (w, h) => {
      const u = Math.min(w, h) / 100
      const m = w * 0.1
      const cw = w - m * 2
      return [
        t('Headline', 'Your headline here', m, h * 0.32, cw, 9 * u, { weight: 700, align: 'center', lines: 2 }),
        t('Subhead', 'A short supporting line of copy.', m, h * 0.52, cw, 3.4 * u, { align: 'center', color: 'charcoal-60', lines: 2 }),
        ...cta(w / 2 - 12 * u, h * 0.66, 24 * u, 6.5 * u),
      ]
    },
  },
  {
    id: 'editorial-split',
    name: 'Editorial split',
    description: 'Media on one side, text on the other. Adapts to the shape.',
    fits: 'any',
    build: (w, h) => {
      const u = Math.min(w, h) / 100
      const landscape = w > h * 1.15
      if (landscape) {
        const half = w * 0.46
        const tx = half + w * 0.06, tw = w - tx - w * 0.06
        return [
          media('Image', w * 0.05, h * 0.08, half - w * 0.05, h * 0.84),
          t('Headline', 'Say it here', tx, h * 0.2, tw, 8 * u, { weight: 700, lines: 2 }),
          t('Body', 'A couple of lines of supporting copy to explain the offer.', tx, h * 0.44, tw, 3.2 * u, { color: 'charcoal-60', lines: 3 }),
          ...cta(tx, h * 0.72, 22 * u, 6.5 * u),
        ]
      }
      // portrait / square → media on top, text below
      const mh = h * 0.5
      return [
        media('Image', w * 0.06, h * 0.06, w * 0.88, mh),
        t('Headline', 'Say it here', w * 0.06, mh + h * 0.11, w * 0.88, 8 * u, { weight: 700, lines: 2 }),
        t('Body', 'A short supporting line or two of copy.', w * 0.06, mh + h * 0.27, w * 0.88, 3.2 * u, { color: 'charcoal-60', lines: 2 }),
        ...cta(w * 0.06, mh + h * 0.4, 24 * u, 6.5 * u),
      ]
    },
  },
  {
    id: 'hero',
    name: 'Hero + CTA',
    description: 'Big statement up top, button anchored at the bottom.',
    fits: 'portrait',
    build: (w, h) => {
      const u = Math.min(w, h) / 100
      const m = w * 0.08
      const cw = w - m * 2
      return [
        t('Kicker', 'INTRODUCING', m, h * 0.1, cw, 3 * u, { weight: 600, upper: true, color: 'brand-primary' }),
        t('Headline', 'A bold headline that fills the space', m, h * 0.16, cw, 10 * u, { weight: 700, lines: 3 }),
        t('Subhead', 'Supporting copy sits just beneath the headline.', m, h * 0.48, cw, 3.4 * u, { color: 'charcoal-60', lines: 2 }),
        ...cta(m, h * 0.84, 30 * u, 7 * u),
      ]
    },
  },
  {
    id: 'big-number',
    name: 'Big stat',
    description: 'A large number with a supporting label.',
    fits: 'any',
    build: (w, h) => {
      const u = Math.min(w, h) / 100
      const m = w * 0.1
      return [
        t('Number', '93%', m, h * 0.28, w - m * 2, 34 * u, { weight: 700, align: 'center' }),
        t('Label', 'of customers would recommend us', m, h * 0.6, w - m * 2, 3.6 * u, { align: 'center', color: 'charcoal-60', lines: 2 }),
      ]
    },
  },
  {
    id: 'quote',
    name: 'Quote',
    description: 'A large pull-quote with attribution.',
    fits: 'any',
    build: (w, h) => {
      const u = Math.min(w, h) / 100
      const m = w * 0.1
      const cw = w - m * 2
      return [
        t('Quote mark', '“', m, h * 0.14, cw, 20 * u, { weight: 700, color: 'brand-accent' }),
        t('Quote', 'A short, punchy customer quote that earns trust.', m, h * 0.34, cw, 7 * u, { weight: 600, lines: 3 }),
        t('Attribution', '— Name, Role', m, h * 0.74, cw, 3 * u, { color: 'charcoal-60' }),
      ]
    },
  },
  {
    id: 'trio',
    name: 'Three across',
    description: 'Three equal blocks — features, steps, or stats.',
    fits: 'any',
    build: (w, h) => {
      const u = Math.min(w, h) / 100
      const landscape = w > h
      const out: LayoutLayer[] = [t('Title', 'Three things', w * 0.08, h * 0.08, w * 0.84, 6 * u, { weight: 700 })]
      const items = 3
      if (landscape) {
        const gap = w * 0.04, m = w * 0.08
        const bw = (w - m * 2 - gap * (items - 1)) / items
        const by = h * 0.32, bh = h * 0.44
        for (let i = 0; i < items; i++) {
          const x = m + i * (bw + gap)
          out.push(media(`Block ${i + 1}`, x, by, bw, bh))
          out.push(t(`Caption ${i + 1}`, 'Short label', x, by + bh + h * 0.03, bw, 3 * u, { align: 'center', color: 'charcoal-60' }))
        }
      } else {
        const gap = h * 0.03, m = w * 0.08
        const rowH = h * 0.15
        const by = h * 0.24
        for (let i = 0; i < items; i++) {
          const y = by + i * (rowH + gap)
          out.push(media(`Icon ${i + 1}`, m, y, rowH, rowH, 10))
          out.push(t(`Row ${i + 1}`, 'A line describing this item.', m + rowH + w * 0.04, y + rowH * 0.28, w - m * 2 - rowH - w * 0.04, 3.4 * u, { color: 'charcoal', lines: 2 }))
        }
      }
      return out
    },
  },
  {
    id: 'banner-lockup',
    name: 'Banner lockup',
    description: 'Text on the left, button on the right — for wide banners.',
    fits: 'landscape',
    build: (w, h) => {
      const u = Math.min(w, h) / 100
      const m = w * 0.04
      return [
        t('Headline', 'Your message, front and centre', m, h * 0.28, w * 0.62, 7 * u, { weight: 700, lines: 2 }),
        t('Subhead', 'One supporting line.', m, h * 0.62, w * 0.55, 3.4 * u, { color: 'charcoal-60' }),
        ...cta(w - m - 26 * u, h * 0.5 - 3.5 * u, 26 * u, 7 * u),
      ]
    },
  },
]
