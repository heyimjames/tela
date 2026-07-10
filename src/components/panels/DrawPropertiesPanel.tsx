import { useDesignStore } from '@/store/useDesignStore'
import { BrandColorPicker } from '@/components/panels/BrandColorPicker'
import { SliderField } from '@/components/controls/SliderField'
import type { DrawLayer } from '@/types/design'

interface Props {
  layer: DrawLayer
}

/**
 * Restyle a committed stroke. The outline is regenerated from `points` via
 * getDrawPath at render time, so changing colour / width / taper / pressure /
 * smoothing here re-renders the same stroke with the new style — no redraw
 * needed. Mirrors the DrawToolPanel controls for a consistent mental model.
 */
export function DrawPropertiesPanel({ layer }: Props) {
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)
  const isHighlighter = layer.mode === 'highlighter'

  // Fall back to the engine's per-mode defaults for strokes drawn before these
  // fields existed, so the sliders start where the stroke actually renders.
  const taper = layer.taper ?? (isHighlighter ? 0 : 1)
  const thinning = layer.thinning ?? (isHighlighter ? 0 : 0.55)
  const smoothing = layer.streamline ?? (isHighlighter ? 0.4 : 0.5)

  const commit = (patch: Partial<DrawLayer>) => {
    pushSnapshot()
    updateLayer<DrawLayer>(layer.id, patch)
  }

  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        {isHighlighter ? 'Marker' : 'Pen'}
      </div>

      <BrandColorPicker label="Color" value={layer.color} onChange={(color) => commit({ color })} />
      <SliderField
        label={isHighlighter ? 'Marker width' : 'Stroke width'}
        value={layer.strokeWidth}
        min={isHighlighter ? 6 : 1}
        max={isHighlighter ? 100 : 80}
        step={1}
        format={(v) => `${Math.round(v)}px`}
        onChange={(strokeWidth) => commit({ strokeWidth })}
      />

      {!isHighlighter && (
        <>
          <SliderField
            label="Taper"
            value={taper}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v <= 0.02 ? 'Round' : v >= 0.98 ? 'Pointed' : `${Math.round(v * 100)}%`)}
            onChange={(taper) => commit({ taper })}
          />
          <SliderField
            label="Pressure"
            value={thinning}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v <= 0.02 ? 'Uniform' : `${Math.round(v * 100)}%`)}
            onChange={(thinning) => commit({ thinning })}
          />
          <SliderField
            label="Smoothing"
            value={smoothing}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(streamline) => commit({ streamline })}
          />
        </>
      )}
    </div>
  )
}
