import type { CSSProperties, ReactElement } from 'react'
import { motion } from 'motion/react'
import {
  MeshGradient,
  Warp,
  GrainGradient,
  Swirl,
  Dithering,
  Waves,
} from '@paper-design/shaders-react'
import type { ShaderFill } from '@/types/design'
import { useDesignStore } from '@/store/useDesignStore'

/** Clamp a 0–1 generic value into a target range. */
const lerp = (t: number, a: number, b: number) => a + (b - a) * Math.max(0, Math.min(1, t))

interface RenderOpts {
  /** Overrides fill.speed (export passes 0 to freeze the frame). */
  speed?: number
  /** Overrides fill.frame. */
  frame?: number
  style?: CSSProperties
}

const FILL_STYLE: CSSProperties = { width: '100%', height: '100%', display: 'block' }

/**
 * Maps a {@link ShaderFill} onto the matching Paper Shader component, translating
 * our unified param surface (intensity / scale / rotation / grain) into each
 * shader's specific props. Used by both the live editor overlay and the offscreen
 * export capture, so the preview and the exported still stay identical.
 */
export function renderShaderElement(fill: ShaderFill, opts: RenderOpts = {}): ReactElement {
  const speed = opts.speed ?? fill.speed
  const frame = opts.frame ?? fill.frame
  const style = { ...FILL_STYLE, ...opts.style }
  const colors = fill.colors.length ? fill.colors : ['#0017c7']
  const common = { speed, frame, scale: fill.scale, rotation: fill.rotation, fit: 'cover' as const, style }

  switch (fill.kind) {
    case 'warp':
      return (
        <Warp
          {...common}
          colors={colors}
          distortion={lerp(fill.intensity, 0.1, 0.45)}
          swirl={lerp(fill.intensity, 0.2, 0.9)}
          softness={0.9}
          proportion={0.45}
        />
      )
    case 'grainGradient':
      return (
        <GrainGradient
          {...common}
          colors={colors}
          colorBack={colors[colors.length - 1]}
          intensity={lerp(fill.intensity, 0.1, 0.6)}
          noise={lerp(fill.grain, 0.25, 1)}
          softness={0.8}
        />
      )
    case 'swirl':
      return (
        <Swirl
          {...common}
          colors={colors}
          bandCount={Math.round(lerp(fill.intensity, 2, 9))}
          twist={lerp(fill.intensity, 0.1, 0.9)}
          noise={fill.grain}
        />
      )
    case 'dithering':
      return (
        <Dithering
          {...common}
          colorFront={colors[0]}
          colorBack={colors[1] ?? '#f8f8f3'}
          size={Math.round(lerp(1 - fill.intensity, 1, 6))}
        />
      )
    case 'waves':
      return (
        <Waves
          {...common}
          colorFront={colors[0]}
          colorBack={colors[1] ?? '#f8f8f3'}
          amplitude={lerp(fill.intensity, 0.2, 0.9)}
          frequency={lerp(fill.scale, 0.6, 1.4)}
        />
      )
    case 'meshGradient':
    default:
      return (
        <MeshGradient
          {...common}
          colors={colors}
          distortion={lerp(fill.intensity, 0.4, 1)}
          swirl={lerp(fill.intensity, 0, 0.6)}
          grainOverlay={fill.grain}
        />
      )
  }
}

/**
 * Live, animated shader sitting *behind* the 2D canvas in the editor (the canvas
 * renders a transparent background for shader fills, so this shows through).
 * Sits at z-index -1 inside the transformed artboard's stacking context.
 */
export function ShaderBackgroundOverlay() {
  const bgLayer = useDesignStore((s) =>
    s.document.layers.find((l) => l.type === 'background'),
  )

  if (!bgLayer || bgLayer.type !== 'background') return null
  const fill = bgLayer.fill
  if (fill.type !== 'shader') return null
  if (!bgLayer.visible || bgLayer.opacity <= 0) return null

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden"
      style={{ zIndex: -1 }}
      aria-hidden
      // Bloom in when a shader background first appears (switch to shader / load).
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: bgLayer.opacity, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {renderShaderElement(fill)}
    </motion.div>
  )
}
