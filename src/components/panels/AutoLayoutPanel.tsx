import { MoveHorizontal, MoveVertical, Trash2 } from 'lucide-react'
import { useDesignStore } from '@/store/useDesignStore'
import type {
  AutoLayoutConfig,
  AutoLayoutPrimaryAlign,
  AutoLayoutCounterAlign,
  AutoLayoutSizing,
  Layer,
} from '@/types/design'

/**
 * Auto Layout inspector — shown when the selected layer belongs to an Auto
 * Layout group. Edits the config (direction / gap / padding / alignment /
 * sizing); every change reflows the group live through the store. Also exposes a
 * per-child "Fill" toggle for the active member.
 */
export function AutoLayoutPanel({ groupId, activeLayer }: { groupId: string; activeLayer: Layer }) {
  const config = useDesignStore((s) => s.document.autoLayouts?.[groupId])
  const update = useDesignStore((s) => s.updateAutoLayoutConfig)
  const remove = useDesignStore((s) => s.removeAutoLayout)
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  if (!config) return null

  const set = (partial: Partial<AutoLayoutConfig>) => update(groupId, partial)
  const horiz = config.direction === 'horizontal'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
          Auto Layout
        </span>
        <button
          className="text-muted-foreground/60 hover:text-destructive transition-colors cursor-pointer"
          title="Remove auto layout"
          onClick={() => remove(groupId)}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Direction */}
      <Seg
        options={[
          { id: 'horizontal', label: 'Horizontal', node: <MoveHorizontal className="w-3.5 h-3.5" /> },
          { id: 'vertical', label: 'Vertical', node: <MoveVertical className="w-3.5 h-3.5" /> },
        ]}
        value={config.direction}
        onChange={(v) => set({ direction: v as AutoLayoutConfig['direction'] })}
      />

      {/* Gap + padding */}
      <div className="grid grid-cols-3 gap-2">
        <NumField label="Gap" value={config.gap} onChange={(v) => set({ gap: v })} />
        <NumField
          label="Pad H"
          value={config.padding.left}
          onChange={(v) => set({ padding: { ...config.padding, left: v, right: v } })}
        />
        <NumField
          label="Pad V"
          value={config.padding.top}
          onChange={(v) => set({ padding: { ...config.padding, top: v, bottom: v } })}
        />
      </div>

      {/* Primary axis distribution */}
      <div className="space-y-1.5">
        <Label>{horiz ? 'Horizontal' : 'Vertical'} align</Label>
        <Seg
          options={[
            { id: 'start', node: 'Start' },
            { id: 'center', node: 'Center' },
            { id: 'end', node: 'End' },
            { id: 'space-between', node: 'Space' },
          ]}
          value={config.primaryAlign}
          onChange={(v) => set({ primaryAlign: v as AutoLayoutPrimaryAlign })}
        />
      </div>

      {/* Counter axis alignment */}
      <div className="space-y-1.5">
        <Label>{horiz ? 'Vertical' : 'Horizontal'} align</Label>
        <Seg
          options={[
            { id: 'start', node: 'Start' },
            { id: 'center', node: 'Center' },
            { id: 'end', node: 'End' },
            { id: 'stretch', node: 'Stretch' },
          ]}
          value={config.counterAlign}
          onChange={(v) => set({ counterAlign: v as AutoLayoutCounterAlign })}
        />
      </div>

      {/* Container sizing */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label>Width</Label>
          <Seg
            options={[{ id: 'hug', node: 'Hug' }, { id: 'fixed', node: 'Fixed' }]}
            value={config.widthMode}
            onChange={(v) => set({ widthMode: v as AutoLayoutSizing })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Height</Label>
          <Seg
            options={[{ id: 'hug', node: 'Hug' }, { id: 'fixed', node: 'Fixed' }]}
            value={config.heightMode}
            onChange={(v) => set({ heightMode: v as AutoLayoutSizing })}
          />
        </div>
      </div>

      {/* Per-child fill (active member) */}
      {activeLayer.type !== 'background' && (
        <div className="space-y-1.5">
          <Label>Selected child</Label>
          <Seg
            options={[{ id: 'fixed', node: 'Fixed' }, { id: 'fill', node: 'Fill' }]}
            value={activeLayer.layoutGrow ? 'fill' : 'fixed'}
            onChange={(v) => {
              pushSnapshot()
              updateLayer(activeLayer.id, { layoutGrow: v === 'fill' })
            }}
          />
        </div>
      )}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-[13px] text-muted-foreground font-normal">{children}</label>
}

function Seg({
  options,
  value,
  onChange,
}: {
  options: { id: string; node: React.ReactNode; label?: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          aria-label={o.label}
          title={o.label}
          className={`flex-1 flex items-center justify-center py-1.5 text-[12px] rounded-[5px] transition-colors duration-150 cursor-pointer ${
            value === o.id
              ? 'bg-foreground text-background'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
          onClick={() => onChange(o.id)}
        >
          {o.node}
        </button>
      ))}
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground/60">{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        min={0}
        className="w-full text-[13px] text-foreground bg-muted/50 rounded-[5px] px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </label>
  )
}
