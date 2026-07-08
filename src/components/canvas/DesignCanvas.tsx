import { useRef, useEffect, useCallback } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { renderToContext } from '@/engine/compositor'

export function DesignCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const doc = useDesignStore.getState().document
    const zoom = useDesignStore.getState().zoom
    const editingTextLayerId = useDesignStore.getState().editingTextLayerId

    const w = Math.max(100, (doc.format?.width ?? 1200) * zoom)
    const h = Math.max(100, (doc.format?.height ?? 627) * zoom)

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    ctx.scale(dpr, dpr)
    // Shader backgrounds animate live via <ShaderBackgroundOverlay/> behind this
    // canvas, so skip drawing them here (leave the bg region transparent).
    // Hide the text layer being edited so it doesn't ghost behind the textarea.
    renderToContext(ctx, doc, zoom, {
      suppressShaderBg: true,
      hideLayerId: editingTextLayerId ?? undefined,
    })
  }, [])

  useEffect(() => {
    draw()
    const unsub = useDesignStore.subscribe(() => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(draw)
    })
    return () => { unsub(); cancelAnimationFrame(rafRef.current) }
  }, [draw])

  return <canvas ref={canvasRef} className="block pointer-events-none" />
}
