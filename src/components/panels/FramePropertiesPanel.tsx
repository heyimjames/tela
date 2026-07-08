import type { ReactNode } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { Input } from '@/components/ui/input'
import { BackgroundPanel } from '@/components/panels/BackgroundPanel'
import { Copy, Trash2, LayoutGrid } from 'lucide-react'
import type { Frame } from '@/types/workspace'

/**
 * Inspector for the active frame (shown when a frame is selected but no layer is).
 * Size & background drive the design store (the active frame is loaded there), so
 * `_syncBackToFrame` persists them onto the workspace frame; name & position live
 * purely on the frame object and update the workspace store directly.
 */
export function FramePropertiesPanel({ frame }: { frame: Frame }) {
  const format = useDesignStore((s) => s.document.format)
  const setFormat = useDesignStore((s) => s.setFormat)
  const renameFrame = useWorkspaceStore((s) => s.renameFrame)
  const updateFrame = useWorkspaceStore((s) => s.updateFrame)
  const duplicateFrame = useWorkspaceStore((s) => s.duplicateFrame)
  const removeFrame = useWorkspaceStore((s) => s.removeFrame)
  const generateFormatVariants = useWorkspaceStore((s) => s.generateFormatVariants)

  const resize = (w: number, h: number) =>
    setFormat({ ...format, width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)), label: 'Custom' })

  return (
    <div className="space-y-4">
      <SectionHeader>Frame</SectionHeader>

      <div className="space-y-1">
        <Label>Name</Label>
        <Input
          className="h-8 text-[13px]"
          value={frame.name}
          onChange={(e) => renameFrame(frame.id, e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="X">
          <Input type="number" className="h-8 text-[13px] tabular-nums" value={frame.x}
            onChange={(e) => updateFrame(frame.id, { x: Number(e.target.value) })} />
        </Field>
        <Field label="Y">
          <Input type="number" className="h-8 text-[13px] tabular-nums" value={frame.y}
            onChange={(e) => updateFrame(frame.id, { y: Number(e.target.value) })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="W">
          <Input type="number" className="h-8 text-[13px] tabular-nums" value={format.width}
            onChange={(e) => resize(Number(e.target.value), format.height)} />
        </Field>
        <Field label="H">
          <Input type="number" className="h-8 text-[13px] tabular-nums" value={format.height}
            onChange={(e) => resize(format.width, Number(e.target.value))} />
        </Field>
      </div>

      <div className="pt-3 border-t border-border">
        <BackgroundPanel />
      </div>

      <div className="pt-3 border-t border-border space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <ActionButton onClick={() => duplicateFrame(frame.id)} icon={<Copy className="w-3.5 h-3.5" />}>
            Duplicate
          </ActionButton>
          <ActionButton onClick={() => generateFormatVariants(frame.id)} icon={<LayoutGrid className="w-3.5 h-3.5" />}>
            Variants
          </ActionButton>
        </div>
        <ActionButton onClick={() => removeFrame(frame.id)} icon={<Trash2 className="w-3.5 h-3.5" />} destructive>
          Delete frame
        </ActionButton>
      </div>
    </div>
  )
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
      {children}
    </div>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <label className="text-[12px] text-muted-foreground">{children}</label>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function ActionButton({
  onClick, icon, children, destructive = false,
}: { onClick: () => void; icon: ReactNode; children: ReactNode; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-[5px] text-[12px] transition-[color,background-color,transform] active:scale-[0.97] cursor-pointer ${
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}
