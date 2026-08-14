/**
 * The full-coverage fixture.
 *
 * Its job is to be the document that would break a lossy serializer. Every layer
 * type appears twice: once with **every optional property set** and once with
 * **every optional property absent**, because those are the two ways a field gets
 * silently dropped (an unknown key stripped on the way in, or an `undefined`
 * materialised on the way out). Every accepted asset MIME type appears at least
 * once, one asset is referenced from two places to exercise deduplication, and the
 * auto-layout graph is nested so the parent-link walk has something to walk.
 *
 * Adding a field to the schema without adding it here should be caught by
 * `coverage.test.ts`, which walks the schema and asserts the fixture exercises it.
 */

import { base64Encode } from '../assets'

// --- Asset payloads -----------------------------------------------------------

function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${base64Encode(bytes)}`
}

/** A real, decodable 1×1 opaque PNG. */
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
])

/** SOI + APP0/JFIF + EOI: enough to sniff as JPEG. */
export const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
])

export const GIF_BYTES = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
])

export const WEBP_BYTES = (() => {
  const bytes = new Uint8Array(32)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  bytes.set([0x18, 0x00, 0x00, 0x00], 4) // size
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x20], 12) // VP8␠
  return bytes
})()

/** `wOF2` magic plus a stub body. Only the signature matters for content typing. */
export const WOFF2_BYTES = (() => {
  const bytes = new Uint8Array(48)
  bytes.set([0x77, 0x4f, 0x46, 0x32], 0)
  for (let i = 4; i < bytes.length; i++) bytes[i] = i & 0xff
  return bytes
})()

export const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>'
export const SVG_BYTES = new TextEncoder().encode(SVG_TEXT)

export const PNG_DATA_URL = dataUrl('image/png', PNG_BYTES)
export const JPEG_DATA_URL = dataUrl('image/jpeg', JPEG_BYTES)
export const GIF_DATA_URL = dataUrl('image/gif', GIF_BYTES)
export const WEBP_DATA_URL = dataUrl('image/webp', WEBP_BYTES)
export const SVG_DATA_URL = dataUrl('image/svg+xml', SVG_BYTES)
export const WOFF2_DATA_URL = dataUrl('font/woff2', WOFF2_BYTES)

// --- Building blocks ----------------------------------------------------------

const FORMAT_SQUARE = {
  id: 'ig-square',
  label: 'Instagram Square',
  platform: 'instagram' as const,
  width: 1080,
  height: 1080,
  aspectRatio: '1:1',
}

const FORMAT_STORY = {
  id: 'ig-story',
  label: 'Instagram Story',
  platform: 'instagram' as const,
  width: 1080,
  height: 1920,
  aspectRatio: '9:16',
}

const FORMAT_FEED = {
  id: 'li-feed',
  label: 'LinkedIn Feed',
  platform: 'linkedin' as const,
  width: 1200,
  height: 627,
  aspectRatio: '1.91:1',
}

const INK = { token: 'charcoal', hex: '#1c1c1e' }
const CLOUD = { token: 'cloud', hex: '#f5f5f7' }
const ACCENT = { token: 'ember', hex: '#ff6b35' }

/** Every optional field on `LayerBase`, all present. */
const RICH_BASE = {
  visible: true,
  locked: false,
  opacity: 0.87,
  rotation: -12.5,
  aspectRatioLocked: true,
  flipH: true,
  flipV: false,
  constraints: { horizontal: 'stretch' as const, vertical: 'bottom' as const, scale: 'fixed' as const },
  layoutGrow: true,
  shadow: { offsetX: 4, offsetY: -8, blur: 24, color: 'rgba(0,0,0,0.35)' },
  blur: 3.5,
}

/** No optional fields at all. */
const PLAIN_BASE = {
  visible: false,
  locked: true,
  opacity: 1,
  rotation: 0,
}

// --- Layers: every type, rich variant -----------------------------------------

const RICH_LAYERS = [
  {
    id: 'rich-background',
    type: 'background' as const,
    name: 'Shader background',
    ...RICH_BASE,
    x: 0,
    y: 0,
    width: 1080,
    height: 1080,
    zIndex: 0,
    fill: {
      type: 'shader' as const,
      kind: 'meshGradient' as const,
      colors: ['#ff6b35', '#1c1c1e', '#f5f5f7'],
      speed: 0.25,
      frame: 1250,
      intensity: 0.8,
      scale: 1.75,
      rotation: 42,
      grain: 0.15,
    },
  },
  {
    id: 'rich-text',
    type: 'text' as const,
    name: 'Headline',
    ...RICH_BASE,
    groupId: 'group-inner',
    x: 80,
    y: 120,
    width: 640,
    height: 180,
    zIndex: 1,
    content: 'Ship it — «quotes», emoji 🎯, and a\nnewline',
    fontSize: 72.5,
    fontWeight: 800 as const,
    textAlign: 'center' as const,
    color: INK,
    letterSpacing: -0.03,
    lineHeight: 1.05,
    textTransform: 'uppercase' as const,
    textWrap: 'balance' as const,
    textSizing: 'auto-height' as const,
    textRole: 'headline' as const,
    underline: true,
    strikethrough: false,
    verticalAlign: 'middle' as const,
    verticalTrim: 'standard' as const,
  },
  {
    id: 'rich-image',
    type: 'image' as const,
    name: 'Hero photo',
    ...RICH_BASE,
    groupId: 'group-outer',
    x: 40,
    y: 400,
    width: 500,
    height: 500,
    zIndex: 2,
    imageUrl: PNG_DATA_URL,
    fit: 'cover' as const,
    cropX: 0.1,
    cropY: 0.2,
    cropW: 0.75,
    cropH: 0.6,
    borderRadius: 32,
    avatarSet: true,
  },
  {
    id: 'rich-svg',
    type: 'svg' as const,
    name: 'Logo mark',
    ...RICH_BASE,
    x: 900,
    y: 40,
    width: 120,
    height: 120,
    zIndex: 3,
    svgContent: SVG_TEXT,
    tintColor: ACCENT,
    colorOverrides: { '#000000': INK, '#ffffff': CLOUD },
    strokeWidth: 1.5,
  },
  {
    id: 'rich-shape',
    type: 'shape' as const,
    name: 'Arrow',
    ...RICH_BASE,
    groupId: 'group-inner',
    x: 120,
    y: 900,
    width: 400,
    height: 8,
    zIndex: 4,
    shape: 'line' as const,
    fill: ACCENT,
    stroke: { color: INK, width: 3 },
    borderRadius: 4,
    lineCap: 'round' as const,
    arrowStart: true,
    arrowEnd: true,
    controlPointX: 0.35,
    controlPointY: 0.65,
  },
  {
    id: 'rich-gradient',
    type: 'gradient' as const,
    name: 'Gradient wash',
    ...RICH_BASE,
    x: 0,
    y: 700,
    width: 1080,
    height: 380,
    zIndex: 5,
    gradientType: 'conic' as const,
    angle: 135,
    stops: [
      { position: 0, oklchL: 0.12, oklchC: 0.02, oklchH: 260, alpha: 1 },
      { position: 0.5, oklchL: 0.68, oklchC: 0.19, oklchH: 32.5, alpha: 0.8 },
      { position: 1, oklchL: 0.97, oklchC: 0.004, oklchH: 250, alpha: 0 },
    ],
    grain: 0.42,
    borderRadius: 16,
  },
  {
    id: 'rich-group',
    type: 'group' as const,
    name: 'Legacy group container',
    ...RICH_BASE,
    x: 80,
    y: 120,
    width: 640,
    height: 800,
    zIndex: 6,
    childIds: ['rich-text', 'rich-shape'],
  },
  {
    id: 'rich-draw',
    type: 'draw' as const,
    name: 'Highlight stroke',
    ...RICH_BASE,
    x: 200,
    y: 200,
    width: 300,
    height: 150,
    zIndex: 7,
    points: [
      [0, 0],
      [12.5, 40.25],
      [80, 120],
      [150.75, 60],
    ] as [number, number][],
    color: ACCENT,
    strokeWidth: 12,
    natWidth: 300,
    natHeight: 150,
    mode: 'highlighter' as const,
    pressures: [0, 0.4, 0.95, 0.2],
    thinning: 0.6,
    taper: 0.25,
    streamline: 0.8,
  },
]

// --- Layers: every type, minimal variant --------------------------------------

const PLAIN_LAYERS = [
  {
    id: 'plain-background',
    type: 'background' as const,
    name: 'Background',
    ...PLAIN_BASE,
    x: 0,
    y: 0,
    width: 1080,
    height: 1920,
    zIndex: 0,
    fill: { type: 'image' as const, imageUrl: PNG_DATA_URL, fit: 'contain' as const },
  },
  {
    id: 'plain-text',
    type: 'text' as const,
    name: 'Body',
    ...PLAIN_BASE,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    zIndex: 1,
    content: '',
    fontSize: 16,
    fontWeight: 100 as const,
    textAlign: 'left' as const,
    color: CLOUD,
    letterSpacing: 0,
    lineHeight: 1,
    textTransform: 'none' as const,
  },
  {
    id: 'plain-image',
    type: 'image' as const,
    name: 'Image',
    ...PLAIN_BASE,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    zIndex: 2,
    imageUrl: '',
    fit: 'fill' as const,
    cropX: 0,
    cropY: 0,
    cropW: 1,
    cropH: 1,
    borderRadius: 0,
  },
  {
    id: 'plain-svg',
    type: 'svg' as const,
    name: 'Svg',
    ...PLAIN_BASE,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    zIndex: 3,
    svgContent: '',
  },
  {
    id: 'plain-shape',
    type: 'shape' as const,
    name: 'Shape',
    ...PLAIN_BASE,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    zIndex: 4,
    shape: 'star' as const,
    fill: INK,
    borderRadius: 0,
  },
  {
    id: 'plain-gradient',
    type: 'gradient' as const,
    name: 'Gradient',
    ...PLAIN_BASE,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    zIndex: 5,
    gradientType: 'mesh' as const,
    angle: 0,
    stops: [],
    grain: 0,
    borderRadius: 0,
  },
  {
    id: 'plain-group',
    type: 'group' as const,
    name: 'Group',
    ...PLAIN_BASE,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    zIndex: 6,
    childIds: [],
  },
  {
    id: 'plain-draw',
    type: 'draw' as const,
    name: 'Draw',
    ...PLAIN_BASE,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    zIndex: 7,
    points: [],
    color: INK,
    strokeWidth: 1,
    natWidth: 1,
    natHeight: 1,
  },
]

// --- Document -----------------------------------------------------------------

/**
 * Returned as a fresh deep copy each call so a test that mutates the fixture
 * cannot leak into the next test — the kind of cross-test coupling that makes a
 * determinism suite lie.
 */
export function makeFullCoverageDocument(): Record<string, unknown> {
  return structuredClone({
    schemaVersion: 1,
    id: 'doc-full-coverage',
    name: 'Full coverage — every persisted field',
    createdAt: '2026-01-02T03:04:05.678Z',
    updatedAt: '2026-02-03T04:05:06.789Z',
    pages: [
      {
        id: 'page-one',
        name: 'Campaign',
        frames: [
          {
            id: 'frame-rich',
            name: 'Rich frame',
            x: -240.5,
            y: 96,
            width: 1080,
            height: 1080,
            format: FORMAT_SQUARE,
            // The three fields the legacy DesignFile path dropped:
            backgroundColor: CLOUD,
            backgroundFill: {
              type: 'gradient' as const,
              gradientType: 'radial' as const,
              angle: 45,
              stops: [
                { position: 0, color: CLOUD },
                { position: 1, color: INK },
              ],
            },
            layers: RICH_LAYERS,
            autoLayouts: {
              'group-inner': {
                direction: 'vertical' as const,
                gap: 24,
                padding: { top: 16, right: 20, bottom: 16, left: 20 },
                primaryAlign: 'space-between' as const,
                counterAlign: 'stretch' as const,
                widthMode: 'hug' as const,
                heightMode: 'fixed' as const,
                x: 80,
                y: 120,
                width: 640,
                height: 800,
                parentGroupId: 'group-outer',
              },
              'group-outer': {
                direction: 'horizontal' as const,
                gap: 0,
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
                primaryAlign: 'start' as const,
                counterAlign: 'center' as const,
                widthMode: 'fixed' as const,
                heightMode: 'hug' as const,
                x: 0,
                y: 0,
                width: 1080,
                height: 1080,
              },
            },
            locked: true,
            visible: false,
          },
          {
            id: 'frame-plain',
            name: 'Plain frame',
            x: 1200,
            y: 0,
            width: 1080,
            height: 1920,
            format: FORMAT_STORY,
            backgroundColor: INK,
            backgroundFill: { type: 'solid' as const, color: INK },
            layers: PLAIN_LAYERS,
            locked: false,
            visible: true,
          },
        ],
        looseElements: [
          {
            id: 'loose-note',
            type: 'text' as const,
            name: 'Scratch note',
            visible: true,
            locked: false,
            opacity: 1,
            x: -800,
            y: -400,
            width: 300,
            height: 80,
            rotation: 0,
            zIndex: 0,
            content: 'Loose element outside any frame',
            fontSize: 24,
            fontWeight: 400 as const,
            textAlign: 'left' as const,
            color: INK,
            letterSpacing: 0,
            lineHeight: 1.4,
            textTransform: 'none' as const,
          },
          {
            id: 'loose-sketch',
            type: 'draw' as const,
            name: 'Scratch sketch',
            visible: true,
            locked: false,
            opacity: 0.5,
            x: -800,
            y: -200,
            width: 200,
            height: 200,
            rotation: 15,
            zIndex: 1,
            points: [
              [0, 0],
              [100, 100],
            ] as [number, number][],
            color: ACCENT,
            strokeWidth: 4,
            natWidth: 200,
            natHeight: 200,
            mode: 'pen' as const,
          },
        ],
      },
      {
        id: 'page-two',
        name: 'Variants',
        frames: [
          {
            id: 'frame-feed',
            name: 'LinkedIn variant',
            x: 0,
            y: 0,
            width: 1200,
            height: 627,
            format: FORMAT_FEED,
            backgroundColor: ACCENT,
            backgroundFill: { type: 'image' as const, imageUrl: SVG_DATA_URL, fit: 'fill' as const },
            layers: [],
            locked: false,
            visible: true,
          },
        ],
        looseElements: [],
      },
    ],
    activePageId: 'page-one',
    activeFrameId: 'frame-rich',
    settings: { showFrameLabels: false, snapFrames: true },
    versions: [
      {
        id: 'version-one',
        name: 'Before the rewrite',
        createdAt: '2026-01-15T10:00:00.000Z',
        document: {
          id: 'doc-full-coverage',
          name: 'Full coverage — every persisted field',
          format: FORMAT_SQUARE,
          // A version embeds a whole historical document, including its own assets.
          // This is the reference the key-driven walker must reach and a
          // shape-driven one would miss.
          layers: [
            {
              id: 'version-image',
              type: 'image' as const,
              name: 'Old hero',
              visible: true,
              locked: false,
              opacity: 1,
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              rotation: 0,
              zIndex: 0,
              imageUrl: JPEG_DATA_URL,
              fit: 'cover' as const,
              cropX: 0,
              cropY: 0,
              cropW: 1,
              cropH: 1,
              borderRadius: 0,
            },
          ],
          createdAt: '2026-01-02T03:04:05.678Z',
          updatedAt: '2026-01-15T09:59:59.000Z',
          autoLayouts: {},
        },
      },
    ],
    brand: {
      productName: 'Tela',
      socialHandle: 'tela',
      displayName: 'Tela',
      website: 'tela.design',
      ai: {
        productDescription: 'A local-first design canvas for social and ad creatives.',
        targetAudience: 'Designers, marketers, and founders who ship creatives fast.',
        brandVoice: 'Clear, confident, and human — no jargon.',
        callToAction: 'Start designing',
      },
      palette: { charcoal: '#1c1c1e', cloud: '#f5f5f7', ember: '#ff6b35' },
    },
    assets: [
      {
        id: 'asset-png',
        name: 'Hero photo',
        type: 'image' as const,
        category: 'photos',
        // Same payload as `rich-image`, so the bundle must store it exactly once.
        ref: PNG_DATA_URL,
        width: 1,
        height: 1,
        createdAt: '2026-01-02T03:04:05.678Z',
      },
      {
        id: 'asset-svg',
        name: 'Logo mark',
        type: 'svg' as const,
        category: 'logos',
        ref: SVG_DATA_URL,
        createdAt: '2026-01-02T03:04:05.678Z',
      },
      {
        id: 'asset-gif',
        name: 'Loader',
        type: 'icon' as const,
        category: 'icons',
        ref: GIF_DATA_URL,
        width: 1,
        height: 1,
        createdAt: '2026-01-03T00:00:00.000Z',
      },
      {
        id: 'asset-webp',
        name: 'Texture',
        type: 'image' as const,
        category: 'graphics',
        ref: WEBP_DATA_URL,
        createdAt: '2026-01-04T00:00:00.000Z',
      },
    ],
    fonts: [
      {
        id: 'font-display',
        family: 'Clickt Display',
        weight: 700,
        style: 'normal' as const,
        license: 'Commercial desktop + web licence, seat 4211, expires 2030-01-01',
        ref: WOFF2_DATA_URL,
        createdAt: '2026-01-05T00:00:00.000Z',
      },
    ],
  })
}
