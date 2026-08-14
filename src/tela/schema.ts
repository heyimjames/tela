/**
 * The `.tela` portable document schema, v1.
 *
 * Every object here is a `strictObject`. That is the load-bearing choice in this
 * file: a permissive schema would *silently strip* fields it does not know about,
 * which is precisely the lossy behaviour this format exists to eliminate. If a
 * future layer property is added to `src/types` and not added here, import fails
 * loudly instead of quietly deleting the user's work.
 */

import { z } from 'zod'

// --- Primitives ---------------------------------------------------------------

/**
 * Coordinates and sizes must be finite. `NaN` reaches the stores easily (a parse
 * of an empty numeric input, a division by a zero-width frame) and would otherwise
 * be written as `null` by a naive serializer and read back as a broken document.
 */
const num = z.number().finite()
const int = z.number().int()

/** Strict ISO-8601 UTC, so timestamps never depend on the host's timezone or locale. */
const isoTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
    'must be an ISO-8601 UTC timestamp (e.g. 2026-01-01T00:00:00.000Z)',
  )

/** Non-empty identifier. Ids index the document; an empty one is a latent collision. */
const id = z.string().min(1).max(128)

/**
 * A content-addressed reference.
 *
 * Two forms are accepted here, and the distinction matters:
 *
 * - `asset://<sha256>` — the **portable** form, the only one a written bundle may
 *   contain. `assertPortableReferences` in `bundle.ts` enforces that on both the
 *   write and the read path.
 * - `data:...` — the **session** form, which is how the running editor holds a
 *   payload before packing and after unpacking.
 *
 * The schema accepts both so that one document type serves the file and the live
 * session; it does not weaken the file contract, which is enforced separately and
 * unconditionally. Anything else — `blob:`, `file:`, `http(s):` — is refused here,
 * at the schema, in addition to being refused by the packer.
 */
export const ASSET_REF_PATTERN = /^asset:\/\/[0-9a-f]{64}$/
const DATA_REF_PATTERN = /^data:[a-z]+\/[a-z0-9.+-]+[;,]/i
const assetRef = z
  .string()
  .refine(
    (value) => value === '' || ASSET_REF_PATTERN.test(value) || DATA_REF_PATTERN.test(value),
    'must be empty, asset://<sha256>, or a data: URL',
  )
const requiredAssetRef = z
  .string()
  .refine(
    (value) => ASSET_REF_PATTERN.test(value) || DATA_REF_PATTERN.test(value),
    'must be asset://<sha256> or a data: URL',
  )

const brandColor = z.strictObject({
  token: z.string(),
  hex: z.string(),
})

const adFormat = z.strictObject({
  id: z.string(),
  label: z.string(),
  platform: z.enum(['linkedin', 'instagram', 'facebook', 'generic']),
  width: num.positive(),
  height: num.positive(),
  aspectRatio: z.string(),
})

// --- Fills --------------------------------------------------------------------

const solidFill = z.strictObject({ type: z.literal('solid'), color: brandColor })

const gradientFill = z.strictObject({
  type: z.literal('gradient'),
  gradientType: z.enum(['linear', 'radial']),
  angle: num,
  stops: z.array(z.strictObject({ position: num, color: brandColor })),
})

const imageFill = z.strictObject({
  type: z.literal('image'),
  imageUrl: assetRef,
  fit: z.enum(['cover', 'contain', 'fill']),
})

const shaderFill = z.strictObject({
  type: z.literal('shader'),
  kind: z.enum(['meshGradient', 'warp', 'grainGradient', 'swirl', 'dithering', 'waves']),
  colors: z.array(z.string()),
  speed: num,
  frame: num,
  intensity: num,
  scale: num,
  rotation: num,
  grain: num,
})

const backgroundFill = z.discriminatedUnion('type', [solidFill, gradientFill, imageFill, shaderFill])

// --- Layers -------------------------------------------------------------------

const layerConstraints = z.strictObject({
  horizontal: z.enum(['left', 'center', 'right', 'stretch']),
  vertical: z.enum(['top', 'center', 'bottom', 'stretch']),
  scale: z.enum(['proportional', 'fixed', 'stretch']),
})

const dropShadow = z.strictObject({
  offsetX: num,
  offsetY: num,
  blur: num,
  color: z.string(),
})

/**
 * Shared across every layer variant. Kept as a raw shape (not a `z.object`) so each
 * variant can spread it into its own `strictObject` — `.extend()` on a strict object
 * is easy to get subtly wrong about which keys stay strict.
 */
const layerBaseShape = {
  id,
  name: z.string(),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: num,
  x: num,
  y: num,
  width: num,
  height: num,
  rotation: num,
  zIndex: int,
  aspectRatioLocked: z.boolean().optional(),
  flipH: z.boolean().optional(),
  flipV: z.boolean().optional(),
  constraints: layerConstraints.optional(),
  groupId: id.optional(),
  layoutGrow: z.boolean().optional(),
  shadow: dropShadow.optional(),
  blur: num.optional(),
}

const backgroundLayer = z.strictObject({
  ...layerBaseShape,
  type: z.literal('background'),
  fill: backgroundFill,
})

const textLayer = z.strictObject({
  ...layerBaseShape,
  type: z.literal('text'),
  content: z.string(),
  fontSize: num,
  fontWeight: z.union([
    z.literal(100), z.literal(200), z.literal(300), z.literal(400), z.literal(500),
    z.literal(600), z.literal(700), z.literal(800), z.literal(900),
  ]),
  textAlign: z.enum(['left', 'center', 'right']),
  color: brandColor,
  letterSpacing: num,
  lineHeight: num,
  textTransform: z.enum(['none', 'uppercase', 'lowercase']),
  textWrap: z.enum(['normal', 'balance', 'pretty']).optional(),
  textSizing: z.enum(['fixed', 'auto-width', 'auto-height']).optional(),
  textRole: z.enum(['none', 'headline', 'subheadline', 'body', 'cta', 'tagline', 'job-title', 'company']).optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  verticalTrim: z.enum(['standard', 'cap']).optional(),
})

const imageLayer = z.strictObject({
  ...layerBaseShape,
  type: z.literal('image'),
  imageUrl: assetRef,
  fit: z.enum(['cover', 'contain', 'fill']),
  cropX: num,
  cropY: num,
  cropW: num,
  cropH: num,
  borderRadius: num,
  avatarSet: z.boolean().optional(),
})

const svgLayer = z.strictObject({
  ...layerBaseShape,
  type: z.literal('svg'),
  svgContent: z.string(),
  tintColor: brandColor.optional(),
  colorOverrides: z.record(z.string(), brandColor).optional(),
  strokeWidth: num.optional(),
})

const shapeLayer = z.strictObject({
  ...layerBaseShape,
  type: z.literal('shape'),
  shape: z.enum(['rectangle', 'ellipse', 'line', 'pill', 'triangle', 'star']),
  fill: brandColor,
  stroke: z.strictObject({ color: brandColor, width: num }).optional(),
  borderRadius: num,
  lineCap: z.enum(['butt', 'round', 'square']).optional(),
  arrowStart: z.boolean().optional(),
  arrowEnd: z.boolean().optional(),
  controlPointX: num.optional(),
  controlPointY: num.optional(),
})

const gradientLayer = z.strictObject({
  ...layerBaseShape,
  type: z.literal('gradient'),
  gradientType: z.enum(['linear', 'radial', 'conic', 'mesh']),
  angle: num,
  stops: z.array(
    z.strictObject({ position: num, oklchL: num, oklchC: num, oklchH: num, alpha: num }),
  ),
  grain: num,
  borderRadius: num,
})

const groupLayer = z.strictObject({
  ...layerBaseShape,
  type: z.literal('group'),
  childIds: z.array(id),
})

const drawLayer = z.strictObject({
  ...layerBaseShape,
  type: z.literal('draw'),
  points: z.array(z.tuple([num, num])),
  color: brandColor,
  strokeWidth: num,
  natWidth: num,
  natHeight: num,
  mode: z.enum(['pen', 'highlighter']).optional(),
  pressures: z.array(num).optional(),
  thinning: num.optional(),
  taper: num.optional(),
  streamline: num.optional(),
})

export const layerSchema = z.discriminatedUnion('type', [
  backgroundLayer,
  textLayer,
  imageLayer,
  svgLayer,
  shapeLayer,
  gradientLayer,
  groupLayer,
  drawLayer,
])

// --- Auto layout --------------------------------------------------------------

const autoLayoutConfig = z.strictObject({
  direction: z.enum(['horizontal', 'vertical']),
  gap: num,
  padding: z.strictObject({ top: num, right: num, bottom: num, left: num }),
  primaryAlign: z.enum(['start', 'center', 'end', 'space-between']),
  counterAlign: z.enum(['start', 'center', 'end', 'stretch']),
  widthMode: z.enum(['fixed', 'hug']),
  heightMode: z.enum(['fixed', 'hug']),
  x: num,
  y: num,
  width: num,
  height: num,
  parentGroupId: id.optional(),
})

const autoLayouts = z.record(id, autoLayoutConfig)

// --- Frames, pages ------------------------------------------------------------

/**
 * The full `Frame`, including the three fields the legacy `DesignFile` path dropped:
 * `backgroundColor`, `locked`, and `visible`.
 */
const frame = z.strictObject({
  id,
  name: z.string(),
  x: num,
  y: num,
  width: num.positive(),
  height: num.positive(),
  format: adFormat,
  backgroundColor: brandColor,
  backgroundFill,
  layers: z.array(layerSchema),
  autoLayouts: autoLayouts.optional(),
  locked: z.boolean(),
  visible: z.boolean(),
})

const page = z.strictObject({
  id,
  name: z.string(),
  frames: z.array(frame),
  /** Scratchpad items outside any frame. The legacy path had nowhere to put these. */
  looseElements: z.array(layerSchema),
})

// --- Versions, brand, assets, fonts -------------------------------------------

const designDocument = z.strictObject({
  id,
  name: z.string(),
  format: adFormat,
  layers: z.array(layerSchema),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  autoLayouts: autoLayouts.optional(),
})

const savedVersion = z.strictObject({
  id,
  name: z.string(),
  document: designDocument,
  createdAt: isoTimestamp,
})

const brandContext = z.strictObject({
  productName: z.string(),
  socialHandle: z.string(),
  displayName: z.string(),
  website: z.string(),
  ai: z.strictObject({
    productDescription: z.string(),
    targetAudience: z.string(),
    brandVoice: z.string(),
    callToAction: z.string(),
  }),
  /** Palette overrides keyed by token, so a customized palette survives the round trip. */
  palette: z.record(z.string(), z.string()),
})

const assetRecord = z.strictObject({
  id,
  name: z.string(),
  type: z.enum(['image', 'svg', 'icon']),
  category: z.string(),
  ref: assetRef,
  width: num.optional(),
  height: num.optional(),
  createdAt: isoTimestamp,
})

/**
 * Fonts are only ever *explicitly imported licensed WOFF2*. The `license` field is
 * required and non-empty on purpose: an unlabelled font file in a portable bundle is
 * a redistribution problem, not just a missing metadata field.
 */
const fontRecord = z.strictObject({
  id,
  family: z.string().min(1),
  weight: int.min(1).max(1000),
  style: z.enum(['normal', 'italic']),
  license: z.string().min(1),
  ref: requiredAssetRef,
  createdAt: isoTimestamp,
})

// --- Document -----------------------------------------------------------------

export const CURRENT_DOCUMENT_SCHEMA_VERSION = 1

export const telaDocumentSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_DOCUMENT_SCHEMA_VERSION),
  id,
  name: z.string(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  pages: z.array(page).min(1),
  activePageId: id,
  activeFrameId: z.union([id, z.null()]),
  settings: z.strictObject({
    showFrameLabels: z.boolean(),
    snapFrames: z.boolean(),
  }),
  versions: z.array(savedVersion),
  brand: brandContext,
  assets: z.array(assetRecord),
  fonts: z.array(fontRecord),
})

export type TelaDocument = z.infer<typeof telaDocumentSchema>
export type TelaPage = z.infer<typeof page>
export type TelaFrame = z.infer<typeof frame>
export type TelaLayer = z.infer<typeof layerSchema>
export type TelaAssetRecord = z.infer<typeof assetRecord>
export type TelaFontRecord = z.infer<typeof fontRecord>
export type TelaBrandContext = z.infer<typeof brandContext>
export type TelaSavedVersion = z.infer<typeof savedVersion>

// --- Manifest -----------------------------------------------------------------

export const CURRENT_BUNDLE_SCHEMA_VERSION = 1
export const BUNDLE_SCHEMA_ID = 'https://schemas.clickt.ca/tela/bundle/v1'
export const DOCUMENT_SCHEMA_ID = 'https://schemas.clickt.ca/tela/document/v1'

export const SUPPORTED_ASSET_MIME = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'font/woff2',
] as const

export type SupportedAssetMime = (typeof SUPPORTED_ASSET_MIME)[number]

const manifestAssetEntry = z.strictObject({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: int.nonnegative(),
  mime: z.enum(SUPPORTED_ASSET_MIME),
  ext: z.string().regex(/^[a-z0-9]{1,8}$/),
})

/**
 * Note what is *absent*: there is no save time anywhere in the manifest. A
 * save-time stamp would make every save produce different bytes for identical
 * content, which would defeat the whole byte-determinism contract.
 */
export const telaManifestSchema = z.strictObject({
  format: z.literal('tela-bundle'),
  schema: z.literal(BUNDLE_SCHEMA_ID),
  schemaVersion: z.literal(CURRENT_BUNDLE_SCHEMA_VERSION),
  documentSchema: z.literal(DOCUMENT_SCHEMA_ID),
  documentSchemaVersion: int.positive(),
  producer: z.strictObject({
    name: z.string().min(1),
    version: z.string().min(1),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  document: z.strictObject({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: int.nonnegative(),
  }),
  /** Ascending by `sha256`; enforced by the reader, not merely produced by the writer. */
  assets: z.array(manifestAssetEntry),
  limits: z.strictObject({
    maxArchiveBytes: int.positive(),
    maxEntryBytes: int.positive(),
    maxTotalEntryBytes: int.positive(),
    maxEntries: int.positive(),
    maxNameBytes: int.positive(),
  }),
  migration: z.strictObject({
    /** The schema version the document was authored at, before any migration ran. */
    originalDocumentSchemaVersion: int.positive(),
    /** Ordered ids of the migrations applied to reach the current version. */
    applied: z.array(z.string()),
  }),
  /** Semantic revision: creative content only. See `contentRevision.ts`. */
  contentRevision: z.string().regex(/^[0-9a-f]{64}$/),
})

export type TelaManifest = z.infer<typeof telaManifestSchema>
