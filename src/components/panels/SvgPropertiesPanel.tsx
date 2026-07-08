import { useMemo, useState, type ReactNode } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { BrandColorPicker } from '@/components/panels/BrandColorPicker'
import { SliderField } from '@/components/controls/SliderField'
import { extractSvgColorRoles, svgHasStroke } from '@/engine/svgColors'
import type { SvgLayer, BrandColor } from '@/types/design'

interface Props {
  layer: SvgLayer
}

export function SvgPropertiesPanel({ layer }: Props) {
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  // Distinct source colours + their paint role (fill/stroke), recomputed only
  // when the artwork itself changes.
  const roles = useMemo(() => extractSvgColorRoles(layer.svgContent), [layer.svgContent])
  const hasStroke = useMemo(() => svgHasStroke(layer.svgContent), [layer.svgContent])
  const colors = roles.map((r) => r.color)
  const overrides = layer.colorOverrides ?? {}

  // Which detected colour the picker below is editing.
  const [selected, setSelected] = useState<string | null>(colors[0] ?? null)
  const activeOriginal = selected && colors.includes(selected) ? selected : (colors[0] ?? null)

  const setOverride = (original: string, color: BrandColor) => {
    pushSnapshot()
    updateLayer<SvgLayer>(layer.id, {
      colorOverrides: { ...overrides, [original]: color },
    })
  }

  const resetColors = () => {
    pushSnapshot()
    updateLayer<SvgLayer>(layer.id, { colorOverrides: {} })
  }

  const setStrokeWidth = (v: number) => {
    pushSnapshot()
    updateLayer<SvgLayer>(layer.id, { strokeWidth: v })
  }

  const currentHex = (original: string) => overrides[original]?.hex ?? original
  const hasOverrides = Object.keys(overrides).length > 0

  const strokeWidthField = hasStroke ? (
    <SliderField
      label="Stroke width"
      value={layer.strokeWidth ?? 1}
      min={0.25}
      max={4}
      step={0.25}
      snapTo={[1]}
      format={(v) => `${v}×`}
      onChange={setStrokeWidth}
    />
  ) : null

  const swatch = (original: string) => {
    const isActive = original === activeOriginal
    return (
      <button
        key={original}
        title={overrides[original] ? `${original} → ${overrides[original]!.hex}` : original}
        className="w-8 h-8 rounded-[5px] border transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        style={{
          backgroundColor: currentHex(original),
          borderColor: isActive ? '#0017c7' : 'var(--border)',
          borderWidth: isActive ? '2px' : '1px',
        }}
        onClick={() => setSelected(original)}
      />
    )
  }

  // Monochrome / no-explicit-colour SVGs (e.g. single-path icons that default to
  // black) expose nothing to extract — fall back to a single tint control.
  if (colors.length === 0) {
    return (
      <div className="space-y-4">
        <Header />
        <BrandColorPicker
          label="Colour"
          value={layer.tintColor ?? { token: 'black', hex: '#000000' }}
          onChange={(tintColor) => {
            pushSnapshot()
            updateLayer<SvgLayer>(layer.id, { tintColor })
          }}
        />
        {strokeWidthField}
      </div>
    )
  }

  // Group the detected colours by paint role so fills and strokes are edited
  // as distinct sets. A colour used for both appears under both (recolouring
  // remaps it wherever it's used).
  const fillColors = roles.filter((r) => r.roles.includes('fill')).map((r) => r.color)
  const strokeColors = roles.filter((r) => r.roles.includes('stroke')).map((r) => r.color)
  const otherColors = roles.filter((r) => r.roles.length === 0).map((r) => r.color)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Header count={colors.length} />
        {hasOverrides && (
          <button
            className="text-[11px] text-primary hover:underline cursor-pointer"
            onClick={resetColors}
          >
            Reset
          </button>
        )}
      </div>

      {fillColors.length > 0 && <ColorGroup label="Fill">{fillColors.map(swatch)}</ColorGroup>}
      {strokeColors.length > 0 && <ColorGroup label="Stroke">{strokeColors.map(swatch)}</ColorGroup>}
      {otherColors.length > 0 && <ColorGroup label="Other">{otherColors.map(swatch)}</ColorGroup>}

      {/* Palette for the selected colour. */}
      {activeOriginal && (
        <BrandColorPicker
          label="Recolour selected"
          value={overrides[activeOriginal] ?? { token: activeOriginal, hex: currentHex(activeOriginal) }}
          onChange={(color) => setOverride(activeOriginal, color)}
        />
      )}

      {strokeWidthField}
    </div>
  )
}

function ColorGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-muted-foreground/60">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Header({ count }: { count?: number }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
      {count != null ? `SVG · ${count} colour${count === 1 ? '' : 's'}` : 'SVG'}
    </div>
  )
}
