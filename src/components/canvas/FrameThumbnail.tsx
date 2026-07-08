import { useEffect, useState } from 'react'
import { SvgScene } from '@/components/canvas/DesignSvgScene'
import { captureDesignShaders } from '@/engine/shaderCapture'
import type { Frame } from '@/types/workspace'
import type { DesignDocument } from '@/types/design'

/**
 * Static render of a non-active frame on the multi-frame canvas.
 *
 * Renders through the SAME <SvgScene> as the live editing surface, so a frame's
 * thumbnail matches exactly what you see when it's active — one renderer, no
 * drift from the old Canvas-2D compositor. Shader backgrounds have no vector
 * form, so they're captured to a still <image> (async, cached); non-shader
 * frames render instantly.
 */
export function FrameThumbnail({ frame, zoom }: { frame: Frame; zoom: number }) {
  const [stills, setStills] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    captureDesignShaders(frame.layers, frame.format.width, frame.format.height).then(
      (canvases) => {
        if (cancelled || canvases.size === 0) return
        const map: Record<string, string> = {}
        canvases.forEach((canvas, id) => {
          map[id] = canvas.toDataURL('image/png')
        })
        setStills(map)
      },
    )
    return () => {
      cancelled = true
    }
  }, [frame.layers, frame.format.width, frame.format.height])

  const doc = { format: frame.format, layers: frame.layers } as DesignDocument
  return <SvgScene doc={doc} zoom={zoom} shaderStills={stills} className="block h-full w-full" />
}
