import type { GradientLayer, GradientColorStop } from '@/types/design'

export function oklchToRgba(l: number, c: number, h: number, a: number): string {
  // Simple OKLCH to sRGB approximation for canvas rendering
  // Uses CSS oklch() which modern browsers support
  return `oklch(${l} ${c} ${h} / ${a})`
}

function renderGrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grain: number,
) {
  const grainCanvas = document.createElement('canvas')
  grainCanvas.width = Math.round(w)
  grainCanvas.height = Math.round(h)
  const gCtx = grainCanvas.getContext('2d')!

  const imageData = gCtx.createImageData(grainCanvas.width, grainCanvas.height)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.random() * 255
    data[i] = v
    data[i + 1] = v
    data[i + 2] = v
    data[i + 3] = 255
  }
  gCtx.putImageData(imageData, 0, 0)

  ctx.globalCompositeOperation = 'overlay'
  ctx.globalAlpha = grain * 0.4 // Scale grain intensity
  ctx.drawImage(grainCanvas, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

export function renderGradientLayer(
  ctx: CanvasRenderingContext2D,
  layer: GradientLayer,
  scale: number,
) {
  const w = layer.width * scale
  const h = layer.height * scale

  ctx.save()

  // Border radius clip
  if (layer.borderRadius > 0) {
    ctx.beginPath()
    ctx.roundRect(0, 0, w, h, layer.borderRadius * scale)
    ctx.clip()
  }

  // Mesh gradient — uses multiple radial gradients with screen compositing
  if (layer.gradientType === 'mesh') {
    // Black base
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'screen'

    // Each stop becomes a positioned radial gradient node
    const nodeCount = layer.stops.length
    // Distribute nodes in a pattern
    const positions = [
      { nx: 0.25, ny: 0.3 }, { nx: 0.75, ny: 0.3 },
      { nx: 0.5, ny: 0.7 }, { nx: 0.2, ny: 0.8 },
      { nx: 0.8, ny: 0.6 },
    ]

    for (let i = 0; i < nodeCount; i++) {
      const stop = layer.stops[i]
      const pos = positions[i % positions.length]
      const cx = pos.nx * w
      const cy = pos.ny * h
      const radius = Math.max(w, h) * 0.6

      const color = oklchToRgba(stop.oklchL, stop.oklchC, stop.oklchH, stop.alpha)
      const fadeColor = oklchToRgba(stop.oklchL, stop.oklchC, stop.oklchH, stop.alpha * 0.3)

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
      grad.addColorStop(0, color)
      grad.addColorStop(0.4, color)
      grad.addColorStop(0.7, fadeColor)
      grad.addColorStop(1, 'rgba(0,0,0,0)')

      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    }

    ctx.globalCompositeOperation = 'source-over'

    // Apply grain on top of mesh
    if (layer.grain > 0) {
      renderGrain(ctx, w, h, layer.grain)
    }

    ctx.restore()
    return
  }

  // Create gradient based on type
  let gradient: CanvasGradient

  if (layer.gradientType === 'radial') {
    gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2)
  } else if (layer.gradientType === 'conic') {
    gradient = ctx.createConicGradient((layer.angle * Math.PI) / 180, w / 2, h / 2)
  } else {
    // Linear
    const angleRad = (layer.angle * Math.PI) / 180
    const cx = w / 2
    const cy = h / 2
    const len = Math.max(w, h)
    const dx = Math.cos(angleRad) * len / 2
    const dy = Math.sin(angleRad) * len / 2
    gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
  }

  // Add color stops using OKLCH
  for (const stop of layer.stops) {
    const color = oklchToRgba(stop.oklchL, stop.oklchC, stop.oklchH, stop.alpha)
    gradient.addColorStop(stop.position, color)
  }

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)

  // Grain overlay
  if (layer.grain > 0) {
    renderGrain(ctx, w, h, layer.grain)
  }

  ctx.restore()
}
