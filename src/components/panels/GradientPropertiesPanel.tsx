import { useDesignStore } from '@/store/useDesignStore'
import { SliderField } from '@/components/controls/SliderField'
import type { GradientLayer, GradientType, GradientColorStop } from '@/types/design'

// Saturated OKLCH gradient presets
const GRADIENT_PRESETS: Array<{
  name: string
  stops: GradientColorStop[]
  angle: number
  type: GradientType
}> = [
  {
    name: 'Brand Blue',
    angle: 135,
    type: 'linear',
    stops: [
      { position: 0, oklchL: 0.45, oklchC: 0.18, oklchH: 265, alpha: 1 },
      { position: 1, oklchL: 0.35, oklchC: 0.15, oklchH: 280, alpha: 1 },
    ],
  },
  {
    name: 'Sunset Ember',
    angle: 135,
    type: 'linear',
    stops: [
      { position: 0, oklchL: 0.65, oklchC: 0.22, oklchH: 30, alpha: 1 },
      { position: 0.5, oklchL: 0.6, oklchC: 0.2, oklchH: 15, alpha: 1 },
      { position: 1, oklchL: 0.5, oklchC: 0.18, oklchH: 350, alpha: 1 },
    ],
  },
  {
    name: 'Ocean Teal',
    angle: 180,
    type: 'linear',
    stops: [
      { position: 0, oklchL: 0.55, oklchC: 0.12, oklchH: 195, alpha: 1 },
      { position: 1, oklchL: 0.4, oklchC: 0.1, oklchH: 220, alpha: 1 },
    ],
  },
  {
    name: 'Warm Gold',
    angle: 135,
    type: 'linear',
    stops: [
      { position: 0, oklchL: 0.75, oklchC: 0.14, oklchH: 80, alpha: 1 },
      { position: 1, oklchL: 0.6, oklchC: 0.16, oklchH: 60, alpha: 1 },
    ],
  },
  {
    name: 'Aurora',
    angle: 135,
    type: 'linear',
    stops: [
      { position: 0, oklchL: 0.55, oklchC: 0.2, oklchH: 300, alpha: 1 },
      { position: 0.5, oklchL: 0.5, oklchC: 0.18, oklchH: 260, alpha: 1 },
      { position: 1, oklchL: 0.45, oklchC: 0.15, oklchH: 200, alpha: 1 },
    ],
  },
  {
    name: 'Midnight',
    angle: 180,
    type: 'linear',
    stops: [
      { position: 0, oklchL: 0.35, oklchC: 0.12, oklchH: 270, alpha: 1 },
      { position: 1, oklchL: 0.2, oklchC: 0.06, oklchH: 250, alpha: 1 },
    ],
  },
  {
    name: 'Forest',
    angle: 135,
    type: 'radial',
    stops: [
      { position: 0, oklchL: 0.55, oklchC: 0.14, oklchH: 155, alpha: 1 },
      { position: 1, oklchL: 0.35, oklchC: 0.1, oklchH: 170, alpha: 1 },
    ],
  },
  {
    name: 'Rose',
    angle: 0,
    type: 'radial',
    stops: [
      { position: 0, oklchL: 0.7, oklchC: 0.16, oklchH: 10, alpha: 1 },
      { position: 1, oklchL: 0.5, oklchC: 0.2, oklchH: 350, alpha: 1 },
    ],
  },
]

interface Props {
  layer: GradientLayer
}

export function GradientPropertiesPanel({ layer }: Props) {
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        Gradient
      </div>

      {/* Presets */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Presets</label>
        <div className="grid grid-cols-4 gap-1.5">
          {GRADIENT_PRESETS.map((preset) => (
            <button
              key={preset.name}
              className="aspect-square rounded-[5px] border border-border hover:border-primary/40 transition-[border-color,transform] cursor-pointer overflow-hidden active:scale-[0.96]"
              title={preset.name}
              aria-label={preset.name}
              style={{
                background: presetToCss(preset),
              }}
              onClick={() => {
                pushSnapshot()
                updateLayer<GradientLayer>(layer.id, {
                  gradientType: preset.type,
                  angle: preset.angle,
                  stops: preset.stops,
                })
              }}
            />
          ))}
        </div>
      </div>

      {/* Type */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Type</label>
        <div className="flex gap-1">
          {(['linear', 'radial', 'conic', 'mesh'] as GradientType[]).map((t) => (
            <button
              key={t}
              className={`
                flex-1 py-1.5 text-[12px] rounded-[5px] transition-colors duration-150 cursor-pointer
                ${layer.gradientType === t
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'}
              `}
              onClick={() => {
                pushSnapshot()
                updateLayer<GradientLayer>(layer.id, { gradientType: t })
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Angle */}
      <SliderField
        label="Angle"
        value={layer.angle}
        min={0}
        max={360}
        step={1}
        format={(v) => `${v}°`}
        snapTo={[0, 45, 90, 135, 180, 225, 270, 315, 360]}
        onChange={(angle) => updateLayer<GradientLayer>(layer.id, { angle })}
      />

      {/* Grain */}
      <SliderField
        label="Grain"
        value={layer.grain}
        min={0}
        max={1}
        step={0.01}
        format={(v) => v === 0 ? 'Off' : `${Math.round(v * 100)}%`}
        onChange={(grain) => updateLayer<GradientLayer>(layer.id, { grain })}
      />

      {/* Color stops */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[13px] text-muted-foreground font-normal">Color Stops</label>
          {layer.stops.length < 5 && (
            <button
              className="text-[12px] text-primary hover:underline cursor-pointer"
              onClick={() => {
                pushSnapshot()
                updateLayer<GradientLayer>(layer.id, {
                  stops: [...layer.stops, { position: 1, oklchL: 0.5, oklchC: 0.15, oklchH: 180, alpha: 1 }],
                })
              }}
            >
              + Add
            </button>
          )}
        </div>

        {layer.stops.map((stop, i) => (
          <div key={i} className="p-2 bg-muted/30 rounded-[5px] space-y-2">
            <div className="flex items-center justify-between">
              <div
                className="w-6 h-6 rounded-[3px] border border-border"
                style={{ background: `oklch(${stop.oklchL} ${stop.oklchC} ${stop.oklchH})` }}
              />
              <span className="text-[11px] text-muted-foreground">Stop {i + 1}</span>
              {layer.stops.length > 2 && (
                <button
                  className="text-[10px] text-destructive hover:underline cursor-pointer"
                  onClick={() => {
                    pushSnapshot()
                    updateLayer<GradientLayer>(layer.id, {
                      stops: layer.stops.filter((_, idx) => idx !== i),
                    })
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            <SliderField label="Position" value={stop.position} min={0} max={1} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(position) => {
                const stops = [...layer.stops]
                stops[i] = { ...stops[i], position }
                updateLayer<GradientLayer>(layer.id, { stops })
              }}
            />
            <SliderField label="Lightness" value={stop.oklchL} min={0.1} max={0.95} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(oklchL) => {
                const stops = [...layer.stops]
                stops[i] = { ...stops[i], oklchL }
                updateLayer<GradientLayer>(layer.id, { stops })
              }}
            />
            <SliderField label="Chroma" value={stop.oklchC} min={0} max={0.35} step={0.005}
              format={(v) => v.toFixed(3)}
              onChange={(oklchC) => {
                const stops = [...layer.stops]
                stops[i] = { ...stops[i], oklchC }
                updateLayer<GradientLayer>(layer.id, { stops })
              }}
            />
            <SliderField label="Hue" value={stop.oklchH} min={0} max={360} step={1}
              format={(v) => `${v}°`}
              onChange={(oklchH) => {
                const stops = [...layer.stops]
                stops[i] = { ...stops[i], oklchH }
                updateLayer<GradientLayer>(layer.id, { stops })
              }}
            />
          </div>
        ))}
      </div>

      {/* Border radius */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Corner Radius</label>
        <div className="flex gap-1 flex-wrap">
          {[
            { label: '0', value: 0 },
            { label: '7px', value: 7 },
            { label: '12px', value: 12 },
            { label: 'Full', value: 9999 },
          ].map((r) => (
            <button
              key={r.value}
              className={`
                px-2.5 py-1 text-[12px] rounded-[5px] transition-colors duration-150 cursor-pointer
                ${layer.borderRadius === r.value
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'}
              `}
              onClick={() => updateLayer<GradientLayer>(layer.id, { borderRadius: r.value })}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function presetToCss(preset: typeof GRADIENT_PRESETS[0]): string {
  const stops = preset.stops
    .map((s) => `oklch(${s.oklchL} ${s.oklchC} ${s.oklchH}) ${s.position * 100}%`)
    .join(', ')

  if (preset.type === 'radial') return `radial-gradient(circle, ${stops})`
  if (preset.type === 'conic') return `conic-gradient(from ${preset.angle}deg, ${stops})`
  return `linear-gradient(${preset.angle}deg, ${stops})`
}
