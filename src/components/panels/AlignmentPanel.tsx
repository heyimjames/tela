import { useDesignStore } from '@/store/useDesignStore'
import type { Layer } from '@/types/design'
import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  Rows3,
  Columns3,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
} from 'lucide-react'

// An "object" for alignment/distribution: either a single ungrouped layer or a
// whole group (layers sharing a groupId) treated as one unit via its combined
// bounding box. Members move together by the same delta so the group's internal
// layout is preserved.
interface AlignObject {
  ids: string[]
  x: number
  y: number
  width: number
  height: number
}

export function AlignmentPanel() {
  const selectedLayerIds = useDesignStore((s) => s.selectedLayerIds)
  const layers = useDesignStore((s) => s.document.layers)
  const format = useDesignStore((s) => s.document.format)
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  const selected = layers.filter(
    (l) => selectedLayerIds.has(l.id) && l.type !== 'background',
  )

  if (selected.length === 0) return null

  const byId = new Map(selected.map((l) => [l.id, l]))

  // Collapse the selection into alignment objects: one entry per ungrouped layer
  // plus one entry per selected group (its combined bbox).
  const buildObjects = (): AlignObject[] => {
    const groups = new Map<string, Layer[]>()
    const objects: AlignObject[] = []
    for (const l of selected) {
      if (l.groupId) {
        const members = groups.get(l.groupId) ?? []
        members.push(l)
        groups.set(l.groupId, members)
      } else {
        objects.push({ ids: [l.id], x: l.x, y: l.y, width: l.width, height: l.height })
      }
    }
    for (const members of groups.values()) {
      const minX = Math.min(...members.map((m) => m.x))
      const minY = Math.min(...members.map((m) => m.y))
      const maxX = Math.max(...members.map((m) => m.x + m.width))
      const maxY = Math.max(...members.map((m) => m.y + m.height))
      objects.push({
        ids: members.map((m) => m.id),
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      })
    }
    return objects
  }

  // Shift every member of an object so its bbox left edge lands on `left`.
  const setObjectLeft = (o: AlignObject, left: number) => {
    const dx = left - o.x
    for (const id of o.ids) {
      const l = byId.get(id)
      if (l) updateLayer(l.id, { x: l.x + dx })
    }
  }

  // Shift every member of an object so its bbox top edge lands on `top`.
  const setObjectTop = (o: AlignObject, top: number) => {
    const dy = top - o.y
    for (const id of o.ids) {
      const l = byId.get(id)
      if (l) updateLayer(l.id, { y: l.y + dy })
    }
  }

  const objects = buildObjects()

  const alignTo = (alignment: string) => {
    pushSnapshot()

    if (objects.length === 1) {
      // Single object → align to the frame as a unit.
      const o = objects[0]
      switch (alignment) {
        case 'left':
          setObjectLeft(o, 0)
          break
        case 'center-h':
          setObjectLeft(o, Math.round((format.width - o.width) / 2))
          break
        case 'right':
          setObjectLeft(o, format.width - o.width)
          break
        case 'top':
          setObjectTop(o, 0)
          break
        case 'center-v':
          setObjectTop(o, Math.round((format.height - o.height) / 2))
          break
        case 'bottom':
          setObjectTop(o, format.height - o.height)
          break
      }
    } else {
      // Multiple objects → align to their combined bounding box.
      const minX = Math.min(...objects.map((o) => o.x))
      const maxX = Math.max(...objects.map((o) => o.x + o.width))
      const minY = Math.min(...objects.map((o) => o.y))
      const maxY = Math.max(...objects.map((o) => o.y + o.height))
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2

      for (const o of objects) {
        switch (alignment) {
          case 'left':
            setObjectLeft(o, minX)
            break
          case 'center-h':
            setObjectLeft(o, Math.round(centerX - o.width / 2))
            break
          case 'right':
            setObjectLeft(o, maxX - o.width)
            break
          case 'top':
            setObjectTop(o, minY)
            break
          case 'center-v':
            setObjectTop(o, Math.round(centerY - o.height / 2))
            break
          case 'bottom':
            setObjectTop(o, maxY - o.height)
            break
        }
      }
    }
  }

  // Equalise the edge-to-edge gaps between objects (endpoints stay put).
  const distribute = (direction: 'horizontal' | 'vertical') => {
    if (objects.length < 3) return
    pushSnapshot()

    const sorted = [...objects].sort((a, b) =>
      direction === 'horizontal' ? a.x - b.x : a.y - b.y,
    )
    const last = sorted[sorted.length - 1]

    if (direction === 'horizontal') {
      const totalWidth = sorted.reduce((sum, o) => sum + o.width, 0)
      const totalSpace = last.x + last.width - sorted[0].x - totalWidth
      const gap = totalSpace / (sorted.length - 1)

      let currentX = sorted[0].x + sorted[0].width + gap
      for (let i = 1; i < sorted.length - 1; i++) {
        setObjectLeft(sorted[i], currentX)
        currentX += sorted[i].width + gap
      }
    } else {
      const totalHeight = sorted.reduce((sum, o) => sum + o.height, 0)
      const totalSpace = last.y + last.height - sorted[0].y - totalHeight
      const gap = totalSpace / (sorted.length - 1)

      let currentY = sorted[0].y + sorted[0].height + gap
      for (let i = 1; i < sorted.length - 1; i++) {
        setObjectTop(sorted[i], currentY)
        currentY += sorted[i].height + gap
      }
    }
  }

  // Equalise the spacing between object centers (endpoints stay put).
  const distributeCenters = (direction: 'horizontal' | 'vertical') => {
    if (objects.length < 3) return
    pushSnapshot()

    const isHorizontal = direction === 'horizontal'
    const centerOf = (o: AlignObject) =>
      isHorizontal ? o.x + o.width / 2 : o.y + o.height / 2

    const sorted = [...objects].sort((a, b) => centerOf(a) - centerOf(b))
    const firstCenter = centerOf(sorted[0])
    const lastCenter = centerOf(sorted[sorted.length - 1])
    const step = (lastCenter - firstCenter) / (sorted.length - 1)

    for (let i = 1; i < sorted.length - 1; i++) {
      const targetCenter = firstCenter + step * i
      if (isHorizontal) {
        setObjectLeft(sorted[i], Math.round(targetCenter - sorted[i].width / 2))
      } else {
        setObjectTop(sorted[i], Math.round(targetCenter - sorted[i].height / 2))
      }
    }
  }

  const alignButtons = [
    { icon: AlignStartVertical, label: 'Align Left', action: () => alignTo('left') },
    { icon: AlignCenterVertical, label: 'Center Horizontally', action: () => alignTo('center-h') },
    { icon: AlignEndVertical, label: 'Align Right', action: () => alignTo('right') },
    { icon: AlignStartHorizontal, label: 'Align Top', action: () => alignTo('top') },
    { icon: AlignCenterHorizontal, label: 'Center Vertically', action: () => alignTo('center-v') },
    { icon: AlignEndHorizontal, label: 'Align Bottom', action: () => alignTo('bottom') },
  ]

  return (
    <div className="space-y-3 pb-3 mb-3 border-b border-border">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        Alignment
      </div>
      <div className="grid grid-cols-6 gap-1">
        {alignButtons.map(({ icon: Icon, label, action }) => (
          <button
            key={label}
            className="p-2 hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
            onClick={action}
            title={label}
            aria-label={label}
          >
            <Icon className="w-4 h-4 mx-auto" />
          </button>
        ))}
      </div>

      {/* Distribute & Tidy */}
      {selected.length >= 2 && (
        <div className="space-y-1">
          {objects.length >= 3 && (
            <>
              <div className="flex gap-1">
                <button
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
                  onClick={() => distribute('horizontal')}
                  title="Distribute horizontally (equal edge gaps)"
                >
                  <Columns3 className="w-4 h-4" />
                  Space H
                </button>
                <button
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
                  onClick={() => distribute('vertical')}
                  title="Distribute vertically (equal edge gaps)"
                >
                  <Rows3 className="w-4 h-4" />
                  Space V
                </button>
              </div>
              <div className="flex gap-1">
                <button
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
                  onClick={() => distributeCenters('horizontal')}
                  title="Distribute horizontally (equal center spacing)"
                >
                  <AlignHorizontalDistributeCenter className="w-4 h-4" />
                  Centers H
                </button>
                <button
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
                  onClick={() => distributeCenters('vertical')}
                  title="Distribute vertically (equal center spacing)"
                >
                  <AlignVerticalDistributeCenter className="w-4 h-4" />
                  Centers V
                </button>
              </div>
            </>
          )}

          {/* Match size */}
          <div className="flex gap-1">
            <button
              className="flex-1 py-1.5 text-[12px] hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
              onClick={() => {
                pushSnapshot()
                const refW = selected[0].width
                for (const l of selected) {
                  updateLayer(l.id, { width: refW })
                }
              }}
              title="Match width to first selected"
            >
              Match Width
            </button>
            <button
              className="flex-1 py-1.5 text-[12px] hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] cursor-pointer active:scale-[0.96]"
              onClick={() => {
                pushSnapshot()
                const refH = selected[0].height
                for (const l of selected) {
                  updateLayer(l.id, { height: refH })
                }
              }}
              title="Match height to first selected"
            >
              Match Height
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
