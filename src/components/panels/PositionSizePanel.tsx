import { useDesignStore } from '@/store/useDesignStore'
import { SliderField } from '@/components/controls/SliderField'
import { ScalarInput } from '@/components/controls/ScalarInput'
import { Lock, Unlock, FlipHorizontal2, FlipVertical2 } from 'lucide-react'
import type { Layer, TextLayer } from '@/types/design'

// A muted "Hug" tag shown on an auto-sized text axis, Figma-style — the field
// still shows the computed size, the tag marks that the axis hugs its content.
function HugTag() {
  return (
    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted-foreground/70">
      Hug
    </span>
  )
}

interface Props {
  layer: Layer
}

export function PositionSizePanel({ layer }: Props) {
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  if (layer.type === 'background') return null

  const locked = layer.aspectRatioLocked ?? false

  // Text auto-sizing drives the axes: auto-width hugs both, auto-height hugs H.
  const sizing = layer.type === 'text' ? (layer as TextLayer).textSizing ?? 'fixed' : 'fixed'
  const wHug = sizing === 'auto-width'
  const hHug = sizing === 'auto-width' || sizing === 'auto-height'

  return (
    <div className="space-y-3 pb-3 mb-3 border-b border-border">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        Position & Size
      </div>

      {/* Position */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[12px] text-muted-foreground">X</label>
          <ScalarInput className="h-8 text-[13px] tabular-nums" value={layer.x}
            onCommit={(x) => updateLayer(layer.id, { x })} />
        </div>
        <div className="space-y-1">
          <label className="text-[12px] text-muted-foreground">Y</label>
          <ScalarInput className="h-8 text-[13px] tabular-nums" value={layer.y}
            onCommit={(y) => updateLayer(layer.id, { y })} />
        </div>
      </div>

      {/* Size with aspect ratio lock */}
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-[12px] text-muted-foreground">W</label>
          <div className="relative">
            <ScalarInput className={`h-8 text-[13px] tabular-nums ${wHug ? 'pr-9' : ''}`} value={layer.width} min={1}
              onCommit={(w) => {
                if (locked && layer.width > 0) {
                  const ratio = layer.height / layer.width
                  updateLayer(layer.id, { width: w, height: Math.round(w * ratio) })
                } else {
                  updateLayer(layer.id, { width: w })
                }
              }} />
            {wHug && <HugTag />}
          </div>
        </div>

        {/* Lock toggle */}
        <button
          className={`
            p-1.5 rounded-[5px] transition-colors cursor-pointer mb-0.5
            ${locked ? 'bg-primary/10 text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted'}
          `}
          onClick={() => {
            pushSnapshot()
            updateLayer(layer.id, { aspectRatioLocked: !locked })
          }}
          title={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          aria-label={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
        >
          {locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
        </button>

        <div className="flex-1 space-y-1">
          <label className="text-[12px] text-muted-foreground">H</label>
          <div className="relative">
            <ScalarInput className={`h-8 text-[13px] tabular-nums ${hHug ? 'pr-9' : ''}`} value={layer.height} min={1}
              onCommit={(h) => {
                if (locked && layer.height > 0) {
                  const ratio = layer.width / layer.height
                  updateLayer(layer.id, { height: h, width: Math.round(h * ratio) })
                } else {
                  updateLayer(layer.id, { height: h })
                }
              }} />
            {hHug && <HugTag />}
          </div>
        </div>
      </div>

      {/* Flip */}
      <div className="flex gap-2">
        {([
          ['flipH', 'Flip horizontal', FlipHorizontal2] as const,
          ['flipV', 'Flip vertical', FlipVertical2] as const,
        ]).map(([key, title, Icon]) => {
          const active = !!layer[key]
          return (
            <button
              key={key}
              title={`${title} (Shift+${key === 'flipH' ? 'H' : 'V'})`}
              aria-label={title}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] rounded-[5px] transition-colors duration-150 cursor-pointer ${
                active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
              onClick={() => {
                pushSnapshot()
                updateLayer(layer.id, { [key]: !active })
              }}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          )
        })}
      </div>

      {/* Rotation */}
      <SliderField
        label="Rotation"
        value={layer.rotation}
        min={0}
        max={360}
        step={1}
        format={(v) => `${v}°`}
        snapTo={[0, 45, 90, 180, 270, 360]}
        onChange={(rotation) => updateLayer(layer.id, { rotation })}
      />

      {/* Opacity */}
      <SliderField
        label="Opacity"
        value={layer.opacity}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(opacity) => updateLayer(layer.id, { opacity })}
      />
    </div>
  )
}
