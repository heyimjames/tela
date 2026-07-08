import { Pen, Highlighter } from 'lucide-react'
import { useUIStore } from '@/store/useUIStore'
import { BrandColorPicker } from '@/components/panels/BrandColorPicker'
import { SliderField } from '@/components/controls/SliderField'
import type { DrawMode } from '@/types/design'

const MODES: { id: DrawMode; label: string; Icon: typeof Pen }[] = [
  { id: 'pen', label: 'Pen', Icon: Pen },
  { id: 'highlighter', label: 'Marker', Icon: Highlighter },
]

/**
 * Draw tool settings — shown in the right sidebar while the draw tool is active
 * (tool-aware inspector). Toggles between a pressure-variable **pen** (tapered,
 * velocity-driven width) and a translucent **highlighter** (constant width,
 * multiply blend). Pen and highlighter keep independent colour + width so
 * switching modes never clobbers the other's settings. The live preview and the
 * committed DrawLayer both read these from the UI store.
 */
export function DrawToolPanel() {
  const mode = useUIStore((s) => s.drawMode)
  const setMode = useUIStore((s) => s.setDrawMode)
  const isHighlighter = mode === 'highlighter'

  const drawColor = useUIStore((s) => s.drawColor)
  const highlighterColor = useUIStore((s) => s.highlighterColor)
  const drawWidth = useUIStore((s) => s.drawWidth)
  const highlighterWidth = useUIStore((s) => s.highlighterWidth)
  const setDrawColor = useUIStore((s) => s.setDrawColor)
  const setHighlighterColor = useUIStore((s) => s.setHighlighterColor)
  const setDrawWidth = useUIStore((s) => s.setDrawWidth)
  const setHighlighterWidth = useUIStore((s) => s.setHighlighterWidth)

  const color = isHighlighter ? highlighterColor : drawColor
  const setColor = isHighlighter ? setHighlighterColor : setDrawColor
  const width = isHighlighter ? highlighterWidth : drawWidth
  const setWidth = isHighlighter ? setHighlighterWidth : setDrawWidth

  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        Draw
      </div>

      {/* Pen ⇄ highlighter segmented toggle. */}
      <div className="flex gap-1">
        {MODES.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`
              flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] rounded-[5px]
              transition-[color,background-color,transform] duration-150 active:scale-[0.97]
              ${mode === id
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'}
            `}
            onClick={() => setMode(id)}
          >
            <Icon className="size-3.5" strokeWidth={2} />
            {label}
          </button>
        ))}
      </div>

      <BrandColorPicker label="Color" value={color} onChange={setColor} />
      <SliderField
        label={isHighlighter ? 'Marker width' : 'Stroke width'}
        value={width}
        min={isHighlighter ? 6 : 1}
        max={isHighlighter ? 60 : 40}
        step={1}
        format={(v) => `${Math.round(v)}px`}
        onChange={setWidth}
      />
      <p className="text-[11px] leading-relaxed text-muted-foreground/60">
        {isHighlighter
          ? 'Translucent marker — overlapping colours blend without darkening. Each stroke becomes a layer you can move, resize, and restyle.'
          : 'Pressure-variable ink that tapers and thins with speed. Each stroke becomes a layer you can move, resize, and restyle.'}
      </p>
    </div>
  )
}
