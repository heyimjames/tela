import { useDesignStore } from '@/store/useDesignStore'
import { BrandColorPicker } from '@/components/panels/BrandColorPicker'
import { SliderField } from '@/components/controls/SliderField'
import type { ShapeLayer, ShapeType, LineCap } from '@/types/design'

const BRAND_RADII = [
  { label: '0', value: 0 },
  { label: '3px', value: 3 },
  { label: '5px', value: 5 },
  { label: '7px', value: 7 },
  { label: '8px', value: 8 },
  { label: '12px', value: 12 },
  { label: 'Full', value: 9999 },
]

const SHAPES: { label: string; value: ShapeType }[] = [
  { label: 'Rectangle', value: 'rectangle' },
  { label: 'Ellipse', value: 'ellipse' },
  { label: 'Pill', value: 'pill' },
  { label: 'Line', value: 'line' },
]

interface Props {
  layer: ShapeLayer
}

export function ShapePropertiesPanel({ layer }: Props) {
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        Shape
      </div>

      {/* Shape type */}
      <div className="flex gap-1 flex-wrap">
        {SHAPES.map((s) => (
          <button
            key={s.value}
            className={`
              px-3 py-1 text-[12px] rounded-[5px] transition-colors duration-150
              ${layer.shape === s.value
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'}
            `}
            onClick={() => {
              pushSnapshot()
              updateLayer<ShapeLayer>(layer.id, { shape: s.value })
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Fill */}
      <BrandColorPicker
        label="Fill"
        value={layer.fill}
        onChange={(fill) => {
          pushSnapshot()
          updateLayer<ShapeLayer>(layer.id, { fill })
        }}
      />

      {/* Line-specific controls */}
      {layer.shape === 'line' && (
        <div className="space-y-3">
          <SliderField
            label="Stroke Width"
            value={layer.stroke?.width ?? 2}
            min={1}
            max={20}
            step={1}
            format={(v) => `${v}px`}
            onChange={(width) => {
              pushSnapshot()
              updateLayer<ShapeLayer>(layer.id, {
                stroke: { color: layer.stroke?.color ?? layer.fill, width },
              })
            }}
          />

          <div className="space-y-1.5">
            <label className="text-[13px] text-muted-foreground font-normal">Line Cap</label>
            <div className="flex gap-1">
              {([
                { label: 'Flat', value: 'butt' as LineCap },
                { label: 'Round', value: 'round' as LineCap },
                { label: 'Square', value: 'square' as LineCap },
              ]).map((cap) => (
                <button
                  key={cap.value}
                  className={`
                    flex-1 py-1.5 text-[12px] rounded-[5px] transition-colors duration-150
                    ${(layer.lineCap ?? 'round') === cap.value
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                  `}
                  onClick={() => {
                    pushSnapshot()
                    updateLayer<ShapeLayer>(layer.id, { lineCap: cap.value })
                  }}
                >
                  {cap.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] text-muted-foreground font-normal">Arrowheads</label>
            <div className="flex gap-1">
              {([
                { label: 'Start', key: 'arrowStart' as const },
                { label: 'End', key: 'arrowEnd' as const },
              ]).map((a) => {
                const on = !!layer[a.key]
                return (
                  <button
                    key={a.key}
                    className={`flex-1 py-1.5 text-[12px] rounded-[5px] transition-colors duration-150 ${
                      on ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                    onClick={() => { pushSnapshot(); updateLayer<ShapeLayer>(layer.id, { [a.key]: !on }) }}
                  >
                    {a.label}
                  </button>
                )
              })}
            </div>
          </div>

          <SliderField
            label="Curve"
            value={layer.controlPointY ?? 0.5}
            min={0}
            max={1}
            step={0.01}
            format={(v) => v === 0.5 ? 'Straight' : `${Math.round(Math.abs(v - 0.5) * 200)}%`}
            onChange={(v) => {
              updateLayer<ShapeLayer>(layer.id, {
                controlPointX: 0.5,
                controlPointY: v,
              })
            }}
          />
        </div>
      )}

      {/* Border radius (rectangle only) — brand-constrained presets */}
      {layer.shape === 'rectangle' && (
        <div className="space-y-1.5">
          <label className="text-[13px] text-muted-foreground font-normal">Corner Radius</label>
          <div className="flex gap-1 flex-wrap">
            {BRAND_RADII.map((r) => (
              <button
                key={r.value}
                className={`
                  px-2.5 py-1 text-[12px] rounded-[5px] transition-colors duration-150
                  ${layer.borderRadius === r.value
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                `}
                onClick={() => {
                  pushSnapshot()
                  updateLayer<ShapeLayer>(layer.id, { borderRadius: r.value })
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Position, Size, Opacity, Rotation are in PositionSizePanel */}
    </div>
  )
}
