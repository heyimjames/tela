/**
 * Layer authoring input.
 *
 * The persisted schema in `src/tela/schema.ts` is `strictObject` everywhere and
 * requires every field — that is what makes the file format lossless. It is a
 * poor *authoring* interface for the same reason: nobody should have to supply
 * `letterSpacing` to put a headline on a frame.
 *
 * So this module is the adapter. The input schemas are permissive-with-defaults
 * and cover all eight persisted layer types — background, text, image, svg,
 * shape, gradient, group, draw — and `buildLayer` widens each one into a fully
 * populated persisted layer. Nothing here reads editor selection state: a layer
 * is addressed by frame id and layer id, never by "the current selection", so
 * an agent driving this surface never depends on invisible UI state.
 */

import { z } from 'zod'

import type { TelaLayer } from '../tela/schema'
import { toolError } from './errors'

const finite = z.number().finite()

/**
 * A colour. `hex` is required; `token` is the brand token it came from and
 * defaults to `custom`, which is how the editor marks a colour that is not
 * bound to the palette.
 */
export const colorSchema = z
  .strictObject({
    hex: z
      .string()
      .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'must be a hex colour such as #1a1a1a')
      .describe('Hex colour, e.g. "#1a1a1a".'),
    token: z.string().default('custom').describe('Brand palette token this colour came from, or "custom".'),
  })
  .describe('A colour: hex value plus the brand token it is bound to.')

export type ColorInput = z.infer<typeof colorSchema>

const constraintsSchema = z
  .strictObject({
    horizontal: z.enum(['left', 'center', 'right', 'stretch']).default('left'),
    vertical: z.enum(['top', 'center', 'bottom', 'stretch']).default('top'),
    scale: z.enum(['proportional', 'fixed', 'stretch']).default('fixed'),
  })
  .describe('How the layer reflows when the frame changes format.')

const shadowSchema = z.strictObject({
  offsetX: finite,
  offsetY: finite,
  blur: finite.nonnegative(),
  color: z.string().describe('CSS colour string for the shadow.'),
})

/** Fields every layer accepts. Geometry has defaults so a caller can add a layer with almost nothing. */
const commonShape = {
  id: z.string().min(1).max(128).optional().describe('Explicit layer id. Omit to have one generated.'),
  name: z.string().max(200).optional().describe('Display name. Defaults to the layer type.'),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  opacity: finite.min(0).max(1).default(1),
  x: finite.default(0),
  y: finite.default(0),
  width: finite.default(200),
  height: finite.default(200),
  rotation: finite.default(0),
  zIndex: z.int().optional().describe('Stacking order. Omit to append on top.'),
  aspectRatioLocked: z.boolean().optional(),
  flipH: z.boolean().optional(),
  flipV: z.boolean().optional(),
  constraints: constraintsSchema.optional(),
  groupId: z.string().min(1).max(128).optional().describe('Id of the group layer this layer belongs to.'),
  layoutGrow: z.boolean().optional(),
  shadow: shadowSchema.optional(),
  blur: finite.nonnegative().optional(),
}

const gradientStopSchema = z.strictObject({
  position: finite.min(0).max(1),
  color: colorSchema,
})

const backgroundFillSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('solid'), color: colorSchema }),
    z.strictObject({
      type: z.literal('gradient'),
      gradientType: z.enum(['linear', 'radial']).default('linear'),
      angle: finite.default(0),
      stops: z.array(gradientStopSchema).min(2),
    }),
    z.strictObject({
      type: z.literal('image'),
      imageUrl: z.string().describe('An asset://<sha256> reference. Import the file with tela_import_asset first.'),
      fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
    }),
    z.strictObject({
      type: z.literal('shader'),
      kind: z.enum(['meshGradient', 'warp', 'grainGradient', 'swirl', 'dithering', 'waves']),
      colors: z.array(z.string()).min(1),
      speed: finite.default(0),
      frame: finite.default(0),
      intensity: finite.default(0.5),
      scale: finite.default(1),
      rotation: finite.default(0),
      grain: finite.default(0),
    }),
  ])
  .describe('Background fill: solid, gradient, image, or animated shader.')

const backgroundInput = z.strictObject({ ...commonShape, type: z.literal('background'), fill: backgroundFillSchema })

const textInput = z.strictObject({
  ...commonShape,
  type: z.literal('text'),
  content: z.string().describe('The text itself.'),
  fontSize: finite.positive().default(32),
  fontWeight: z.union([
    z.literal(100), z.literal(200), z.literal(300), z.literal(400), z.literal(500),
    z.literal(600), z.literal(700), z.literal(800), z.literal(900),
  ]).default(400),
  textAlign: z.enum(['left', 'center', 'right']).default('left'),
  color: colorSchema.default({ hex: '#1a1a1a', token: 'custom' }),
  letterSpacing: finite.default(0),
  lineHeight: finite.positive().default(1.2),
  textTransform: z.enum(['none', 'uppercase', 'lowercase']).default('none'),
  textWrap: z.enum(['normal', 'balance', 'pretty']).optional(),
  textSizing: z.enum(['fixed', 'auto-width', 'auto-height']).optional(),
  textRole: z.enum(['none', 'headline', 'subheadline', 'body', 'cta', 'tagline', 'job-title', 'company']).optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  verticalTrim: z.enum(['standard', 'cap']).optional(),
})

const imageInput = z.strictObject({
  ...commonShape,
  type: z.literal('image'),
  imageUrl: z.string().describe('An asset://<sha256> reference from tela_import_asset.'),
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
  cropX: finite.default(0),
  cropY: finite.default(0),
  cropW: finite.default(1),
  cropH: finite.default(1),
  borderRadius: finite.nonnegative().default(0),
  avatarSet: z.boolean().optional(),
})

const svgInput = z.strictObject({
  ...commonShape,
  type: z.literal('svg'),
  svgContent: z.string().describe('Inline SVG markup. Sanitized on the way in; scripts, event handlers, and external references are refused.'),
  tintColor: colorSchema.optional(),
  colorOverrides: z.record(z.string(), colorSchema).optional(),
  strokeWidth: finite.nonnegative().optional(),
})

const shapeInput = z.strictObject({
  ...commonShape,
  type: z.literal('shape'),
  shape: z.enum(['rectangle', 'ellipse', 'line', 'pill', 'triangle', 'star']).default('rectangle'),
  fill: colorSchema.default({ hex: '#1a1a1a', token: 'custom' }),
  stroke: z.strictObject({ color: colorSchema, width: finite.nonnegative() }).optional(),
  borderRadius: finite.nonnegative().default(0),
  lineCap: z.enum(['butt', 'round', 'square']).optional(),
  arrowStart: z.boolean().optional(),
  arrowEnd: z.boolean().optional(),
  controlPointX: finite.optional(),
  controlPointY: finite.optional(),
})

const gradientInput = z.strictObject({
  ...commonShape,
  type: z.literal('gradient'),
  gradientType: z.enum(['linear', 'radial', 'conic', 'mesh']).default('linear'),
  angle: finite.default(0),
  stops: z
    .array(
      z.strictObject({
        position: finite.min(0).max(1),
        oklchL: finite.describe('OKLCH lightness, 0-1.'),
        oklchC: finite.describe('OKLCH chroma.'),
        oklchH: finite.describe('OKLCH hue in degrees.'),
        alpha: finite.min(0).max(1).default(1),
      }),
    )
    .min(2),
  grain: finite.min(0).max(1).default(0),
  borderRadius: finite.nonnegative().default(0),
})

const groupInput = z.strictObject({
  ...commonShape,
  type: z.literal('group'),
  childIds: z.array(z.string().min(1)).default([]).describe('Ids of the layers this group contains.'),
})

const drawInput = z.strictObject({
  ...commonShape,
  type: z.literal('draw'),
  points: z.array(z.tuple([finite, finite])).min(1).describe('Stroke points in the drawing\'s natural coordinate space.'),
  color: colorSchema.default({ hex: '#1a1a1a', token: 'custom' }),
  strokeWidth: finite.positive().default(4),
  natWidth: finite.positive().describe('Natural width of the drawing\'s coordinate space.'),
  natHeight: finite.positive().describe('Natural height of the drawing\'s coordinate space.'),
  mode: z.enum(['pen', 'highlighter']).optional(),
  pressures: z.array(finite).optional(),
  thinning: finite.optional(),
  taper: finite.optional(),
  streamline: finite.optional(),
})

export const layerInputSchema = z
  .discriminatedUnion('type', [backgroundInput, textInput, imageInput, svgInput, shapeInput, gradientInput, groupInput, drawInput])
  .describe('A layer to create. The eight types match the persisted format exactly: background, text, image, svg, shape, gradient, group, draw.')

export type LayerInput = z.infer<typeof layerInputSchema>

/**
 * A partial update. Deliberately loose (`z.record`) rather than a partial of the
 * union: the persisted union is discriminated on `type`, and a *patch* has no
 * type to discriminate on. Validity is enforced where it actually matters —
 * `applyLayerPatch` re-parses the merged layer against the strict persisted
 * schema, so a patch that would produce an invalid layer is refused with the
 * strict schema's own message rather than a weaker approximation here.
 */
export const layerPatchSchema = z
  .record(z.string(), z.unknown())
  .describe('Fields to merge onto the layer. The merged result is re-validated against the strict persisted schema; "type" cannot be changed.')

const DEFAULT_NAMES: Record<LayerInput['type'], string> = {
  background: 'Background',
  text: 'Text',
  image: 'Image',
  svg: 'Vector',
  shape: 'Shape',
  gradient: 'Gradient',
  group: 'Group',
  draw: 'Drawing',
}

/**
 * Widen an authoring input into a fully populated persisted layer.
 *
 * `zIndex` is resolved by the caller (it depends on what is already in the
 * frame), and `id` is generated when absent. Optional persisted fields are only
 * emitted when the caller supplied them: writing `undefined` into the object
 * would survive `JSON.stringify` as an absent key but would *not* survive the
 * strict schema's `exactOptionalPropertyTypes`-shaped expectations consistently
 * across the round trip, so absence is represented by absence.
 */
export function buildLayer(input: LayerInput, id: string, zIndex: number): TelaLayer {
  const optional: Record<string, unknown> = {}
  const carry = <K extends keyof LayerInput>(key: K) => {
    const value = (input as Record<string, unknown>)[key as string]
    if (value !== undefined) optional[key as string] = value
  }
  carry('aspectRatioLocked')
  carry('flipH')
  carry('flipV')
  carry('constraints')
  carry('groupId')
  carry('layoutGrow')
  carry('shadow')
  carry('blur')

  const base = {
    id,
    name: input.name ?? DEFAULT_NAMES[input.type],
    visible: input.visible,
    locked: input.locked,
    opacity: input.opacity,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    rotation: input.rotation,
    zIndex,
    ...optional,
  }

  switch (input.type) {
    case 'background':
      return { ...base, type: 'background', fill: input.fill } as TelaLayer
    case 'text':
      return {
        ...base,
        type: 'text',
        content: input.content,
        fontSize: input.fontSize,
        fontWeight: input.fontWeight,
        textAlign: input.textAlign,
        color: input.color,
        letterSpacing: input.letterSpacing,
        lineHeight: input.lineHeight,
        textTransform: input.textTransform,
        ...pick(input, ['textWrap', 'textSizing', 'textRole', 'underline', 'strikethrough', 'verticalAlign', 'verticalTrim']),
      } as TelaLayer
    case 'image':
      return {
        ...base,
        type: 'image',
        imageUrl: input.imageUrl,
        fit: input.fit,
        cropX: input.cropX,
        cropY: input.cropY,
        cropW: input.cropW,
        cropH: input.cropH,
        borderRadius: input.borderRadius,
        ...pick(input, ['avatarSet']),
      } as TelaLayer
    case 'svg':
      return {
        ...base,
        type: 'svg',
        svgContent: input.svgContent,
        ...pick(input, ['tintColor', 'colorOverrides', 'strokeWidth']),
      } as TelaLayer
    case 'shape':
      return {
        ...base,
        type: 'shape',
        shape: input.shape,
        fill: input.fill,
        borderRadius: input.borderRadius,
        ...pick(input, ['stroke', 'lineCap', 'arrowStart', 'arrowEnd', 'controlPointX', 'controlPointY']),
      } as TelaLayer
    case 'gradient':
      return {
        ...base,
        type: 'gradient',
        gradientType: input.gradientType,
        angle: input.angle,
        stops: input.stops,
        grain: input.grain,
        borderRadius: input.borderRadius,
      } as TelaLayer
    case 'group':
      return { ...base, type: 'group', childIds: input.childIds } as TelaLayer
    case 'draw':
      return {
        ...base,
        type: 'draw',
        points: input.points,
        color: input.color,
        strokeWidth: input.strokeWidth,
        natWidth: input.natWidth,
        natHeight: input.natHeight,
        ...pick(input, ['mode', 'pressures', 'thinning', 'taper', 'streamline']),
      } as TelaLayer
    default: {
      // Exhaustiveness: adding a ninth persisted layer type without extending
      // this switch is a compile error, not a silent runtime hole.
      const unreachable: never = input
      throw toolError('unsupported', `unsupported layer type: ${JSON.stringify(unreachable)}`, 'use one of: background, text, image, svg, shape, gradient, group, draw')
    }
  }
}

function pick<T extends object, K extends keyof T>(source: T, keys: K[]): Partial<T> {
  const out: Partial<T> = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}
