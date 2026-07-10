import { Pen, Highlighter } from 'lucide-react'
import { useUIStore } from '@/store/useUIStore'
import { BrandColorPicker } from '@/components/panels/BrandColorPicker'
import { SliderField } from '@/components/controls/SliderField'
import { getDrawPath, HIGHLIGHTER_OPACITY } from '@/engine/freehand'
import type { BrandColor, DrawMode } from '@/types/design'

const MODES: { id: DrawMode; label: string; Icon: typeof Pen }[] = [
  { id: 'pen', label: 'Pen', Icon: Pen },
  { id: 'highlighter', label: 'Marker', Icon: Highlighter },
]

// Quick-pick sizes (S/M/L/XL), tldraw-style — faster than dragging the slider.
const PEN_SIZES = [3, 6, 12, 24]
const MARKER_SIZES = [12, 22, 40, 64]
const SIZE_LABELS = ['S', 'M', 'L', 'XL']

// A sample squiggle (in a 600×120 space) drawn with the current settings, so you
// see the actual pen before committing. Varying segment lengths let the
// velocity-simulated pressure show, the way a real stroke would.
const PREVIEW_PTS: [number, number][] = [
  [40, 88], [130, 34], [220, 86], [310, 36], [400, 84], [500, 46], [568, 72],
]

function PenPreview({ mode, width, color, thinning, taper, smoothing }: {
  mode: DrawMode; width: number; color: BrandColor; thinning: number; taper: number; smoothing: number
}) {
  const isHighlighter = mode === 'highlighter'
  const d = getDrawPath({
    points: PREVIEW_PTS,
    size: width,
    mode,
    thinning: isHighlighter ? undefined : thinning,
    taper: isHighlighter ? undefined : taper,
    streamline: isHighlighter ? undefined : smoothing,
    last: true,
  })
  return (
    <svg viewBox="0 0 600 120" preserveAspectRatio="xMidYMid meet" className="w-full h-14 rounded-[6px] bg-muted/40">
      <path
        d={d}
        fill={color.hex}
        fillOpacity={isHighlighter ? HIGHLIGHTER_OPACITY : 1}
        style={isHighlighter ? { mixBlendMode: 'multiply' } : undefined}
      />
    </svg>
  )
}

// A dot of proportional size for the S/M/L/XL buttons.
function SizeDot({ px }: { px: number }) {
  const d = Math.max(4, Math.min(18, 4 + px * 0.5))
  return <span className="rounded-full bg-current" style={{ width: d, height: d }} />
}

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

  // Pen shape controls (the highlighter is a constant-width round marker).
  const thinning = useUIStore((s) => s.drawThinning)
  const taper = useUIStore((s) => s.drawTaper)
  const smoothing = useUIStore((s) => s.drawSmoothing)
  const setThinning = useUIStore((s) => s.setDrawThinning)
  const setTaper = useUIStore((s) => s.setDrawTaper)
  const setSmoothing = useUIStore((s) => s.setDrawSmoothing)

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

      {/* What the current pen will actually look like. */}
      <PenPreview mode={mode} width={width} color={color} thinning={thinning} taper={taper} smoothing={smoothing} />

      <BrandColorPicker label="Color" value={color} onChange={setColor} />

      {/* Quick sizes + a slider for fine control. */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">{isHighlighter ? 'Marker width' : 'Stroke width'}</label>
        <div className="flex gap-1">
          {(isHighlighter ? MARKER_SIZES : PEN_SIZES).map((sz, i) => {
            const active = Math.round(width) === sz
            return (
              <button
                key={sz}
                title={`${SIZE_LABELS[i]} — ${sz}px`}
                aria-label={`${SIZE_LABELS[i]} (${sz}px)`}
                className={`flex-1 flex items-center justify-center h-9 rounded-[5px] transition-colors duration-150 cursor-pointer ${
                  active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
                onClick={() => setWidth(sz)}
              >
                <SizeDot px={sz} />
              </button>
            )
          })}
        </div>
        <SliderField
          label=""
          value={width}
          min={isHighlighter ? 6 : 1}
          max={isHighlighter ? 100 : 80}
          step={1}
          format={(v) => `${Math.round(v)}px`}
          onChange={setWidth}
        />
      </div>

      {/* Pen-only shape controls. The highlighter is a constant-width round
          marker, so taper / pressure / smoothing don't apply to it. */}
      {!isHighlighter && (
        <>
          <SliderField
            label="Taper"
            value={taper}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v <= 0.02 ? 'Round' : v >= 0.98 ? 'Pointed' : `${Math.round(v * 100)}%`)}
            onChange={setTaper}
          />
          <SliderField
            label="Pressure"
            value={thinning}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v <= 0.02 ? 'Uniform' : `${Math.round(v * 100)}%`)}
            onChange={setThinning}
          />
          <SliderField
            label="Smoothing"
            value={smoothing}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={setSmoothing}
          />
        </>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground/60">
        {isHighlighter
          ? 'Translucent marker — overlapping colours blend without darkening. Each stroke becomes a layer you can move, resize, and restyle.'
          : 'Pressure-variable ink. Taper shapes the ends (round → pointed), Pressure sets how much speed thins the line. Each stroke becomes a layer you can move, resize, and restyle.'}
      </p>
    </div>
  )
}
