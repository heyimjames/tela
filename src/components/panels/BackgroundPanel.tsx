import { useDesignStore } from '@/store/useDesignStore'
import { BrandColorPicker } from '@/components/panels/BrandColorPicker'
import { SliderField } from '@/components/controls/SliderField'
import { getBrandColor } from '@/brand/palette'
import { SHADER_KINDS, SHADER_PALETTES, createShaderFill, FRAME_STEP_MS } from '@/engine/shaders'
import type { BackgroundLayer, BackgroundFill, GradientStop, BrandColor, ShaderFill } from '@/types/design'

export function BackgroundPanel() {
  const layers = useDesignStore((s) => s.document.layers)
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  const bgLayer = layers.find((l) => l.type === 'background') as BackgroundLayer | undefined
  if (!bgLayer) return null

  const fill = bgLayer.fill

  const setFillType = (type: BackgroundFill['type']) => {
    pushSnapshot()
    if (type === 'solid') {
      updateLayer<BackgroundLayer>(bgLayer.id, {
        fill: { type: 'solid', color: getBrandColor('cloud') },
      })
    } else if (type === 'gradient') {
      updateLayer<BackgroundLayer>(bgLayer.id, {
        fill: {
          type: 'gradient',
          gradientType: 'linear',
          angle: 135,
          stops: [
            { position: 0, color: getBrandColor('brand-dark') },
            { position: 1, color: getBrandColor('brand-primary') },
          ],
        },
      })
    } else if (type === 'shader') {
      updateLayer<BackgroundLayer>(bgLayer.id, { fill: createShaderFill() })
    } else if (type === 'image') {
      // Trigger file upload
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => {
          updateLayer<BackgroundLayer>(bgLayer.id, {
            fill: { type: 'image', imageUrl: ev.target?.result as string, fit: 'cover' },
          })
        }
        reader.readAsDataURL(file)
      }
      input.click()
    }
  }

  const updateShader = (patch: Partial<ShaderFill>, snapshot = false) => {
    if (fill.type !== 'shader') return
    if (snapshot) pushSnapshot()
    updateLayer<BackgroundLayer>(bgLayer.id, { fill: { ...fill, ...patch } })
  }

  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        Background
      </div>

      {/* Fill type selector */}
      <div className="flex gap-1">
        {(['solid', 'gradient', 'image', 'shader'] as const).map((type) => (
          <button
            key={type}
            className={`
              px-3 py-1.5 text-[11px] rounded-[5px] transition-colors duration-150
              ${fill.type === type
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'}
            `}
            onClick={() => setFillType(type)}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Solid fill */}
      {fill.type === 'solid' && (
        <BrandColorPicker
          label="Fill Color"
          value={fill.color}
          onChange={(color) => {
            pushSnapshot()
            updateLayer<BackgroundLayer>(bgLayer.id, {
              fill: { type: 'solid', color },
            })
          }}
        />
      )}

      {/* Gradient fill */}
      {fill.type === 'gradient' && (
        <div className="space-y-3">
          {/* Gradient type */}
          <div className="flex gap-1">
            {(['linear', 'radial'] as const).map((gt) => (
              <button
                key={gt}
                className={`
                  px-3 py-1.5 text-[11px] rounded-[5px] transition-colors duration-150
                  ${fill.gradientType === gt
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                `}
                onClick={() => {
                  pushSnapshot()
                  updateLayer<BackgroundLayer>(bgLayer.id, {
                    fill: { ...fill, gradientType: gt },
                  })
                }}
              >
                {gt.charAt(0).toUpperCase() + gt.slice(1)}
              </button>
            ))}
          </div>

          {/* Angle (linear only) */}
          {fill.gradientType === 'linear' && (
            <SliderField
              label="Angle"
              value={fill.angle}
              min={0}
              max={360}
              step={1}
              format={(v) => `${v}°`}
              snapTo={[0, 45, 90, 135, 180, 225, 270, 315, 360]}
              onChange={(angle) => {
                updateLayer<BackgroundLayer>(bgLayer.id, {
                  fill: { ...fill, angle },
                })
              }}
            />
          )}

          {/* Gradient stops */}
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
              Stops
            </div>
            {fill.stops.map((stop, i) => (
              <GradientStopEditor
                key={i}
                stop={stop}
                index={i}
                onChange={(updated) => {
                  const stops = [...fill.stops]
                  stops[i] = updated
                  updateLayer<BackgroundLayer>(bgLayer.id, {
                    fill: { ...fill, stops },
                  })
                }}
                onRemove={fill.stops.length > 2 ? () => {
                  pushSnapshot()
                  const stops = fill.stops.filter((_, idx) => idx !== i)
                  updateLayer<BackgroundLayer>(bgLayer.id, {
                    fill: { ...fill, stops },
                  })
                } : undefined}
              />
            ))}
            {fill.stops.length < 5 && (
              <button
                className="text-[11px] text-primary hover:underline"
                onClick={() => {
                  pushSnapshot()
                  const stops = [...fill.stops, { position: 1, color: getBrandColor('stone') }]
                  updateLayer<BackgroundLayer>(bgLayer.id, {
                    fill: { ...fill, stops },
                  })
                }}
              >
                + Add stop
              </button>
            )}
          </div>
        </div>
      )}

      {/* Image fill controls */}
      {fill.type === 'image' && (
        <div className="space-y-3">
          <label
            className="block w-full py-2.5 text-center text-[13px] bg-muted text-muted-foreground rounded-[5px] cursor-pointer hover:bg-muted/80 transition-colors"
          >
            Replace Image
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                pushSnapshot()
                const reader = new FileReader()
                reader.onload = (ev) => {
                  updateLayer<BackgroundLayer>(bgLayer.id, {
                    fill: { type: 'image', imageUrl: ev.target?.result as string, fit: fill.fit },
                  })
                }
                reader.readAsDataURL(file)
              }}
            />
          </label>
          <div className="space-y-1.5">
            <label className="text-[13px] text-muted-foreground font-normal">Fit</label>
            <div className="flex gap-1">
              {(['cover', 'contain', 'fill'] as const).map((fit) => (
                <button
                  key={fit}
                  className={`
                    flex-1 py-1.5 text-[12px] rounded-[5px] transition-colors duration-150
                    ${fill.fit === fit
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                  `}
                  onClick={() => {
                    pushSnapshot()
                    updateLayer<BackgroundLayer>(bgLayer.id, {
                      fill: { ...fill, fit },
                    })
                  }}
                >
                  {fit.charAt(0).toUpperCase() + fit.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Shader fill controls */}
      {fill.type === 'shader' && (
        <div className="space-y-3">
          {/* Shader kind */}
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
              Style
            </div>
            <div className="grid grid-cols-3 gap-1">
              {SHADER_KINDS.map(({ kind, label, blurb }) => (
                <button
                  key={kind}
                  title={blurb}
                  aria-pressed={fill.kind === kind}
                  className={`px-2 py-1.5 text-[11px] rounded-[5px] transition-colors duration-150 cursor-pointer active:scale-[0.96] ${
                    fill.kind === kind
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                  onClick={() => updateShader({ kind }, true)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Brand palettes */}
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
              Palette
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SHADER_PALETTES.map((p) => {
                const active = p.colors.join() === fill.colors.join()
                return (
                  <button
                    key={p.name}
                    title={p.name}
                    aria-label={`${p.name} palette`}
                    aria-pressed={active}
                    className={`flex h-7 overflow-hidden rounded-[5px] cursor-pointer transition-[box-shadow,transform] duration-150 active:scale-[0.96] ${
                      active ? 'ring-2 ring-ring ring-offset-1 ring-offset-background' : 'hover:opacity-80'
                    }`}
                    onClick={() => updateShader({ colors: p.colors }, true)}
                  >
                    {p.colors.map((c, i) => (
                      <span key={i} className="block w-5 h-full" style={{ backgroundColor: c }} />
                    ))}
                  </button>
                )
              })}
            </div>
          </div>

          <SliderField
            label="Intensity"
            value={fill.intensity}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(intensity) => updateShader({ intensity })}
          />
          <SliderField
            label="Scale"
            value={fill.scale}
            min={0.25}
            max={3}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(scale) => updateShader({ scale })}
          />
          <SliderField
            label="Rotation"
            value={fill.rotation}
            min={0}
            max={360}
            step={1}
            format={(v) => `${v}°`}
            snapTo={[0, 45, 90, 135, 180, 225, 270, 315, 360]}
            onChange={(rotation) => updateShader({ rotation })}
          />
          <SliderField
            label="Grain"
            value={fill.grain}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(grain) => updateShader({ grain })}
          />
          <SliderField
            label="Variation"
            value={Math.round(fill.frame / FRAME_STEP_MS)}
            min={0}
            max={24}
            step={1}
            format={(v) => `${v + 1}`}
            onChange={(v) => updateShader({ frame: v * FRAME_STEP_MS })}
          />

          {/* Live motion speed (preview only) */}
          <SliderField
            label="Preview motion"
            value={fill.speed}
            min={0}
            max={3}
            step={0.1}
            format={(v) => (v === 0 ? 'Still' : `${v.toFixed(1)}×`)}
            onChange={(speed) => updateShader({ speed })}
          />

          <p className="text-[11px] leading-snug text-muted-foreground/60">
            Animated in the editor; exports as a still at the chosen variation.
          </p>
        </div>
      )}

      {/* Opacity */}
      <SliderField
        label="Opacity"
        value={bgLayer.opacity}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(opacity) => updateLayer(bgLayer.id, { opacity })}
      />
    </div>
  )
}

function GradientStopEditor({
  stop,
  index,
  onChange,
  onRemove,
}: {
  stop: GradientStop
  index: number
  onChange: (stop: GradientStop) => void
  onRemove?: () => void
}) {
  return (
    <div className="space-y-2 p-2 bg-muted/30 rounded-[5px]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Stop {index + 1}</span>
        {onRemove && (
          <button
            className="text-[10px] text-destructive hover:underline"
            onClick={onRemove}
          >
            Remove
          </button>
        )}
      </div>
      <SliderField
        label="Position"
        value={stop.position}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(position) => onChange({ ...stop, position })}
      />
      <BrandColorPicker
        value={stop.color}
        onChange={(color: BrandColor) => onChange({ ...stop, color })}
      />
    </div>
  )
}
