/**
 * An ABES-representative campaign fixture.
 *
 * "ABES-representative" means: an employer-brand recruitment ad of the shape
 * that campaign actually produces — a dark branded background, a large headline,
 * a supporting role line, a pill CTA, a logo mark, a photographic panel, an
 * accent gradient, a hand-drawn underline, and a grouped, auto-laid-out footer
 * lockup — rendered across a feed format and a story variant.
 *
 * It is written from scratch here. The `origin/john/abes-template-renderer-parity`
 * branch is unlanded and none of its code is copied; this fixture only has to be
 * *representative of the same kind of artwork*, which is what the acceptance
 * criterion needs it for.
 *
 * Between them, `abesLayers` and `everyLayerType` cover all eight persisted layer
 * types, which is the other thing this file exists to guarantee.
 */

/** A 1×1 transparent PNG. Real bytes, so MIME sniffing and hashing behave as they would for artwork. */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** A minimal, sanitizer-clean SVG mark. */
export const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="#ffffff"/></svg>'

const INK = { hex: '#101820', token: 'brand-dark' }
const PAPER = { hex: '#ffffff', token: 'white' }
const EMBER = { hex: '#ff5a1f', token: 'ember-500' }

export interface LayerSpec {
  [key: string]: unknown
  type: string
}

/**
 * The campaign artwork, in stacking order.
 *
 * `assetRef` is threaded in rather than hard-coded because the image and SVG
 * layers must point at assets the test actually imported — a layer referencing
 * a hash that is not in the bundle fails the document's own invariants, which is
 * correct behaviour and not what these tests are trying to exercise.
 */
export function abesLayers(assetRef: string): LayerSpec[] {
  return [
    {
      type: 'background',
      name: 'Brand field',
      x: 0,
      y: 0,
      width: 1200,
      height: 627,
      fill: {
        type: 'gradient',
        gradientType: 'linear',
        angle: 135,
        stops: [
          { position: 0, color: INK },
          { position: 1, color: { hex: '#1d2b3a', token: 'brand-deep' } },
        ],
      },
    },
    {
      type: 'gradient',
      name: 'Accent wash',
      x: 720,
      y: 0,
      width: 480,
      height: 627,
      opacity: 0.55,
      gradientType: 'radial',
      angle: 0,
      grain: 0.12,
      borderRadius: 0,
      stops: [
        { position: 0, oklchL: 0.72, oklchC: 0.19, oklchH: 41, alpha: 0.9 },
        { position: 1, oklchL: 0.2, oklchC: 0.03, oklchH: 250, alpha: 0 },
      ],
    },
    {
      type: 'image',
      name: 'Team photo',
      x: 760,
      y: 90,
      width: 380,
      height: 447,
      imageUrl: assetRef,
      fit: 'cover',
      cropX: 0,
      cropY: 0,
      cropW: 1,
      cropH: 1,
      borderRadius: 24,
    },
    {
      type: 'text',
      name: 'Headline',
      x: 80,
      y: 150,
      width: 620,
      height: 150,
      content: "We're hiring builders",
      fontSize: 64,
      fontWeight: 700,
      textAlign: 'left',
      color: PAPER,
      letterSpacing: -0.03,
      lineHeight: 1.1,
      textTransform: 'none',
      textRole: 'headline',
    },
    {
      type: 'text',
      name: 'Role',
      x: 80,
      y: 310,
      width: 620,
      height: 48,
      content: 'Senior Platform Engineer — Remote (CA)',
      fontSize: 28,
      fontWeight: 400,
      textAlign: 'left',
      color: { hex: '#c8d2dc', token: 'slate-200' },
      letterSpacing: 0,
      lineHeight: 1.3,
      textTransform: 'none',
      textRole: 'subheadline',
    },
    {
      type: 'draw',
      name: 'Hand underline',
      x: 80,
      y: 268,
      width: 340,
      height: 18,
      points: [
        [0, 12],
        [60, 6],
        [140, 14],
        [230, 4],
        [320, 10],
      ],
      color: EMBER,
      strokeWidth: 6,
      natWidth: 340,
      natHeight: 18,
      mode: 'pen',
      thinning: 0.4,
      streamline: 0.5,
    },
    {
      type: 'shape',
      name: 'CTA pill',
      x: 80,
      y: 430,
      width: 240,
      height: 56,
      shape: 'pill',
      fill: EMBER,
      borderRadius: 9999,
    },
    {
      type: 'text',
      name: 'CTA label',
      x: 104,
      y: 446,
      width: 200,
      height: 24,
      content: 'Apply now',
      fontSize: 18,
      fontWeight: 600,
      textAlign: 'left',
      color: PAPER,
      letterSpacing: 0.02,
      lineHeight: 1.4,
      textTransform: 'uppercase',
      textRole: 'cta',
    },
    {
      type: 'svg',
      name: 'Logo mark',
      x: 80,
      y: 60,
      width: 44,
      height: 44,
      svgContent: CLEAN_SVG,
      tintColor: PAPER,
    },
    {
      type: 'text',
      name: 'Wordmark',
      x: 136,
      y: 70,
      width: 240,
      height: 26,
      content: 'ABES',
      fontSize: 22,
      fontWeight: 600,
      textAlign: 'left',
      color: PAPER,
      letterSpacing: 0.14,
      lineHeight: 1.2,
      textTransform: 'uppercase',
      textRole: 'company',
    },
  ]
}

/**
 * Layer specs covering every persisted type, including the two the campaign
 * artwork above does not naturally use as standalone layers.
 *
 * The `group` layer is created through `tela_group_layers` rather than declared
 * here: a group whose `childIds` name layers that do not exist yet would fail
 * validation, and constructing one by hand would test a state the authoring
 * surface cannot produce.
 */
export const ALL_LAYER_TYPES = ['background', 'text', 'image', 'svg', 'shape', 'gradient', 'group', 'draw'] as const
