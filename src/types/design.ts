export type LayerId = string

export type Platform = 'linkedin' | 'instagram' | 'facebook' | 'generic'

export interface AdFormat {
  id: string
  label: string
  platform: Platform
  width: number
  height: number
  aspectRatio: string
}

// --- Brand color reference ---

export interface BrandColor {
  token: string
  hex: string
}

// --- Layer system ---

export type LayerType = 'background' | 'text' | 'image' | 'svg' | 'shape' | 'gradient' | 'group' | 'draw'

export interface LayerBase {
  id: LayerId
  type: LayerType
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  aspectRatioLocked?: boolean
  // Mirror the layer's content within its box. Optional → unflipped. Applied as
  // a centred scale in both render paths, so geometry/selection are unchanged.
  flipH?: boolean
  flipV?: boolean
  // How this layer reflows when the frame's format changes. Absent →
  // CONSTRAINTS_DEFAULT (centre / proportional). See LayerConstraints.
  constraints?: LayerConstraints
  // Group membership. Layers sharing a groupId select and transform together as
  // one unit (move/scale). This is a flat tag rather than a container layer, so
  // every layer stays independently renderable.
  groupId?: string
  // Auto Layout child sizing. When this layer's group is an Auto Layout
  // container, `layoutGrow` makes it stretch to fill free space on the primary
  // axis (like flex-grow: 1). Absent → the child keeps its own size (Fixed).
  layoutGrow?: boolean
  // Effects
  shadow?: DropShadow
  blur?: number
}

export interface DropShadow {
  offsetX: number
  offsetY: number
  blur: number
  color: string // hex with alpha, e.g. "rgba(0,0,0,0.25)"
}

// --- Background layer ---

export type BackgroundFillType = 'solid' | 'gradient' | 'image' | 'shader'

export interface SolidFill {
  type: 'solid'
  color: BrandColor
}

export interface GradientStop {
  position: number
  color: BrandColor
}

export interface GradientFill {
  type: 'gradient'
  gradientType: 'linear' | 'radial'
  angle: number
  stops: GradientStop[]
}

export interface ImageFill {
  type: 'image'
  imageUrl: string
  fit: 'cover' | 'contain' | 'fill'
}

/**
 * Generative WebGL shader background, powered by Paper Shaders.
 * Exported as a *still*: a single deterministic frame (see `frame`) is captured
 * to a bitmap and composited through the Canvas-2D export pipeline, so it inherits
 * z-index, opacity, and resolution like any other layer. `speed` only drives the
 * live, animated editor preview.
 */
export type ShaderKind =
  | 'meshGradient'
  | 'warp'
  | 'grainGradient'
  | 'swirl'
  | 'dithering'
  | 'waves'

export interface ShaderFill {
  type: 'shader'
  kind: ShaderKind
  /** Brand-derived hex colors fed to the shader (count varies per kind). */
  colors: string[]
  /** Live-preview animation speed; 0 freezes it. Does not affect the exported still. */
  speed: number
  /** Deterministic time offset (ms) that selects which frame is exported. */
  frame: number
  /** Generic 0–1 strength, mapped to the most characterful param of each shader. */
  intensity: number
  /** Pattern zoom (0.25–3). */
  scale: number
  /** Pattern rotation in degrees (0–360). */
  rotation: number
  /** 0–1 film-grain overlay. */
  grain: number
}

export type BackgroundFill = SolidFill | GradientFill | ImageFill | ShaderFill

export interface BackgroundLayer extends LayerBase {
  type: 'background'
  fill: BackgroundFill
}

// --- Text layer ---

export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900

export type TextWrap = 'normal' | 'balance' | 'pretty'
export type TextSizing = 'fixed' | 'auto-width' | 'auto-height'
export type TextRole = 'none' | 'headline' | 'subheadline' | 'body' | 'cta' | 'tagline' | 'job-title' | 'company'

export interface TextLayer extends LayerBase {
  type: 'text'
  content: string
  fontSize: number
  fontWeight: FontWeight
  textAlign: 'left' | 'center' | 'right'
  color: BrandColor
  letterSpacing: number
  lineHeight: number
  textTransform: 'none' | 'uppercase' | 'lowercase'
  textWrap?: TextWrap
  textSizing?: TextSizing
  textRole?: TextRole
  underline?: boolean
  strikethrough?: boolean
  verticalAlign?: 'top' | 'middle' | 'bottom'
  // Vertical (leading) trim. 'standard' keeps the font's line-height leading
  // above the cap line and below the baseline; 'cap' trims it so the box hugs
  // the glyphs (cap height → baseline), the way Figma's vertical trim does.
  // Absent → 'cap' (the tighter, nicer default).
  verticalTrim?: 'standard' | 'cap'
}

// --- Image layer ---

export interface ImageLayer extends LayerBase {
  type: 'image'
  imageUrl: string
  fit: 'cover' | 'contain' | 'fill'
  cropX: number
  cropY: number
  cropW: number
  cropH: number
  borderRadius: number
  // Marks an image sourced from the bundled avatar set → the inspector shows a
  // "Shuffle" action to swap in another random face. Optional (old layers omit).
  avatarSet?: boolean
}

// --- SVG layer ---

export interface SvgLayer extends LayerBase {
  type: 'svg'
  svgContent: string
  // Monochrome tint — recolours every fill/stroke to one colour (used by icons).
  tintColor?: BrandColor
  // Per-colour remap for multi-colour SVGs, keyed by the normalised original
  // colour (lowercased, hex-expanded). Lets each original colour be retargeted
  // independently while leaving the rest of the artwork intact.
  colorOverrides?: Record<string, BrandColor>
  // Uniform multiplier applied to every stroke width in the artwork (1 = original).
  strokeWidth?: number
}

// --- Shape layer ---

export type ShapeType = 'rectangle' | 'ellipse' | 'line' | 'pill' | 'triangle' | 'star'

export type LineCap = 'butt' | 'round' | 'square'

export interface ShapeLayer extends LayerBase {
  type: 'shape'
  shape: ShapeType
  fill: BrandColor
  stroke?: { color: BrandColor; width: number }
  borderRadius: number
  // Line-specific
  lineCap?: LineCap
  // Bezier control point (normalized 0-1 relative to line bounding box)
  controlPointX?: number
  controlPointY?: number
}

// --- Gradient layer ---

export type GradientType = 'linear' | 'radial' | 'conic' | 'mesh'

export interface GradientColorStop {
  position: number
  // OKLCH values for perceptually uniform interpolation
  oklchL: number // lightness 0-1
  oklchC: number // chroma 0-0.4
  oklchH: number // hue 0-360
  alpha: number  // 0-1
}

export interface GradientLayer extends LayerBase {
  type: 'gradient'
  gradientType: GradientType
  angle: number // degrees, for linear
  stops: GradientColorStop[]
  grain: number // 0-1 grain overlay intensity
  borderRadius: number
}

// --- Group layer ---

export interface GroupLayer extends LayerBase {
  type: 'group'
  childIds: LayerId[]
}

// --- Union ---

// Freehand drawing: a smoothed stroke captured from the pen tool. Points are
// stored relative to the layer origin (x, y) so the whole stroke moves/scales
// as one layer like any other.
export type DrawMode = 'pen' | 'highlighter'

export interface DrawLayer extends LayerBase {
  type: 'draw'
  points: [number, number][]
  color: BrandColor
  strokeWidth: number
  // The stroke's intrinsic bbox size (points are in this space). Rendering
  // scales points by width/natWidth × height/natHeight, so resizing the box
  // scales the stroke like any other layer. Absent on pre-existing layers → 1:1.
  natWidth: number
  natHeight: number
  // --- Pressure-variable pen / highlighter (all optional → old layers still
  // render). The filled outline is regenerated from `points` at render time via
  // `getDrawPath`, so no data migration is needed. ---
  // 'pen' (tapered, pressure-variable width) or 'highlighter' (constant width,
  // multiply blend, capped opacity). Absent → 'pen'.
  mode?: DrawMode
  // Per-point pressure (0–1), parallel to `points`. Absent → velocity-simulated.
  pressures?: number[]
  // How strongly pressure narrows the stroke (0 = constant, 1 = fully variable).
  thinning?: number
  // End shape: 0 = round (blunt) caps, 1 = fully pointed taper. Absent → pen 1.
  taper?: number
  // Low-pass smoothing of the raw samples (0 = raw, 1 = very smooth). Absent → pen 0.5.
  streamline?: number
}

export type Layer = BackgroundLayer | TextLayer | ImageLayer | SvgLayer | ShapeLayer | GradientLayer | GroupLayer | DrawLayer

// --- Design document ---

// --- Auto Layout -------------------------------------------------------------
// A constraint-based flow layout (Figma Auto Layout) applied to a group. Because
// groups are a flat `groupId` tag rather than a container layer, the config
// lives in a document side-map keyed by groupId (see DesignDocument.autoLayouts).
// The container box (x/y/width/height) is authoritative for a 'fixed' dimension
// and recomputed from the children each reflow for a 'hug' dimension.

export type AutoLayoutDirection = 'horizontal' | 'vertical'
export type AutoLayoutPrimaryAlign = 'start' | 'center' | 'end' | 'space-between'
export type AutoLayoutCounterAlign = 'start' | 'center' | 'end' | 'stretch'
export type AutoLayoutSizing = 'fixed' | 'hug'

export interface AutoLayoutPadding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface AutoLayoutConfig {
  direction: AutoLayoutDirection
  gap: number
  padding: AutoLayoutPadding
  primaryAlign: AutoLayoutPrimaryAlign
  counterAlign: AutoLayoutCounterAlign
  widthMode: AutoLayoutSizing
  heightMode: AutoLayoutSizing
  // Container box top-left in design coords, plus its size. `width`/`height` are
  // authoritative when the matching mode is 'fixed'; overwritten each reflow when
  // 'hug'. `x`/`y` translate rigidly when the group is dragged.
  x: number
  y: number
  width: number
  height: number
  // Nesting: when this Auto Layout is itself a child of another Auto Layout, the
  // parent's groupId. The parent lays this group out as a single composite child
  // (using its container box) and moves it as one block. Absent → top-level.
  parentGroupId?: string
}

export interface DesignDocument {
  id: string
  name: string
  format: AdFormat
  layers: Layer[]
  createdAt: string
  updatedAt: string
  // Auto Layout configs keyed by groupId. Optional → old documents omit it.
  autoLayouts?: Record<string, AutoLayoutConfig>
}

// --- Tool modes ---

export type ToolMode = 'select' | 'text' | 'shape' | 'pan' | 'comment' | 'draw' | 'eraser'

// --- Auto-resize anchors ---

// Layout constraints — how a layer repositions/resizes when its frame's format
// changes (e.g. Instagram Story → LinkedIn Feed). Figma-style anchors: the
// pinned edge(s) keep their margin; 'stretch' keeps *both* edges pinned so the
// box grows with the frame. `scale` governs the layer's own size (and text
// font size). Absent constraints are treated as CONSTRAINTS_DEFAULT below.
export type HorizontalAnchor = 'left' | 'center' | 'right' | 'stretch'
export type VerticalAnchor = 'top' | 'center' | 'bottom' | 'stretch'
export type ScaleMode = 'proportional' | 'fixed' | 'stretch'

export interface LayerConstraints {
  horizontal: HorizontalAnchor
  vertical: VerticalAnchor
  scale: ScaleMode
}

/** Safe default: keep relative centre, scale proportionally to fit. Never
    pushes content off-canvas, so an unconstrained design survives any reformat. */
export const CONSTRAINTS_DEFAULT: LayerConstraints = {
  horizontal: 'center',
  vertical: 'center',
  scale: 'proportional',
}
