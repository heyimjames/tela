import type {
  Layer,
  BackgroundLayer,
  ImageLayer,
  SvgLayer,
  ShapeLayer,
  GradientFill,
  DrawLayer,
} from '@/types/design'
import { getOrLoadImage, svgImageCache } from '@/engine/renderers/imageCache'
import { applySvgColorOverrides } from '@/engine/svgColors'
import { getDrawPath, HIGHLIGHTER_OPACITY } from '@/engine/freehand'
import { renderTextLayer } from '@/engine/renderers/textRenderer'
import { renderGradientLayer } from '@/engine/renderers/gradientRenderer'

/**
 * Per-render options. Shader backgrounds are WebGL and can't render synchronously
 * inside the 2D pipeline, so callers choose how to handle them:
 * - `suppressShaderBg` (live editor): draw nothing — a live React overlay sits behind the canvas.
 * - `shaderCanvases` (export / thumbnail): pre-captured stills, drawn like an image.
 * - neither: fall back to the shader's first color (cheap, for any sync path).
 */
export interface RenderOptions {
  suppressShaderBg?: boolean
  shaderCanvases?: Map<string, HTMLCanvasElement>
  // Skip painting this layer — used so a text layer being edited inline
  // isn't drawn underneath the live <textarea> overlay (avoids ghosting).
  hideLayerId?: string
}

// Re-export sub-renderers so existing imports still work
export { renderTextLayer } from '@/engine/renderers/textRenderer'
export { renderGradientLayer } from '@/engine/renderers/gradientRenderer'

// --- Background layer ---

function renderSolidBackground(
  ctx: CanvasRenderingContext2D,
  layer: BackgroundLayer,
  w: number,
  h: number,
) {
  if (layer.fill.type !== 'solid') return
  ctx.fillStyle = layer.fill.color.hex
  ctx.fillRect(0, 0, w, h)
}

function renderGradientBackground(
  ctx: CanvasRenderingContext2D,
  _layer: BackgroundLayer,
  w: number,
  h: number,
  fill: GradientFill,
) {
  let gradient: CanvasGradient

  if (fill.gradientType === 'linear') {
    const angleRad = (fill.angle * Math.PI) / 180
    const cx = w / 2
    const cy = h / 2
    const len = Math.max(w, h)
    const dx = Math.cos(angleRad) * len / 2
    const dy = Math.sin(angleRad) * len / 2
    gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
  } else {
    gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2)
  }

  for (const stop of fill.stops) {
    gradient.addColorStop(stop.position, stop.color.hex)
  }

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
}

function renderImageBackground(
  ctx: CanvasRenderingContext2D,
  _layer: BackgroundLayer,
  w: number,
  h: number,
  imageUrl: string,
  fit: 'cover' | 'contain' | 'fill',
) {
  const img = getOrLoadImage(imageUrl)
  if (!img) return

  if (fit === 'fill') {
    ctx.drawImage(img, 0, 0, w, h)
    return
  }

  const imgAspect = img.naturalWidth / img.naturalHeight
  const canvasAspect = w / h
  let sw: number, sh: number, sx: number, sy: number
  let dw: number, dh: number, dx: number, dy: number

  if (fit === 'cover') {
    if (imgAspect > canvasAspect) {
      sh = img.naturalHeight
      sw = sh * canvasAspect
      sx = (img.naturalWidth - sw) / 2
      sy = 0
    } else {
      sw = img.naturalWidth
      sh = sw / canvasAspect
      sx = 0
      sy = (img.naturalHeight - sh) / 2
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
  } else {
    // contain
    if (imgAspect > canvasAspect) {
      dw = w
      dh = w / imgAspect
    } else {
      dh = h
      dw = h * imgAspect
    }
    dx = (w - dw) / 2
    dy = (h - dh) / 2
    ctx.drawImage(img, dx, dy, dw, dh)
  }
}

function renderShaderBackground(
  ctx: CanvasRenderingContext2D,
  layer: BackgroundLayer,
  w: number,
  h: number,
  opts?: RenderOptions,
) {
  if (layer.fill.type !== 'shader') return

  const captured = opts?.shaderCanvases?.get(layer.id)
  if (captured) {
    ctx.drawImage(captured, 0, 0, w, h)
    return
  }
  // Live editor: a React shader overlay sits behind the canvas — leave transparent.
  if (opts?.suppressShaderBg) return
  // Any other sync path (e.g. a thumbnail without a capture): cheap solid fallback.
  ctx.fillStyle = layer.fill.colors[0] ?? '#0017c7'
  ctx.fillRect(0, 0, w, h)
}

export function renderBackgroundLayer(
  ctx: CanvasRenderingContext2D,
  layer: BackgroundLayer,
  w: number,
  h: number,
  opts?: RenderOptions,
) {
  switch (layer.fill.type) {
    case 'solid':
      renderSolidBackground(ctx, layer, w, h)
      break
    case 'gradient':
      renderGradientBackground(ctx, layer, w, h, layer.fill)
      break
    case 'image':
      renderImageBackground(ctx, layer, w, h, layer.fill.imageUrl, layer.fill.fit)
      break
    case 'shader':
      renderShaderBackground(ctx, layer, w, h, opts)
      break
  }
}

// --- Image layer ---

export function renderImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: ImageLayer,
  scale: number,
) {
  const img = getOrLoadImage(layer.imageUrl)
  if (!img) return

  const w = layer.width * scale
  const h = layer.height * scale

  ctx.save()

  // Border radius clip
  if (layer.borderRadius > 0) {
    ctx.beginPath()
    ctx.roundRect(0, 0, w, h, layer.borderRadius * scale)
    ctx.clip()
  }

  // Crop source rect
  const sx = layer.cropX * img.naturalWidth
  const sy = layer.cropY * img.naturalHeight
  const sw = layer.cropW * img.naturalWidth
  const sh = layer.cropH * img.naturalHeight

  if (layer.fit === 'fill') {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
  } else if (layer.fit === 'cover') {
    const imgAspect = sw / sh
    const layerAspect = w / h
    let drawSx = sx, drawSy = sy, drawSw = sw, drawSh = sh

    if (imgAspect > layerAspect) {
      drawSw = sh * layerAspect
      drawSx = sx + (sw - drawSw) / 2
    } else {
      drawSh = sw / layerAspect
      drawSy = sy + (sh - drawSh) / 2
    }
    ctx.drawImage(img, drawSx, drawSy, drawSw, drawSh, 0, 0, w, h)
  } else {
    // contain
    const imgAspect = sw / sh
    const layerAspect = w / h
    let dw: number, dh: number
    if (imgAspect > layerAspect) {
      dw = w
      dh = w / imgAspect
    } else {
      dh = h
      dw = h * imgAspect
    }
    const dx = (w - dw) / 2
    const dy = (h - dh) / 2
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
  }

  ctx.restore()
}

// --- SVG layer ---

export function renderSvgLayer(
  ctx: CanvasRenderingContext2D,
  layer: SvgLayer,
  scale: number,
) {
  const w = layer.width * scale
  const h = layer.height * scale

  // Encode SVG as a data URL and cache. Key must vary with both the monochrome
  // tint and the per-colour override map so edits invalidate the cached raster.
  const overrideKey = layer.colorOverrides
    ? Object.entries(layer.colorOverrides).map(([k, v]) => `${k}:${v.hex}`).sort().join('|')
    : ''
  const cacheKey = layer.svgContent + (layer.tintColor?.hex ?? '') + overrideKey
  let img = svgImageCache.get(cacheKey)

  if (!img) {
    let svgStr = layer.svgContent
    // Per-colour remap for multi-colour artwork (each original colour retargeted
    // independently, untouched colours preserved).
    const hasOverrides = !!layer.colorOverrides && Object.keys(layer.colorOverrides).length > 0
    if (hasOverrides) {
      const hexMap = Object.fromEntries(
        Object.entries(layer.colorOverrides!).map(([k, v]) => [k, v.hex]),
      )
      svgStr = applySvgColorOverrides(svgStr, hexMap)
    }
    // Monochrome tint — forces every fill/stroke to one colour (icons). Yields
    // to explicit per-colour overrides so it matches the live editor (SvgNode);
    // (?!none) keeps unpainted regions transparent instead of flooding them.
    if (layer.tintColor && !hasOverrides) {
      svgStr = svgStr.replace(/fill="(?!none)[^"]*"/g, `fill="${layer.tintColor.hex}"`)
      svgStr = svgStr.replace(/stroke="(?!none)[^"]*"/g, `stroke="${layer.tintColor.hex}"`)
    }

    const blob = new Blob([svgStr], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    img = new Image()
    img.onload = () => {
      svgImageCache.set(cacheKey, img!)
      URL.revokeObjectURL(url)
    }
    img.src = url
    return // will render on next frame once loaded
  }

  ctx.drawImage(img, 0, 0, w, h)
}

// --- Shape layer ---

export function renderShapeLayer(
  ctx: CanvasRenderingContext2D,
  layer: ShapeLayer,
  scale: number,
) {
  const w = layer.width * scale
  const h = layer.height * scale
  const r = layer.borderRadius * scale

  ctx.save()

  switch (layer.shape) {
    case 'rectangle':
    case 'pill': {
      const radius = layer.shape === 'pill' ? Math.min(w, h) / 2 : r
      ctx.beginPath()
      ctx.roundRect(0, 0, w, h, radius)
      ctx.fillStyle = layer.fill.hex
      ctx.fill()
      if (layer.stroke) {
        ctx.strokeStyle = layer.stroke.color.hex
        ctx.lineWidth = layer.stroke.width * scale
        ctx.stroke()
      }
      break
    }
    case 'ellipse': {
      ctx.beginPath()
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      ctx.fillStyle = layer.fill.hex
      ctx.fill()
      if (layer.stroke) {
        ctx.strokeStyle = layer.stroke.color.hex
        ctx.lineWidth = layer.stroke.width * scale
        ctx.stroke()
      }
      break
    }
    case 'line': {
      ctx.beginPath()
      ctx.lineCap = layer.lineCap ?? 'round'
      ctx.strokeStyle = layer.fill.hex
      ctx.lineWidth = Math.max(layer.stroke?.width ?? 2, 1) * scale

      const x0 = 0
      const y0 = 0
      const x1 = w
      const y1 = h

      ctx.moveTo(x0, y0)

      // Bezier control point (if set)
      if (layer.controlPointX != null && layer.controlPointY != null) {
        const cpx = layer.controlPointX * w
        const cpy = layer.controlPointY * h
        ctx.quadraticCurveTo(cpx, cpy, x1, y1)
      } else {
        ctx.lineTo(x1, y1)
      }

      ctx.stroke()
      break
    }
  }

  ctx.restore()
}

// --- Main dispatch ---

export function renderLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
  opts?: RenderOptions,
) {
  if (!layer.visible || layer.opacity <= 0) return

  ctx.save()
  ctx.globalAlpha = layer.opacity

  if (layer.type === 'background') {
    renderBackgroundLayer(ctx, layer, canvasWidth, canvasHeight, opts)
  } else {
    // Position and rotate
    const x = layer.x * scale
    const y = layer.y * scale

    ctx.translate(x, y)

    // Apply drop shadow
    if (layer.shadow) {
      ctx.shadowOffsetX = layer.shadow.offsetX * scale
      ctx.shadowOffsetY = layer.shadow.offsetY * scale
      ctx.shadowBlur = layer.shadow.blur * scale
      ctx.shadowColor = layer.shadow.color
    }

    // Apply blur
    if (layer.blur && layer.blur > 0) {
      ctx.filter = `blur(${layer.blur * scale}px)`
    }

    if (layer.rotation !== 0) {
      const cx = (layer.width * scale) / 2
      const cy = (layer.height * scale) / 2
      ctx.translate(cx, cy)
      ctx.rotate((layer.rotation * Math.PI) / 180)
      ctx.translate(-cx, -cy)
    }

    // Mirror around the layer centre when flipped (matches the SVG scene).
    if (layer.flipH || layer.flipV) {
      const cx = (layer.width * scale) / 2
      const cy = (layer.height * scale) / 2
      ctx.translate(cx, cy)
      ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1)
      ctx.translate(-cx, -cy)
    }

    switch (layer.type) {
      case 'text':
        renderTextLayer(ctx, layer, scale)
        break
      case 'image':
        renderImageLayer(ctx, layer, scale)
        break
      case 'svg':
        renderSvgLayer(ctx, layer, scale)
        break
      case 'shape':
        renderShapeLayer(ctx, layer, scale)
        break
      case 'gradient':
        renderGradientLayer(ctx, layer, scale)
        break
      case 'draw':
        renderDrawLayer(ctx, layer, scale)
        break
    }
  }

  ctx.restore()
}

// Freehand stroke — identical geometry to the SVG renderer (getDrawPath), but
// *filled* via Path2D since the outline is a variable-width polygon, not a
// stroked centreline. The caller has already translated to the layer origin (in
// scaled px); we scale the local design-unit points here so width/position match
// the scene.
function renderDrawLayer(ctx: CanvasRenderingContext2D, layer: DrawLayer, scale: number): void {
  const sx = layer.natWidth ? layer.width / layer.natWidth : 1
  const sy = layer.natHeight ? layer.height / layer.natHeight : 1
  const d = getDrawPath({
    points: layer.points,
    pressures: layer.pressures,
    size: layer.strokeWidth,
    mode: layer.mode,
    thinning: layer.thinning,
    last: true,
  })
  ctx.save()
  // scale: design→export px; sx/sy: scale the stored stroke into the resized box.
  ctx.scale(scale * sx, scale * sy)
  ctx.fillStyle = layer.color.hex
  if (layer.mode === 'highlighter') {
    // Match the SVG path: one filled shape at capped alpha + multiply blend.
    ctx.globalAlpha = HIGHLIGHTER_OPACITY
    ctx.globalCompositeOperation = 'multiply'
  }
  ctx.fill(new Path2D(d))
  ctx.restore()
}
