import { useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { useDesignStore } from '@/store/useDesignStore'
import {
  DS_COMPONENTS,
  DS_COMPONENT_CATEGORIES,
  type DSComponentCategory,
  type DSComponentDef,
} from '@/brand/dsComponents'
import { randomAvatarDataUrl } from '@/brand/avatars'
import type { ImageLayer, Layer, ShapeLayer, TextLayer } from '@/types/design'

type Filter = 'all' | DSComponentCategory

// Each insert cascades slightly so repeated drops don't stack perfectly.
let insertCount = 0

/**
 * Library of design-system components (buttons, inputs, cards,
 * badges, avatars, banners) the user can drop onto the canvas. Each component
 * is composited from primitive shape + text layers, so it renders through the
 * normal pipeline and is non-interactive by construction. Previews are built
 * from the very same layer specs as the inserted result — one source of truth.
 */
export function DSComponentLibraryPanel() {
  const [filter, setFilter] = useState<Filter>('all')
  const addLayers = useDesignStore((s) => s.addLayers)

  const filtered = useMemo(
    () => (filter === 'all' ? DS_COMPONENTS : DS_COMPONENTS.filter((c) => c.category === filter)),
    [filter],
  )

  const insert = async (def: DSComponentDef) => {
    const format = useDesignStore.getState().document.format
    const cascade = (insertCount++ % 6) * 24
    const ox = Math.round(format.width / 2 - def.width / 2 + cascade)
    const oy = Math.round(format.height / 2 - def.height / 2 + cascade)

    let specs = def.build(ox, oy)

    // Photo avatars drop a *random* face — build() can't fetch (it's sync), so
    // swap the sample URL for an inlined data URL here.
    if (def.kind === 'photo-avatar') {
      const dataUrl = await randomAvatarDataUrl()
      specs = specs.map((s) => (s.type === 'image' ? { ...s, imageUrl: dataUrl } : s))
    }

    // Grouped components get a fresh groupId per drop so each instance selects
    // and moves as one unit (and repeated drops don't merge into one group).
    if (def.group) {
      const groupId = nanoid()
      specs = specs.map((s) => ({ ...s, groupId }))
    }

    addLayers(specs)
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        Components
      </div>

      {/* Category filter */}
      <div className="flex gap-1 flex-wrap">
        <FilterTab label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
        {DS_COMPONENT_CATEGORIES.map((cat) => (
          <FilterTab
            key={cat.id}
            label={cat.label}
            active={filter === cat.id}
            onClick={() => setFilter(cat.id)}
          />
        ))}
      </div>

      {/* Component grid */}
      <div className="grid grid-cols-2 gap-2">
        {filtered.map((def) => (
          <button
            key={def.id}
            className="group flex flex-col items-stretch gap-1.5 rounded-[7px] border border-border bg-white p-2 text-left transition-[border-color,box-shadow,transform] hover:border-primary/30 hover:shadow-[0_4px_16px_-6px_rgba(17,17,17,0.18)] active:scale-[0.98] cursor-pointer"
            onClick={() => void insert(def)}
            title={`${def.name} — click to add to canvas`}
            aria-label={`Add ${def.name} to canvas`}
          >
            <ComponentPreview def={def} />
            <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors truncate">
              {def.name}
            </span>
          </button>
        ))}
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground/50">
        Components are non-interactive — they drop onto the canvas as editable
        shapes and text so you can mock up real designs.
      </p>
    </div>
  )
}

const PREVIEW_BOX = { w: 132, h: 64, pad: 8 }

/** Renders a component's primitive layers as scaled HTML — a faithful thumbnail. */
function ComponentPreview({ def }: { def: DSComponentDef }) {
  const layers = useMemo(() => def.build(0, 0), [def])

  const availW = PREVIEW_BOX.w - PREVIEW_BOX.pad * 2
  const availH = PREVIEW_BOX.h - PREVIEW_BOX.pad * 2
  // Never upscale — small components (badges, sm buttons) keep their real size.
  const scale = Math.min(availW / def.width, availH / def.height, 1)
  const offX = (PREVIEW_BOX.w - def.width * scale) / 2
  const offY = (PREVIEW_BOX.h - def.height * scale) / 2

  return (
    <div
      className="relative overflow-hidden rounded-[5px] bg-[#f4f4ef]"
      style={{ width: '100%', height: PREVIEW_BOX.h }}
    >
      <div
        className="absolute"
        style={{ left: '50%', top: 0, transform: 'translateX(-50%)', width: PREVIEW_BOX.w, height: PREVIEW_BOX.h }}
      >
        {layers.map((layer, i) => (
          <PreviewLayer key={i} layer={layer} scale={scale} offX={offX} offY={offY} />
        ))}
      </div>
    </div>
  )
}

function PreviewLayer({
  layer,
  scale,
  offX,
  offY,
}: {
  layer: Omit<Layer, 'id' | 'zIndex'>
  scale: number
  offX: number
  offY: number
}) {
  const base: React.CSSProperties = {
    position: 'absolute',
    left: offX + layer.x * scale,
    top: offY + layer.y * scale,
    width: layer.width * scale,
    height: layer.height * scale,
  }

  if (layer.type === 'shape') {
    const s = layer as ShapeLayer
    const radius =
      s.shape === 'pill'
        ? Math.min(s.width, s.height) * scale / 2
        : s.shape === 'ellipse'
          ? '50%'
          : s.borderRadius * scale
    return (
      <div
        style={{
          ...base,
          backgroundColor: s.fill.hex,
          borderRadius: radius,
          border: s.stroke ? `${Math.max(1, s.stroke.width * scale)}px solid ${s.stroke.color.hex}` : undefined,
        }}
      />
    )
  }

  if (layer.type === 'image') {
    const il = layer as ImageLayer
    return (
      <img
        src={il.imageUrl}
        alt=""
        draggable={false}
        style={{
          ...base,
          objectFit: 'cover',
          // Full radius (9999) → circle; native clamping handles the rest.
          borderRadius: il.borderRadius >= 9999 ? '50%' : il.borderRadius * scale,
        }}
      />
    )
  }

  if (layer.type === 'text') {
    const t = layer as TextLayer
    const justify =
      t.textAlign === 'center' ? 'center' : t.textAlign === 'right' ? 'flex-end' : 'flex-start'
    const align =
      t.verticalAlign === 'middle' ? 'center' : t.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start'
    return (
      <div
        style={{
          ...base,
          display: 'flex',
          justifyContent: justify,
          alignItems: align,
          color: t.color.hex,
          fontSize: Math.max(4, t.fontSize * scale),
          fontWeight: t.fontWeight,
          lineHeight: t.lineHeight,
          letterSpacing: t.letterSpacing * t.fontSize * scale,
          textAlign: t.textAlign,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {t.content}
      </div>
    )
  }

  return null
}

function FilterTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`px-2.5 py-1 text-[12px] rounded-[5px] transition-colors cursor-pointer ${
        active ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
