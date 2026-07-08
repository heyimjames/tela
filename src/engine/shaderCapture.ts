import { createRoot, type Root } from 'react-dom/client'
// From shaders-react (the declared dependency) rather than the core
// `@paper-design/shaders` package, which is only a transitive dep and isn't
// resolvable under pnpm's strict node_modules during the production build.
import { isPaperShaderElement } from '@paper-design/shaders-react'
import type { ShaderFill } from '@/types/design'
import { renderShaderElement } from '@/components/canvas/ShaderBackground'

/**
 * Renders a shader background to a static bitmap for the Canvas-2D export pipeline.
 *
 * Paper Shaders are WebGL React components, so we mount one into a detached,
 * off-screen host at the requested resolution, freeze it (`speed: 0`) at the
 * fill's deterministic `frame`, force a synchronous render via `setFrame`, then
 * copy the WebGL canvas into a plain 2D canvas the compositor can `drawImage`.
 *
 * Results are memoised by fill signature + size so repeated exports / re-renders
 * of the same design don't re-mount WebGL every time.
 */

const cache = new Map<string, HTMLCanvasElement>()

function signature(fill: ShaderFill, w: number, h: number): string {
  return JSON.stringify([fill.kind, fill.colors, fill.frame, fill.intensity, fill.scale, fill.rotation, fill.grain, w, h])
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

function findShaderMount(host: HTMLElement) {
  for (const node of [host, ...host.querySelectorAll<HTMLElement>('*')]) {
    if (isPaperShaderElement(node)) return node.paperShaderMount
  }
  return undefined
}

function solidFallback(fill: ShaderFill, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.round(w)
  c.height = Math.round(h)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = fill.colors[0] ?? '#0017c7'
  ctx.fillRect(0, 0, c.width, c.height)
  return c
}

export async function captureShaderFrame(
  fill: ShaderFill,
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  const key = signature(fill, width, height)
  const hit = cache.get(key)
  if (hit) return hit

  const host = document.createElement('div')
  host.style.cssText =
    `position:fixed;left:-99999px;top:0;width:${Math.round(width)}px;height:${Math.round(height)}px;` +
    `pointer-events:none;opacity:0;z-index:-1;`
  document.body.appendChild(host)

  let root: Root | null = null
  try {
    root = createRoot(host)
    // Freeze at the chosen frame so the still is reproducible.
    root.render(renderShaderElement(fill, { speed: 0, frame: fill.frame }))

    // Wait for the WebGL canvas to mount and size itself (ResizeObserver is async).
    let webglCanvas: HTMLCanvasElement | null = null
    for (let i = 0; i < 40; i++) {
      await nextFrame()
      const found = host.querySelector('canvas')
      if (found && found.width > 0 && found.height > 0) {
        webglCanvas = found
        break
      }
    }
    if (!webglCanvas) return solidFallback(fill, width, height)

    // Force a deterministic render at exactly this frame, then give the GPU a beat.
    findShaderMount(host)?.setFrame(fill.frame)
    await nextFrame()

    // Copy WebGL pixels into a detached 2D canvas before we unmount.
    const out = document.createElement('canvas')
    out.width = webglCanvas.width
    out.height = webglCanvas.height
    out.getContext('2d')!.drawImage(webglCanvas, 0, 0)

    cache.set(key, out)
    return out
  } catch {
    return solidFallback(fill, width, height)
  } finally {
    // Defer unmount one tick to avoid React's "synchronous unmount during render" warning.
    const r = root
    setTimeout(() => {
      r?.unmount()
      host.remove()
    }, 0)
  }
}

/** Collect shader-background captures for a document, keyed by layer id. */
export async function captureDesignShaders(
  layers: { id: string; type: string; fill?: unknown }[],
  width: number,
  height: number,
): Promise<Map<string, HTMLCanvasElement>> {
  const map = new Map<string, HTMLCanvasElement>()
  for (const layer of layers) {
    if (layer.type !== 'background') continue
    const fill = layer.fill as ShaderFill | undefined
    if (fill?.type !== 'shader') continue
    map.set(layer.id, await captureShaderFrame(fill, width, height))
  }
  return map
}
