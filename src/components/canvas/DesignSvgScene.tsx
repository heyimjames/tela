import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { useDesignStore } from '@/store/useDesignStore'
import { applySvgColorOverrides, applySvgStrokeWidth } from '@/engine/svgColors'
import { FONT_FAMILY } from '@/engine/textMeasure'
import { getDrawPath, HIGHLIGHTER_OPACITY } from '@/engine/freehand'
import type {
  DesignDocument,
  Layer,
  TextLayer,
  ShapeLayer,
  ImageLayer,
  SvgLayer,
  GradientLayer,
  BackgroundLayer,
  DrawLayer,
} from '@/types/design'

/**
 * Live SVG-DOM scene renderer — Phase 1 of replacing the Canvas-2D compositor.
 *
 * Every layer is a real, resolution-independent DOM node (SVG element or, for
 * text, HTML inside <foreignObject>) instead of pixels drawn to a bitmap. The
 * component works in *design coordinates* via the root <svg> viewBox, so the
 * whole scene scales crisply with zoom — no rasterisation, no blur.
 *
 * Rendered inside PreviewPanel's editing stack in place of <DesignCanvas/>.
 * Selection/resize/interaction overlays are unaffected: they read layer
 * geometry from the store, not from this surface. Shader backgrounds still
 * animate via <ShaderBackgroundOverlay/> behind this layer, so we skip them.
 */
/**
 * Captured shader-background stills (layerId → PNG data URL), supplied for
 * export/thumbnail rendering where the live WebGL overlay isn't present. Empty
 * on the live editing surface (the animated <ShaderBackgroundOverlay/> paints
 * shaders there instead).
 */
const ShaderStillsContext = createContext<Record<string, string>>({})

/** True in the live editor (enables state-change animations like fill morph);
 *  false for export so renderToStaticMarkup stays static. */
const SceneLiveContext = createContext(false)

/** Frame dimensions, so a text node can size its <foreignObject> to reach the
 *  frame edge and avoid the scaled-SVG overflow-clip artifact. */
const SceneSizeContext = createContext<{ w: number; h: number }>({ w: 1200, h: 627 })
const XHTML_ATTRS = { xmlns: 'http://www.w3.org/1999/xhtml' }

export type NaturalImageSize = { width: number; height: number }
const naturalImageSizeCache = new Map<string, NaturalImageSize>()
const ImageSizesContext = createContext<Record<string, NaturalImageSize>>({})

function useNaturalImageSize(url: string): NaturalImageSize | null {
  const provided = useContext(ImageSizesContext)[url]
  const [size, setSize] = useState<NaturalImageSize | null>(
    () => provided ?? naturalImageSizeCache.get(url) ?? null,
  )

  useEffect(() => {
    if (provided) {
      naturalImageSizeCache.set(url, provided)
      setSize(provided)
      return
    }

    const cached = naturalImageSizeCache.get(url)
    if (cached) {
      setSize(cached)
      return
    }
    setSize(null)

    let cancelled = false
    const img = new Image()
    img.onload = () => {
      const next = {
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      }
      naturalImageSizeCache.set(url, next)
      if (!cancelled) setSize(next)
    }
    img.src = url

    return () => {
      cancelled = true
    }
  }, [provided, url])

  return size
}

export function DesignSvgScene() {
  const doc = useDesignStore((s) => s.document)
  const zoom = useDesignStore((s) => s.zoom)
  const editingTextLayerId = useDesignStore((s) => s.editingTextLayerId)
  return (
    <SvgScene
      doc={doc}
      zoom={zoom}
      hideLayerId={editingTextLayerId ?? undefined}
      className="block pointer-events-none"
      animateEntrance
    />
  )
}

/**
 * Pure, document-driven SVG scene. Rendered live by <DesignSvgScene/> and also
 * serialised for vector export (via renderToStaticMarkup), so the exported .svg
 * is identical to what's on screen — one renderer, no drift. Pass `standalone`
 * for export so the root carries the SVG namespace.
 */
export function SvgScene({
  doc,
  zoom = 1,
  hideLayerId,
  standalone = false,
  className,
  shaderStills,
  imageSizes,
  animateEntrance = false,
}: {
  doc: DesignDocument
  zoom?: number
  hideLayerId?: string
  standalone?: boolean
  className?: string
  /** layerId → PNG data URL for shader backgrounds (export/thumbnail only). */
  shaderStills?: Record<string, string>
  /** imageUrl → natural dimensions, used by static SVG export for cropped images. */
  imageSizes?: Record<string, NaturalImageSize>
  /** Fade layers in on mount — live editor only; NEVER for export (a mid-
   *  animation frame would serialise as blank). */
  animateEntrance?: boolean
}) {
  const fw = doc.format?.width ?? 1200
  const fh = doc.format?.height ?? 627
  const w = Math.max(1, fw * zoom)
  const h = Math.max(1, fh * zoom)

  // Paint order: ascending zIndex, then array order as a tiebreak.
  const ordered = [...doc.layers]
    .map((l, i) => ({ l, i }))
    .sort((a, b) => a.l.zIndex - b.l.zIndex || a.i - b.i)
    .map(({ l }) => l)

  return (
    <svg
      {...(standalone ? { xmlns: 'http://www.w3.org/2000/svg' } : {})}
      className={className}
      width={w}
      height={h}
      viewBox={`0 0 ${fw} ${fh}`}
      style={{ overflow: 'hidden' }}
    >
      <ShaderStillsContext.Provider value={shaderStills ?? {}}>
        <ImageSizesContext.Provider value={imageSizes ?? {}}>
          <SceneLiveContext.Provider value={animateEntrance}>
            <SceneSizeContext.Provider value={{ w: fw, h: fh }}>
              {ordered.map((layer) =>
                layer.visible === false || layer.id === hideLayerId ? null : (
                  <LayerNode key={layer.id} layer={layer} animate={animateEntrance} />
                ),
              )}
            </SceneSizeContext.Provider>
          </SceneLiveContext.Provider>
        </ImageSizesContext.Provider>
      </ShaderStillsContext.Provider>
    </svg>
  )
}

/** Wraps a layer's content in a transform/opacity/effects group. */
function LayerNode({ layer, animate = false }: { layer: Layer; animate?: boolean }) {
  const cx = layer.x + layer.width / 2
  const cy = layer.y + layer.height / 2
  const transform =
    `translate(${layer.x} ${layer.y})` +
    (layer.rotation ? ` rotate(${layer.rotation} ${layer.width / 2} ${layer.height / 2})` : '') +
    // Mirror around the layer centre when flipped (scale can't be negative-origin,
    // so translate-in / scale / translate-out).
    (layer.flipH || layer.flipV
      ? ` translate(${layer.width / 2} ${layer.height / 2}) scale(${layer.flipH ? -1 : 1} ${layer.flipV ? -1 : 1}) translate(${-layer.width / 2} ${-layer.height / 2})`
      : '')

  // Shadow + blur compose into one CSS filter (drop-shadow is resolution-free).
  const filters: string[] = []
  if (layer.shadow) {
    const s = layer.shadow
    filters.push(`drop-shadow(${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.color})`)
  }
  if (layer.blur) filters.push(`blur(${layer.blur}px)`)

  const style = filters.length ? { filter: filters.join(' ') } : undefined
  const content = <LayerContent layer={layer} />

  // Live editor: fade each layer in on mount (adding a layer, or the initial
  // load) — a gentle "birth". Opacity-only so it never fights the transform
  // attribute; also smooths later opacity edits. Export path (animate=false)
  // stays a plain static <g>.
  if (animate) {
    // Transform stays on a plain <g> (raw string attr, reliable); the inner
    // motion.g only animates opacity so it can't fight motion's transform math.
    return (
      <g transform={transform} style={style} data-layer-id={layer.id}>
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: layer.opacity ?? 1 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          {content}
        </motion.g>
      </g>
    )
  }

  return (
    <g transform={transform} opacity={layer.opacity ?? 1} style={style} data-layer-id={layer.id}>
      {content}
    </g>
  )
}

function LayerContent({ layer }: { layer: Layer }) {
  switch (layer.type) {
    case 'background':
      return <BackgroundNode layer={layer} />
    case 'shape':
      return <ShapeNode layer={layer} />
    case 'text':
      return <TextNode layer={layer} />
    case 'draw':
      return <DrawNode layer={layer} />
    case 'image':
      return <ImageNode layer={layer} />
    case 'svg':
      return <SvgNode layer={layer} />
    case 'gradient':
      return <GradientNode layer={layer} />
    case 'group':
      // Groups are a flat membership tag — members render independently.
      return null
    default:
      return null
  }
}

// --- Background -------------------------------------------------------------

function BackgroundNode({ layer }: { layer: BackgroundLayer }) {
  const { fill, width, height } = layer
  const shaderStills = useContext(ShaderStillsContext)
  if (fill.type === 'solid') {
    return <rect width={width} height={height} fill={fill.color.hex} />
  }
  if (fill.type === 'gradient') {
    const id = `bg-grad-${layer.id}`
    return (
      <>
        <defs>
          <LinearGrad
            id={id}
            angle={fill.angle}
            stops={fill.stops.map((s) => ({ offset: s.position, color: s.color.hex }))}
          />
        </defs>
        <rect width={width} height={height} fill={`url(#${id})`} />
      </>
    )
  }
  if (fill.type === 'image') {
    return (
      <image
        href={fill.imageUrl}
        width={width}
        height={height}
        preserveAspectRatio={
          fill.fit === 'contain'
            ? 'xMidYMid meet'
            : fill.fit === 'fill'
              ? 'none'
              : 'xMidYMid slice'
        }
      />
    )
  }
  // Shader: paint a captured still if one was supplied (export / thumbnails);
  // otherwise the live <ShaderBackgroundOverlay/> renders it behind the scene.
  const still = shaderStills[layer.id]
  if (fill.type === 'shader' && still) {
    return (
      <image
        href={still}
        width={width}
        height={height}
        preserveAspectRatio="xMidYMid slice"
      />
    )
  }
  return null
}

// --- Shape ------------------------------------------------------------------

function ShapeNode({ layer }: { layer: ShapeLayer }) {
  const { width, height, fill, stroke, borderRadius, shape } = layer
  const live = useContext(SceneLiveContext)
  const strokeProps = stroke
    ? { stroke: stroke.color.hex, strokeWidth: stroke.width }
    : {}
  // In the live editor, fill changes morph smoothly (swatch pick). Export stays
  // static (live=false → plain element, correct colour, no animation).
  const fillMorph = {
    initial: false as const,
    animate: { fill: fill.hex },
    transition: { duration: 0.25 },
  }

  if (shape === 'ellipse') {
    const props = {
      cx: width / 2,
      cy: height / 2,
      rx: Math.max(0, width / 2 - (stroke?.width ?? 0) / 2),
      ry: Math.max(0, height / 2 - (stroke?.width ?? 0) / 2),
      fill: fill.hex,
      ...strokeProps,
    }
    return live ? <motion.ellipse {...props} {...fillMorph} /> : <ellipse {...props} />
  }

  if (shape === 'line') {
    const cpx = layer.controlPointX
    const cpy = layer.controlPointY
    const d =
      cpx != null && cpy != null
        ? `M 0 ${height / 2} Q ${cpx * width} ${cpy * height} ${width} ${height / 2}`
        : `M 0 ${height / 2} L ${width} ${height / 2}`
    return (
      <path
        d={d}
        fill="none"
        stroke={stroke?.color.hex ?? fill.hex}
        strokeWidth={stroke?.width ?? 2}
        strokeLinecap={layer.lineCap ?? 'butt'}
      />
    )
  }

  // rectangle + pill (pill = fully rounded ends)
  const rx = shape === 'pill' ? height / 2 : borderRadius
  const inset = (stroke?.width ?? 0) / 2
  const props = {
    x: inset,
    y: inset,
    width: Math.max(0, width - inset * 2),
    height: Math.max(0, height - inset * 2),
    rx: Math.max(0, rx - inset),
    fill: fill.hex,
    ...strokeProps,
  }
  return live ? <motion.rect {...props} {...fillMorph} /> : <rect {...props} />
}

// --- Text (real HTML inside foreignObject) ----------------------------------

function TextNode({ layer }: { layer: TextLayer }) {
  const scene = useContext(SceneSizeContext)
  const va = layer.verticalAlign ?? 'top'
  const justify = va === 'middle' ? 'center' : va === 'bottom' ? 'flex-end' : 'flex-start'

  // Top-aligned text flows downward; extend the foreignObject to the frame
  // bottom and let the box auto-grow, so overflow is never clipped by the
  // foreignObject's own rect (the zoom-dependent artifact). The root
  // <svg overflow:hidden> still clips correctly at the frame edge.
  const grow = va === 'top'
  const foHeight = grow ? Math.max(layer.height, scene.h - layer.y) : layer.height

  const decoration =
    [layer.underline && 'underline', layer.strikethrough && 'line-through']
      .filter(Boolean)
      .join(' ') || undefined

  // Layout wrapper handles vertical alignment; it must NOT carry the trim —
  // text-box-trim is ignored on flex containers.
  const wrapStyle: React.CSSProperties = {
    width: '100%',
    height: grow ? 'auto' : '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: justify,
  }
  // The trim lives on the inner *block* that actually holds the text — that's
  // the only place text-box-trim / text-box-edge take effect (native,
  // font-accurate). CSSProperties doesn't type these yet.
  const textStyle: React.CSSProperties = {
    width: '100%',
    textAlign: layer.textAlign,
    color: layer.color.hex,
    fontSize: `${layer.fontSize}px`,
    fontWeight: layer.fontWeight,
    // letterSpacing is a font-size multiplier (matches textMeasure/textRenderer,
    // which use letterSpacing * fontSize) — NOT raw px, or render/measure/export drift.
    letterSpacing: `${layer.letterSpacing * layer.fontSize}px`,
    lineHeight: layer.lineHeight,
    textTransform: layer.textTransform,
    textDecoration: decoration,
    textWrap: layer.textWrap as never,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: FONT_FAMILY,
  }
  if ((layer.verticalTrim ?? 'cap') === 'cap') {
    Object.assign(textStyle, { textBoxTrim: 'trim-both', textBoxEdge: 'cap alphabetic' })
  }

  return (
    <foreignObject x={0} y={0} width={layer.width} height={foHeight} overflow="visible" style={{ overflow: 'visible' }}>
      {/* Real HTML text: browser handles wrapping, alignment, tracking. */}
      <div {...XHTML_ATTRS} style={wrapStyle}>
        <div style={textStyle}>{layer.content}</div>
      </div>
    </foreignObject>
  )
}

// --- Freehand drawing -------------------------------------------------------

function DrawNode({ layer }: { layer: DrawLayer }) {
  // Scale the stored stroke into the current box so resizing works (matches how
  // every other layer scales content to width/height). Fallback 1:1 for layers
  // saved before natWidth/natHeight existed.
  const sx = layer.natWidth ? layer.width / layer.natWidth : 1
  const sy = layer.natHeight ? layer.height / layer.natHeight : 1
  const isHighlighter = layer.mode === 'highlighter'
  // Filled variable-width outline (perfect-freehand style) — not a stroked
  // centreline. Round joins are inherent to the smooth outline path.
  const d = getDrawPath({
    points: layer.points,
    pressures: layer.pressures,
    size: layer.strokeWidth,
    mode: layer.mode,
    thinning: layer.thinning,
    taper: layer.taper,
    streamline: layer.streamline,
    last: true,
  })
  const path = (
    <path
      d={d}
      fill={layer.color.hex}
      fillOpacity={isHighlighter ? HIGHLIGHTER_OPACITY : undefined}
      // One filled shape per stroke at a capped alpha + multiply blend → a
      // highlighter that doesn't darken where a single stroke overlaps itself.
      style={isHighlighter ? { mixBlendMode: 'multiply' } : undefined}
    />
  )
  if (sx === 1 && sy === 1) return path
  return <g transform={`scale(${sx} ${sy})`}>{path}</g>
}

// --- Image ------------------------------------------------------------------

function ImageNode({ layer }: { layer: ImageLayer }) {
  const { width, height, imageUrl, fit, borderRadius, cropX, cropY, cropW, cropH } = layer
  const clipId = `img-clip-${layer.id}`
  const par = fit === 'contain' ? 'xMidYMid meet' : fit === 'fill' ? 'none' : 'xMidYMid slice'

  // Apply the crop rect faithfully (matching the Canvas-2D renderer): the
  // nested SVG viewBox selects the crop rectangle in the image's natural pixel
  // coordinate space, so non-square source images keep the same crop aspect as
  // the Canvas-2D compositor.
  const cropped = cropX !== 0 || cropY !== 0 || cropW !== 1 || cropH !== 1
  const nat = useNaturalImageSize(imageUrl)

  const content = cropped && nat ? (
    <svg
      x={0}
      y={0}
      width={width}
      height={height}
      viewBox={`${cropX * nat.width} ${cropY * nat.height} ${cropW * nat.width} ${
        cropH * nat.height
      }`}
      preserveAspectRatio={par}
    >
      <image href={imageUrl} width={nat.width} height={nat.height} preserveAspectRatio="none" />
    </svg>
  ) : (
    <image href={imageUrl} width={width} height={height} preserveAspectRatio={par} />
  )

  if (!borderRadius) return content
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect width={width} height={height} rx={borderRadius} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>{content}</g>
    </>
  )
}

// --- SVG (true vector, recoloured, scaled) ----------------------------------

function SvgNode({ layer }: { layer: SvgLayer }) {
  // Apply recolour to the markup, then render it as real inline vector via an
  // HTML wrapper in <foreignObject> (scales crisply, stays editable vector).
  const html = useMemo(() => {
    let svg = layer.svgContent
    const hasOverrides = !!layer.colorOverrides && Object.keys(layer.colorOverrides).length > 0
    if (hasOverrides) {
      const hexMap = Object.fromEntries(
        Object.entries(layer.colorOverrides!).map(([k, v]) => [k, v.hex]),
      )
      svg = applySvgColorOverrides(svg, hexMap)
    }
    // A blanket tint clobbers everything, so it must yield to explicit per-colour
    // overrides — otherwise recolouring a single icon stroke silently does
    // nothing (the tint re-paints it right back). Once the user recolours any
    // colour, they've taken manual control; the tint steps aside.
    if (layer.tintColor && !hasOverrides) {
      // Reuse the faithful override engine for the monochrome case too, so
      // colours in style="" / <style> are recoloured, not just attributes.
      const colorless = svg
      svg = applySvgColorOverrides(colorless, {})
      svg = svg
        .replace(/fill="(?!none)[^"]*"/g, `fill="${layer.tintColor.hex}"`)
        .replace(/stroke="(?!none)[^"]*"/g, `stroke="${layer.tintColor.hex}"`)
    }
    if (layer.strokeWidth && layer.strokeWidth !== 1) {
      svg = applySvgStrokeWidth(svg, layer.strokeWidth)
    }
    // Force the root <svg> to fill the layer box so it scales to the frame.
    // overflow:visible so a fat stroke near the viewBox edge isn't clipped by
    // the SVG viewport (it should bleed past the box like it does in Figma).
    svg = svg.replace(/<svg([^>]*)>/, (m, attrs) => {
      // Merge (not duplicate) any existing root style: pull it out, drop its
      // own overflow declaration, then re-add overflow:visible. Two `style`
      // attributes would let the original (e.g. overflow:hidden) win and defeat
      // the fix for SVGs that ship an inline style.
      let existingStyle = ''
      const cleaned = String(attrs)
        .replace(/\swidth="[^"]*"/, '')
        .replace(/\sheight="[^"]*"/, '')
        .replace(/\soverflow="[^"]*"/, '')
        .replace(/\sstyle="([^"]*)"/, (_s, body) => { existingStyle = String(body); return '' })
      const mergedStyle = [
        ...existingStyle.split(';').map((d) => d.trim()).filter((d) => d && !/^overflow\s*:/i.test(d)),
        'overflow:visible',
      ].join(';')
      return `<svg${cleaned} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" overflow="visible" style="${mergedStyle}">`
    })
    return svg
  }, [layer.svgContent, layer.colorOverrides, layer.tintColor, layer.strokeWidth])

  return (
    <foreignObject x={0} y={0} width={layer.width} height={layer.height} overflow="visible" style={{ overflow: 'visible' }}>
      <div
        {...XHTML_ATTRS}
        style={{ width: '100%', height: '100%', lineHeight: 0, overflow: 'visible' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </foreignObject>
  )
}

// --- Gradient layer ---------------------------------------------------------

// Mesh node positions — mirror the Canvas-2D renderer exactly so mesh gradients
// look identical across the live scene, thumbnails, and export.
const MESH_POSITIONS = [
  [0.25, 0.3], [0.75, 0.3], [0.5, 0.7], [0.2, 0.8], [0.8, 0.6],
] as const

const oklch = (s: { oklchL: number; oklchC: number; oklchH: number; alpha: number }, alphaMul = 1) =>
  `oklch(${s.oklchL} ${s.oklchC} ${s.oklchH} / ${s.alpha * alphaMul})`

function GradientNode({ layer }: { layer: GradientLayer }) {
  const id = `grad-${layer.id}`
  const clipId = `grad-clip-${layer.id}`
  const { width: w, height: h, borderRadius, grain, gradientType, angle } = layer
  const stops = layer.stops.map((s) => ({ offset: s.position, color: oklch(s) }))

  // Grain overlay — feTurbulence noise blended 'overlay', matching the
  // Canvas-2D grain (which draws random noise at grain*0.4 in overlay mode).
  const grainOverlay = grain > 0 ? (
    <>
      <filter id={`${id}-noise`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" />
      </filter>
      <rect width={w} height={h} filter={`url(#${id}-noise)`} opacity={grain * 0.4} style={{ mixBlendMode: 'overlay' }} />
    </>
  ) : null

  // Conic isn't expressible in SVG <defs>; render it as CSS conic-gradient in a
  // foreignObject (OKLCH stops supported by modern browsers).
  if (gradientType === 'conic') {
    const css = `conic-gradient(from ${angle}deg at 50% 50%, ${stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})`
    return (
      <>
        {borderRadius ? <defs><clipPath id={clipId}><rect width={w} height={h} rx={borderRadius} /></clipPath></defs> : null}
        <g clipPath={borderRadius ? `url(#${clipId})` : undefined}>
          <foreignObject x={0} y={0} width={w} height={h}>
            <div {...XHTML_ATTRS} style={{ width: '100%', height: '100%', background: css }} />
          </foreignObject>
          {grainOverlay}
        </g>
      </>
    )
  }

  // Mesh — black base + one screen-blended radial per stop, mirroring Canvas-2D.
  if (gradientType === 'mesh') {
    return (
      <>
        <defs>
          {layer.stops.map((s, i) => {
            const [nx, ny] = MESH_POSITIONS[i % MESH_POSITIONS.length]
            return (
              <radialGradient key={i} id={`${id}-m${i}`} gradientUnits="userSpaceOnUse" cx={nx * w} cy={ny * h} r={Math.max(w, h) * 0.6}>
                <stop offset="0" stopColor={oklch(s)} />
                <stop offset="0.4" stopColor={oklch(s)} />
                <stop offset="0.7" stopColor={oklch(s, 0.3)} />
                <stop offset="1" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
            )
          })}
          {borderRadius ? <clipPath id={clipId}><rect width={w} height={h} rx={borderRadius} /></clipPath> : null}
        </defs>
        <g clipPath={borderRadius ? `url(#${clipId})` : undefined}>
          <rect width={w} height={h} fill="#000" />
          {layer.stops.map((_, i) => (
            <rect key={i} width={w} height={h} fill={`url(#${id}-m${i})`} style={{ mixBlendMode: 'screen' }} />
          ))}
          {grainOverlay}
        </g>
      </>
    )
  }

  // Linear / radial — SVG gradients.
  return (
    <>
      <defs>
        {gradientType === 'radial' ? (
          <radialGradient id={id} cx="50%" cy="50%" r="70%">
            {stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />)}
          </radialGradient>
        ) : (
          <LinearGrad id={id} angle={angle} stops={stops} />
        )}
        {borderRadius && grainOverlay ? <clipPath id={clipId}><rect width={w} height={h} rx={borderRadius} /></clipPath> : null}
      </defs>
      {grainOverlay ? (
        <g clipPath={borderRadius ? `url(#${clipId})` : undefined}>
          <rect width={w} height={h} rx={borderRadius || 0} fill={`url(#${id})`} />
          {grainOverlay}
        </g>
      ) : (
        <rect width={w} height={h} rx={borderRadius || 0} fill={`url(#${id})`} />
      )}
    </>
  )
}

// --- Shared: angled linear gradient -----------------------------------------

function LinearGrad({
  id,
  angle,
  stops,
}: {
  id: string
  angle: number
  stops: { offset: number; color: string }[]
}) {
  // Convert a CSS-style angle (0 = up, clockwise) to gradient vector endpoints.
  const rad = ((angle - 90) * Math.PI) / 180
  const x = Math.cos(rad)
  const y = Math.sin(rad)
  const x1 = (0.5 - x / 2) * 100
  const y1 = (0.5 - y / 2) * 100
  const x2 = (0.5 + x / 2) * 100
  const y2 = (0.5 + y / 2) * 100
  return (
    <linearGradient id={id} x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`}>
      {stops.map((s, i) => (
        <stop key={i} offset={s.offset} stopColor={s.color} />
      ))}
    </linearGradient>
  )
}
