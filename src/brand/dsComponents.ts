import { getBrandColor } from '@/brand/palette'
import type { BrandColor, ImageLayer, Layer, ShapeLayer, TextLayer } from '@/types/design'
import { SAMPLE_AVATAR_URL } from '@/brand/avatars'

/**
 * Design-system component library for the canvas.
 *
 * Each entry composites a real design-system component (Button,
 * Input, Card, Badge, Avatar, Banner …) out of primitive canvas layers —
 * rounded-rect shapes + centred text. Because the canvas renders through the
 * Canvas-2D compositor (`engine/layerRenderer.ts`), these are inherently
 * NON-INTERACTIVE: they're composited pixels the user arranges to mock up a
 * design, never live controls.
 *
 * Values mirror the DS tokens resolved from `frontend/design-system/tokens`:
 *   --ds-radius-small               → 5px
 *   --ds-color-bg-button-primary    → charcoal #100f0f / white text
 *   --ds-color-bg-button-secondary  → charcoal @5% (≈ stone) / charcoal text
 *   --ds-font-size small/body/big   → 13 / 15 / 17 px
 *   button heights sm/md/lg         → 32 / 40 / 48 px
 */

type LayerSpec = Omit<Layer, 'id' | 'zIndex'>

export type DSComponentCategory =
  | 'buttons'
  | 'inputs'
  | 'cards'
  | 'badges'
  | 'avatars'
  | 'banners'

export interface DSComponentDef {
  id: string
  name: string
  category: DSComponentCategory
  /** Intrinsic component bounds, used both for preview scaling and insertion. */
  width: number
  height: number
  /** Build the primitive layers, offset to (ox, oy). Call build(0, 0) for previews. */
  build: (ox: number, oy: number) => LayerSpec[]
  /**
   * Randomizable photo avatar. Its built image carries a sample URL for the
   * thumbnail; on insert the panel swaps in a random avatar as an inlined data
   * URL (build() is synchronous and can't fetch).
   */
  kind?: 'photo-avatar'
  /** Multi-layer components that should move/select as one unit — the panel
   *  assigns a fresh groupId to every built layer on insert. */
  group?: boolean
}

// --- Token-faithful colours -------------------------------------------------

const RADIUS_SMALL = 5
const RADIUS_CARD = 12

// Brand-palette tokens (rendered via getBrandColor → exact DS hex).
const charcoal = () => getBrandColor('charcoal')
const charcoal60 = () => getBrandColor('charcoal-60')
const white = () => getBrandColor('white')
const stone = () => getBrandColor('stone')
const cloud = () => getBrandColor('cloud')

// Custom hexes for tokens with no direct palette entry. The renderer only reads
// `.hex`, so a descriptive token label is all that's needed alongside it.
const c = (token: string, hex: string): BrandColor => ({ token, hex })

const BORDER_SUBTLE = c('border-subtle', '#100f0f1a') // charcoal @10%

// Sentiment pairs (DS light theme, oklch→hex approximations).
const SENTIMENT = {
  positive: { bg: c('positive-bg', '#e8f6ea'), fg: c('positive-fg', '#1a8a37') },
  warning: { bg: c('warning-bg', '#faf0e2'), fg: c('warning-fg', '#9c6b16') },
  negative: { bg: c('negative-bg', '#fbeae8'), fg: c('negative-fg', '#c23420') },
  info: { bg: c('info-bg', '#e8effb'), fg: c('info-fg', '#2d5ed1') },
} as const

// --- Primitive builders -----------------------------------------------------

interface RectOpts {
  name: string
  x: number
  y: number
  width: number
  height: number
  fill: BrandColor
  radius?: number
  stroke?: { color: BrandColor; width: number }
}

function rect(o: RectOpts): ShapeLayer {
  return {
    type: 'shape',
    name: o.name,
    visible: true,
    locked: false,
    opacity: 1,
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    rotation: 0,
    shape: 'rectangle',
    fill: o.fill,
    borderRadius: o.radius ?? 0,
    ...(o.stroke ? { stroke: o.stroke } : {}),
  } as ShapeLayer
}

function ellipse(o: Omit<RectOpts, 'radius'>): ShapeLayer {
  return {
    type: 'shape',
    name: o.name,
    visible: true,
    locked: false,
    opacity: 1,
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    rotation: 0,
    shape: 'ellipse',
    fill: o.fill,
    borderRadius: 0,
    ...(o.stroke ? { stroke: o.stroke } : {}),
  } as ShapeLayer
}

interface ImageOpts {
  name: string
  x: number
  y: number
  width: number
  height: number
  imageUrl: string
  radius?: number
  avatarSet?: boolean
}

function imageLayer(o: ImageOpts): Omit<ImageLayer, 'id' | 'zIndex'> {
  return {
    type: 'image',
    name: o.name,
    visible: true,
    locked: false,
    opacity: 1,
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    rotation: 0,
    imageUrl: o.imageUrl,
    fit: 'cover',
    cropX: 0,
    cropY: 0,
    cropW: 1,
    cropH: 1,
    borderRadius: o.radius ?? 0,
    aspectRatioLocked: true,
    ...(o.avatarSet ? { avatarSet: true } : {}),
  }
}

interface TextOpts {
  name: string
  content: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  color: BrandColor
  fontWeight?: TextLayer['fontWeight']
  align?: TextLayer['textAlign']
  vAlign?: TextLayer['verticalAlign']
  letterSpacing?: number
  lineHeight?: number
}

function text(o: TextOpts): Omit<TextLayer, 'id' | 'zIndex'> {
  return {
    type: 'text',
    name: o.name,
    visible: true,
    locked: false,
    opacity: 1,
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    rotation: 0,
    content: o.content,
    fontSize: o.fontSize,
    fontWeight: o.fontWeight ?? 400,
    textAlign: o.align ?? 'left',
    color: o.color,
    letterSpacing: o.letterSpacing ?? 0,
    lineHeight: o.lineHeight ?? 1.2,
    textTransform: 'none',
    textWrap: 'pretty',
    textSizing: 'fixed',
    textRole: 'none',
    verticalAlign: o.vAlign ?? 'top',
    underline: false,
    strikethrough: false,
  }
}

/** Rough label width so auto-sized buttons/badges hug their text. */
function estTextWidth(content: string, fontSize: number): number {
  return Math.ceil(content.length * fontSize * 0.56)
}

// --- Button ----------------------------------------------------------------

type ButtonSize = 'sm' | 'md' | 'lg'
const BUTTON_SIZE = {
  sm: { h: 32, padX: 12, font: 13 },
  md: { h: 40, padX: 16, font: 15 },
  lg: { h: 48, padX: 24, font: 17 },
} as const

interface ButtonStyle {
  fill: BrandColor
  fg: BrandColor
  stroke?: { color: BrandColor; width: number }
}

function buttonDef(
  id: string,
  name: string,
  label: string,
  size: ButtonSize,
  style: ButtonStyle,
): DSComponentDef {
  const s = BUTTON_SIZE[size]
  const width = s.padX * 2 + estTextWidth(label, s.font)
  const height = s.h
  return {
    id,
    name,
    category: 'buttons',
    width,
    height,
    build: (ox, oy) => [
      rect({
        name: `${name} background`,
        x: ox,
        y: oy,
        width,
        height,
        fill: style.fill,
        radius: RADIUS_SMALL,
        stroke: style.stroke,
      }),
      text({
        name: `${name} label`,
        content: label,
        x: ox,
        y: oy,
        width,
        height,
        fontSize: s.font,
        color: style.fg,
        fontWeight: 400,
        align: 'center',
        vAlign: 'middle',
      }),
    ],
  }
}

// --- Input ------------------------------------------------------------------

function inputDef(
  id: string,
  name: string,
  placeholder: string,
  opts: { width?: number; height?: number; label?: string; multiline?: boolean } = {},
): DSComponentDef {
  const fieldW = opts.width ?? 280
  const fieldH = opts.height ?? 40
  const labelH = opts.label ? 22 : 0
  const totalH = labelH + fieldH
  return {
    id,
    name,
    category: 'inputs',
    width: fieldW,
    height: totalH,
    build: (ox, oy) => {
      const layers: LayerSpec[] = []
      if (opts.label) {
        layers.push(
          text({
            name: `${name} label`,
            content: opts.label,
            x: ox,
            y: oy,
            width: fieldW,
            height: 16,
            fontSize: 13,
            color: charcoal(),
            fontWeight: 400,
            align: 'left',
            vAlign: 'top',
          }),
        )
      }
      const fieldY = oy + labelH
      layers.push(
        rect({
          name: `${name} field`,
          x: ox,
          y: fieldY,
          width: fieldW,
          height: fieldH,
          fill: white(),
          radius: RADIUS_SMALL,
          stroke: { color: BORDER_SUBTLE, width: 1 },
        }),
        text({
          name: `${name} placeholder`,
          content: placeholder,
          x: ox + 12,
          y: fieldY,
          width: fieldW - 24,
          height: fieldH,
          fontSize: 15,
          color: charcoal60(),
          fontWeight: 400,
          align: 'left',
          vAlign: opts.multiline ? 'top' : 'middle',
          lineHeight: opts.multiline ? 1.5 : 1.2,
        }),
      )
      return layers
    },
  }
}

// --- Badge / status pill ----------------------------------------------------

function badgeDef(
  id: string,
  name: string,
  label: string,
  sentiment: keyof typeof SENTIMENT,
): DSComponentDef {
  const font = 12
  const padX = 10
  const height = 24
  const width = padX * 2 + estTextWidth(label, font)
  const { bg, fg } = SENTIMENT[sentiment]
  return {
    id,
    name,
    category: 'badges',
    width,
    height,
    build: (ox, oy) => [
      {
        ...rect({ name: `${name} background`, x: ox, y: oy, width, height, fill: bg, radius: 0 }),
        shape: 'pill',
      } as ShapeLayer,
      text({
        name: `${name} label`,
        content: label,
        x: ox,
        y: oy,
        width,
        height,
        fontSize: font,
        color: fg,
        fontWeight: 500,
        align: 'center',
        vAlign: 'middle',
      }),
    ],
  }
}

// --- Avatar -----------------------------------------------------------------

function avatarDef(id: string, name: string, size: number, initials: string): DSComponentDef {
  return {
    id,
    name,
    category: 'avatars',
    width: size,
    height: size,
    // Grouped so the badge + initials move and select as one component; the
    // panel assigns a fresh groupId per drop.
    group: true,
    build: (ox, oy) => [
      // A rounded rectangle (not an ellipse) so the Corner Radius control is
      // available — default "Full" (9999) renders a circle, but the user can
      // dial it down to a squircle/square. Native rx clamping keeps it circular.
      rect({
        name: `${name} background`,
        x: ox,
        y: oy,
        width: size,
        height: size,
        fill: getBrandColor('brand-accent'),
        radius: 9999,
      }),
      text({
        name: `${name} initials`,
        content: initials,
        x: ox,
        y: oy,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        color: getBrandColor('brand-dark'),
        fontWeight: 500,
        align: 'center',
        vAlign: 'middle',
      }),
    ],
  }
}

/**
 * Photo avatar — a circular image sourced from the bundled 100-face set. The
 * built layer carries a sample URL for the library thumbnail; on insert the
 * panel swaps in a random face (as an inlined data URL) and the inspector
 * exposes a Shuffle action to cycle through the set.
 */
function avatarPhotoDef(id: string, name: string, size: number): DSComponentDef {
  return {
    id,
    name,
    category: 'avatars',
    kind: 'photo-avatar',
    width: size,
    height: size,
    build: (ox, oy) => [
      imageLayer({
        name: `${name}`,
        x: ox,
        y: oy,
        width: size,
        height: size,
        imageUrl: SAMPLE_AVATAR_URL,
        radius: 9999,
        avatarSet: true,
      }),
    ],
  }
}

// --- Card -------------------------------------------------------------------

function cardBase(name: string, ox: number, oy: number, width: number, height: number): ShapeLayer {
  return rect({
    name: `${name} surface`,
    x: ox,
    y: oy,
    width,
    height,
    fill: white(),
    radius: RADIUS_CARD,
    stroke: { color: BORDER_SUBTLE, width: 1 },
  })
}

// --- Banner -----------------------------------------------------------------

function bannerDef(
  id: string,
  name: string,
  title: string,
  body: string,
  sentiment: keyof typeof SENTIMENT,
): DSComponentDef {
  const width = 420
  const height = 76
  const { bg, fg } = SENTIMENT[sentiment]
  return {
    id,
    name,
    category: 'banners',
    width,
    height,
    build: (ox, oy) => [
      rect({
        name: `${name} surface`,
        x: ox,
        y: oy,
        width,
        height,
        fill: bg,
        radius: RADIUS_SMALL,
      }),
      ellipse({ name: `${name} icon`, x: ox + 16, y: oy + 18, width: 20, height: 20, fill: fg }),
      text({
        name: `${name} title`,
        content: title,
        x: ox + 48,
        y: oy + 16,
        width: width - 64,
        height: 20,
        fontSize: 15,
        color: charcoal(),
        fontWeight: 500,
        align: 'left',
        vAlign: 'top',
      }),
      text({
        name: `${name} body`,
        content: body,
        x: ox + 48,
        y: oy + 38,
        width: width - 64,
        height: 22,
        fontSize: 13,
        color: charcoal60(),
        fontWeight: 400,
        align: 'left',
        vAlign: 'top',
        lineHeight: 1.4,
      }),
    ],
  }
}

// --- Catalog ----------------------------------------------------------------

export const DS_COMPONENTS: DSComponentDef[] = [
  // Buttons — the three core variants at the default md size, plus size + sentiment samples.
  buttonDef('btn-primary', 'Primary button', 'Button', 'md', { fill: charcoal(), fg: white() }),
  buttonDef('btn-secondary', 'Secondary button', 'Button', 'md', { fill: stone(), fg: charcoal() }),
  buttonDef('btn-tertiary', 'Tertiary button', 'Button', 'md', {
    fill: white(),
    fg: charcoal(),
    stroke: { color: BORDER_SUBTLE, width: 1 },
  }),
  buttonDef('btn-ghost', 'Ghost button', 'Button', 'md', { fill: cloud(), fg: charcoal() }),
  buttonDef('btn-primary-sm', 'Primary button — sm', 'Button', 'sm', {
    fill: charcoal(),
    fg: white(),
  }),
  buttonDef('btn-primary-lg', 'Primary button — lg', 'Button', 'lg', {
    fill: charcoal(),
    fg: white(),
  }),
  buttonDef('btn-positive', 'Positive button', 'Confirm', 'md', {
    fill: SENTIMENT.positive.fg,
    fg: white(),
  }),
  buttonDef('btn-negative', 'Negative button', 'Delete', 'md', {
    fill: SENTIMENT.negative.fg,
    fg: white(),
  }),

  // Inputs
  inputDef('input-text', 'Text input', 'Placeholder'),
  inputDef('input-labelled', 'Input with label', 'jane@example.com', { label: 'Email address' }),
  inputDef('input-search', 'Search input', 'Search…'),
  inputDef('input-textarea', 'Textarea', 'Write a message…', { height: 96, multiline: true }),

  // Cards
  {
    id: 'card-basic',
    name: 'Card',
    category: 'cards',
    width: 320,
    height: 180,
    build: (ox, oy) => [
      cardBase('Card', ox, oy, 320, 180),
      text({
        name: 'Card title',
        content: 'Card title',
        x: ox + 20,
        y: oy + 20,
        width: 280,
        height: 24,
        fontSize: 17,
        color: charcoal(),
        fontWeight: 500,
        align: 'left',
        vAlign: 'top',
      }),
      text({
        name: 'Card body',
        content: 'Supporting copy that explains what this card is about in a sentence or two.',
        x: ox + 20,
        y: oy + 52,
        width: 280,
        height: 64,
        fontSize: 14,
        color: charcoal60(),
        fontWeight: 400,
        align: 'left',
        vAlign: 'top',
        lineHeight: 1.45,
      }),
      rect({
        name: 'Card button background',
        x: ox + 20,
        y: oy + 124,
        width: 12 * 2 + estTextWidth('Action', 13),
        height: 32,
        fill: charcoal(),
        radius: RADIUS_SMALL,
      }),
      text({
        name: 'Card button label',
        content: 'Action',
        x: ox + 20,
        y: oy + 124,
        width: 12 * 2 + estTextWidth('Action', 13),
        height: 32,
        fontSize: 13,
        color: white(),
        fontWeight: 400,
        align: 'center',
        vAlign: 'middle',
      }),
    ],
  },
  {
    id: 'card-info',
    name: 'Info card',
    category: 'cards',
    width: 320,
    height: 96,
    build: (ox, oy) => [
      cardBase('Info card', ox, oy, 320, 96),
      ellipse({
        name: 'Info card avatar',
        x: ox + 20,
        y: oy + 24,
        width: 48,
        height: 48,
        fill: getBrandColor('brand-accent'),
      }),
      text({
        name: 'Info card avatar initials',
        content: 'AB',
        x: ox + 20,
        y: oy + 24,
        width: 48,
        height: 48,
        fontSize: 18,
        color: getBrandColor('brand-dark'),
        fontWeight: 500,
        align: 'center',
        vAlign: 'middle',
      }),
      text({
        name: 'Info card title',
        content: 'Jane Doe',
        x: ox + 84,
        y: oy + 26,
        width: 216,
        height: 22,
        fontSize: 15,
        color: charcoal(),
        fontWeight: 500,
        align: 'left',
        vAlign: 'top',
      }),
      text({
        name: 'Info card subtitle',
        content: 'Senior Product Designer',
        x: ox + 84,
        y: oy + 48,
        width: 216,
        height: 20,
        fontSize: 13,
        color: charcoal60(),
        fontWeight: 400,
        align: 'left',
        vAlign: 'top',
      }),
    ],
  },
  {
    id: 'card-stat',
    name: 'Stat card',
    category: 'cards',
    width: 220,
    height: 120,
    build: (ox, oy) => [
      cardBase('Stat card', ox, oy, 220, 120),
      text({
        name: 'Stat value',
        content: '1,284',
        x: ox + 20,
        y: oy + 24,
        width: 180,
        height: 44,
        fontSize: 36,
        color: charcoal(),
        fontWeight: 500,
        align: 'left',
        vAlign: 'top',
        letterSpacing: -0.02,
      }),
      text({
        name: 'Stat label',
        content: 'Candidates sourced',
        x: ox + 20,
        y: oy + 76,
        width: 180,
        height: 20,
        fontSize: 13,
        color: charcoal60(),
        fontWeight: 400,
        align: 'left',
        vAlign: 'top',
      }),
    ],
  },

  // Badges / status pills
  badgeDef('badge-positive', 'Positive badge', 'Active', 'positive'),
  badgeDef('badge-warning', 'Warning badge', 'Pending', 'warning'),
  badgeDef('badge-negative', 'Negative badge', 'Rejected', 'negative'),
  badgeDef('badge-info', 'Info badge', 'New', 'info'),

  // Avatars
  avatarDef('avatar-sm', 'Avatar — sm', 32, 'AB'),
  avatarDef('avatar-md', 'Avatar — md', 48, 'AB'),
  avatarDef('avatar-lg', 'Avatar — lg', 64, 'JJ'),
  avatarPhotoDef('avatar-photo', 'Avatar — photo', 64),

  // Banners
  bannerDef('banner-info', 'Info banner', 'Heads up', 'Here is something you should know about.', 'info'),
  bannerDef('banner-positive', 'Success banner', 'All done', 'Your changes have been saved successfully.', 'positive'),
  bannerDef('banner-warning', 'Warning banner', 'Careful', 'This action may have unintended effects.', 'warning'),
]

export const DS_COMPONENT_CATEGORIES: { id: DSComponentCategory; label: string }[] = [
  { id: 'buttons', label: 'Buttons' },
  { id: 'inputs', label: 'Inputs' },
  { id: 'cards', label: 'Cards' },
  { id: 'badges', label: 'Badges' },
  { id: 'avatars', label: 'Avatars' },
  { id: 'banners', label: 'Banners' },
]
