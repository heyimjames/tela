import { useDesignStore } from '@/store/useDesignStore'
import { SliderField } from '@/components/controls/SliderField'
import type { Layer, DropShadow } from '@/types/design'

interface Props {
  layer: Layer
}

export function EffectsPanel({ layer }: Props) {
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  const shadow = layer.shadow
  const hasShadow = !!shadow

  const toggleShadow = () => {
    pushSnapshot()
    if (hasShadow) {
      updateLayer(layer.id, { shadow: undefined })
    } else {
      updateLayer(layer.id, {
        shadow: { offsetX: 0, offsetY: 4, blur: 12, color: 'rgba(17,17,17,0.15)' },
      })
    }
  }

  const updateShadow = (updates: Partial<DropShadow>) => {
    if (!shadow) return
    updateLayer(layer.id, {
      shadow: { ...shadow, ...updates },
    })
  }

  return (
    <div className="space-y-3 pt-3 mt-3 border-t border-border">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
          Effects
        </span>
      </div>

      {/* Drop Shadow toggle */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted-foreground">Drop Shadow</span>
        <button
          className={`
            w-9 h-5 rounded-full transition-colors duration-150 cursor-pointer relative
            ${hasShadow ? 'bg-primary' : 'bg-muted'}
          `}
          onClick={toggleShadow}
        >
          <div
            className={`
              absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-150
              ${hasShadow ? 'translate-x-4' : 'translate-x-0.5'}
            `}
          />
        </button>
      </div>

      {hasShadow && (
        <div className="space-y-2 pl-1">
          <SliderField
            label="X Offset"
            value={shadow.offsetX}
            min={-20}
            max={20}
            step={1}
            format={(v) => `${v}px`}
            onChange={(offsetX) => updateShadow({ offsetX })}
          />
          <SliderField
            label="Y Offset"
            value={shadow.offsetY}
            min={-20}
            max={20}
            step={1}
            format={(v) => `${v}px`}
            onChange={(offsetY) => updateShadow({ offsetY })}
          />
          <SliderField
            label="Blur"
            value={shadow.blur}
            min={0}
            max={40}
            step={1}
            format={(v) => `${v}px`}
            onChange={(blur) => updateShadow({ blur })}
          />
          <div className="space-y-1.5">
            <label className="text-[13px] text-muted-foreground font-normal">Shadow Opacity</label>
            <div className="flex gap-1">
              {[
                { label: 'Subtle', value: 'rgba(17,17,17,0.08)' },
                { label: 'Light', value: 'rgba(17,17,17,0.15)' },
                { label: 'Medium', value: 'rgba(17,17,17,0.25)' },
                { label: 'Strong', value: 'rgba(17,17,17,0.4)' },
              ].map((preset) => (
                <button
                  key={preset.label}
                  className={`
                    flex-1 py-1.5 text-[12px] rounded-[5px] transition-colors duration-150 cursor-pointer
                    ${shadow.color === preset.value
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                  `}
                  onClick={() => updateShadow({ color: preset.value })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Blur */}
      <SliderField
        label="Layer Blur"
        value={layer.blur ?? 0}
        min={0}
        max={20}
        step={1}
        format={(v) => v === 0 ? 'Off' : `${v}px`}
        onChange={(blur) => {
          updateLayer(layer.id, { blur: blur === 0 ? undefined : blur })
        }}
      />
    </div>
  )
}
