import { useMemo } from 'react'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import {
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  Columns3, Rows3, LayoutGrid,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
} from 'lucide-react'

type Align = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom'

const TIDY_GAP = 80

/**
 * Align / distribute the currently selected frames on the canvas. Frames are
 * top-level objects, so alignment is always relative to the selection's bounds
 * (there's no parent canvas to align against). Operates directly on the
 * workspace store via `updateFrame`, which the PreviewPanel positions from.
 */
export function FrameAlignmentPanel() {
  const updateFrame = useWorkspaceStore((s) => s.updateFrame)
  // Select STABLE references (the frames array + the selection set), then derive
  // the filtered list with useMemo — returning a fresh array straight from the
  // selector would fail zustand's Object.is check and loop forever.
  const selectedFrameIds = useWorkspaceStore((s) => s.selectedFrameIds)
  const frames = useWorkspaceStore((s) =>
    s.workspace.pages.find((p) => p.id === s.workspace.activePageId)?.frames,
  )
  const selected = useMemo(
    () => (frames ?? []).filter((f) => selectedFrameIds.has(f.id)),
    [frames, selectedFrameIds],
  )

  if (selected.length < 2) return null

  const minX = Math.min(...selected.map((f) => f.x))
  const maxX = Math.max(...selected.map((f) => f.x + f.width))
  const minY = Math.min(...selected.map((f) => f.y))
  const maxY = Math.max(...selected.map((f) => f.y + f.height))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  const align = (kind: Align) => {
    for (const f of selected) {
      switch (kind) {
        case 'left': updateFrame(f.id, { x: Math.round(minX) }); break
        case 'center-h': updateFrame(f.id, { x: Math.round(centerX - f.width / 2) }); break
        case 'right': updateFrame(f.id, { x: Math.round(maxX - f.width) }); break
        case 'top': updateFrame(f.id, { y: Math.round(minY) }); break
        case 'center-v': updateFrame(f.id, { y: Math.round(centerY - f.height / 2) }); break
        case 'bottom': updateFrame(f.id, { y: Math.round(maxY - f.height) }); break
      }
    }
  }

  const distribute = (axis: 'h' | 'v') => {
    if (selected.length < 3) return
    const sorted = [...selected].sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y))
    const last = sorted[sorted.length - 1]
    if (axis === 'h') {
      const occupied = sorted.reduce((sum, f) => sum + f.width, 0)
      const gap = ((last.x + last.width) - sorted[0].x - occupied) / (sorted.length - 1)
      let cur = sorted[0].x + sorted[0].width + gap
      for (let i = 1; i < sorted.length - 1; i++) { updateFrame(sorted[i].id, { x: Math.round(cur) }); cur += sorted[i].width + gap }
    } else {
      const occupied = sorted.reduce((sum, f) => sum + f.height, 0)
      const gap = ((last.y + last.height) - sorted[0].y - occupied) / (sorted.length - 1)
      let cur = sorted[0].y + sorted[0].height + gap
      for (let i = 1; i < sorted.length - 1; i++) { updateFrame(sorted[i].id, { y: Math.round(cur) }); cur += sorted[i].height + gap }
    }
  }

  // Equalise the spacing between frame centers (endpoints stay put).
  const distributeCenters = (axis: 'h' | 'v') => {
    if (selected.length < 3) return
    const centerOf = (f: (typeof selected)[number]) =>
      axis === 'h' ? f.x + f.width / 2 : f.y + f.height / 2
    const sorted = [...selected].sort((a, b) => centerOf(a) - centerOf(b))
    const firstCenter = centerOf(sorted[0])
    const lastCenter = centerOf(sorted[sorted.length - 1])
    const step = (lastCenter - firstCenter) / (sorted.length - 1)
    for (let i = 1; i < sorted.length - 1; i++) {
      const targetCenter = firstCenter + step * i
      if (axis === 'h') updateFrame(sorted[i].id, { x: Math.round(targetCenter - sorted[i].width / 2) })
      else updateFrame(sorted[i].id, { y: Math.round(targetCenter - sorted[i].height / 2) })
    }
  }

  // Pack selected frames into a single top-aligned row with an even gap.
  const tidyRow = () => {
    const sorted = [...selected].sort((a, b) => a.x - b.x)
    let cur = sorted[0].x
    for (const f of sorted) {
      updateFrame(f.id, { x: Math.round(cur), y: Math.round(minY) })
      cur += f.width + TIDY_GAP
    }
  }

  const alignButtons: { icon: typeof AlignStartVertical; label: string; kind: Align }[] = [
    { icon: AlignStartVertical, label: 'Align left', kind: 'left' },
    { icon: AlignCenterVertical, label: 'Center horizontally', kind: 'center-h' },
    { icon: AlignEndVertical, label: 'Align right', kind: 'right' },
    { icon: AlignStartHorizontal, label: 'Align top', kind: 'top' },
    { icon: AlignCenterHorizontal, label: 'Center vertically', kind: 'center-v' },
    { icon: AlignEndHorizontal, label: 'Align bottom', kind: 'bottom' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
          Align frames
        </div>
        <span className="text-[11px] text-muted-foreground/50 tabular-nums">{selected.length} selected</span>
      </div>

      <div className="grid grid-cols-6 gap-1">
        {alignButtons.map(({ icon: Icon, label, kind }) => (
          <button
            key={kind}
            className="p-2 hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
            onClick={() => align(kind)}
            title={label}
            aria-label={label}
          >
            <Icon className="w-4 h-4 mx-auto" />
          </button>
        ))}
      </div>

      {selected.length >= 3 && (
        <div className="flex gap-1">
          <button
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
            onClick={() => distribute('h')}
            title="Distribute horizontally"
          >
            <Columns3 className="w-4 h-4" />Space H
          </button>
          <button
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
            onClick={() => distribute('v')}
            title="Distribute vertically"
          >
            <Rows3 className="w-4 h-4" />Space V
          </button>
        </div>
      )}

      {selected.length >= 3 && (
        <div className="flex gap-1">
          <button
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
            onClick={() => distributeCenters('h')}
            title="Distribute horizontally (equal center spacing)"
          >
            <AlignHorizontalDistributeCenter className="w-4 h-4" />Centers H
          </button>
          <button
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
            onClick={() => distributeCenters('v')}
            title="Distribute vertically (equal center spacing)"
          >
            <AlignVerticalDistributeCenter className="w-4 h-4" />Centers V
          </button>
        </div>
      )}

      <button
        className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[12px] hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
        onClick={tidyRow}
        title="Tidy into a row"
      >
        <LayoutGrid className="w-4 h-4" />Tidy into row
      </button>

      <p className="text-[11px] leading-snug text-muted-foreground/50">
        Shift-click frames or drag a marquee to select more.
      </p>
    </div>
  )
}
