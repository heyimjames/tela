import { useDesignStore } from '@/store/useDesignStore'
import type { AutoLayoutConfig } from '@/types/design'

// Colour matches the Auto Layout accent used elsewhere (indigo).
const AL = '#6366F1'

interface Props {
  zoom: number
}

type DragKind = 'gap' | 'padH' | 'padV'

/**
 * Direct-manipulation overlay for the selected Auto Layout container: draws the
 * container box and draggable handles for gap and horizontal/vertical padding.
 * Handles drive the config live (one undo step per drag); the store reflows the
 * children as you drag. Shown only when the active layer belongs to an Auto
 * Layout group.
 */
export function AutoLayoutOverlay({ zoom }: Props) {
  const activeLayerId = useDesignStore((s) => s.activeLayerId)
  const layers = useDesignStore((s) => s.document.layers)
  const autoLayouts = useDesignStore((s) => s.document.autoLayouts)
  const update = useDesignStore((s) => s.updateAutoLayoutConfig)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  const active = activeLayerId ? layers.find((l) => l.id === activeLayerId) : null
  const groupId = active?.groupId
  const config = groupId ? autoLayouts?.[groupId] : undefined
  if (!groupId || !config) return null

  const members = layers
    .filter((l) => l.groupId === groupId && l.type !== 'background')
    .sort((a, b) => a.zIndex - b.zIndex)
  if (members.length === 0) return null

  const horiz = config.direction === 'horizontal'
  const bx = config.x * zoom
  const by = config.y * zoom
  const bw = config.width * zoom
  const bh = config.height * zoom

  const startDrag = (kind: DragKind, startVal: number) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    pushSnapshot()
    const axisH = horizAxis(kind)
    const startPointer = axisH ? e.clientX : e.clientY
    const basePad = config.padding

    const move = (ev: PointerEvent) => {
      const pointer = axisH ? ev.clientX : ev.clientY
      const next = Math.max(0, Math.round(startVal + (pointer - startPointer) / zoom))
      if (kind === 'gap') update(groupId, { gap: next }, true)
      else if (kind === 'padH') update(groupId, { padding: { ...basePad, left: next, right: next } }, true)
      else update(groupId, { padding: { ...basePad, top: next, bottom: next } }, true)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Which screen axis a handle drags along: gap follows the layout direction;
  // padH is horizontal, padV vertical.
  function horizAxis(kind: DragKind): boolean {
    if (kind === 'padH') return true
    if (kind === 'padV') return false
    return horiz
  }

  // Resize the CONTAINER (not the children). Dragging a box handle sets the
  // dragged dimension(s) to Fixed at the new size and anchors the opposite edge;
  // the store reflows the children inside — their own sizes are never scaled.
  const startResize = (handle: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    pushSnapshot()
    const west = handle.includes('w')
    const east = handle.includes('e')
    const north = handle.includes('n')
    const south = handle.includes('s')
    const start = { x: config.x, y: config.y, w: config.width, h: config.height, px: e.clientX, py: e.clientY }

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.px) / zoom
      const dy = (ev.clientY - start.py) / zoom
      const patch: Partial<AutoLayoutConfig> = {}
      if (east || west) {
        const w = Math.max(1, Math.round(east ? start.w + dx : start.w - dx))
        patch.width = w
        patch.widthMode = 'fixed'
        patch.x = Math.round(west ? start.x + start.w - w : start.x)
      }
      if (north || south) {
        const h = Math.max(1, Math.round(south ? start.h + dy : start.h - dy))
        patch.height = h
        patch.heightMode = 'fixed'
        patch.y = Math.round(north ? start.y + start.h - h : start.y)
      }
      update(groupId, patch, true)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const RESIZE_HANDLES = [
    { id: 'nw', x: bx, y: by, cursor: 'nwse-resize' },
    { id: 'n', x: bx + bw / 2, y: by, cursor: 'ns-resize' },
    { id: 'ne', x: bx + bw, y: by, cursor: 'nesw-resize' },
    { id: 'e', x: bx + bw, y: by + bh / 2, cursor: 'ew-resize' },
    { id: 'se', x: bx + bw, y: by + bh, cursor: 'nwse-resize' },
    { id: 's', x: bx + bw / 2, y: by + bh, cursor: 'ns-resize' },
    { id: 'sw', x: bx, y: by + bh, cursor: 'nesw-resize' },
    { id: 'w', x: bx, y: by + bh / 2, cursor: 'ew-resize' },
  ]

  // Gap handle centres: midpoint of each gap between consecutive members.
  const gapHandles = members.slice(0, -1).map((m, i) => {
    const next = members[i + 1]
    const cx = horiz ? ((m.x + m.width + next.x) / 2) * zoom : (config.x + config.width / 2) * zoom
    const cy = horiz ? (config.y + config.height / 2) * zoom : ((m.y + m.height + next.y) / 2) * zoom
    return { key: m.id, cx, cy }
  })

  return (
    <svg className="absolute top-0 left-0 pointer-events-none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      {/* Container box */}
      <rect x={bx} y={by} width={bw} height={bh} fill="none" stroke={AL} strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />

      {/* Padding shading (between box edge and content edge) */}
      <PaddingBands config={config} zoom={zoom} />

      {/* Padding handles — H (left inner edge) + V (top inner edge) */}
      <Handle
        x={(config.x + config.padding.left) * zoom}
        y={by + bh / 2}
        orientation="v"
        cursor="ew-resize"
        onPointerDown={startDrag('padH', config.padding.left)}
      />
      <Handle
        x={bx + bw / 2}
        y={(config.y + config.padding.top) * zoom}
        orientation="h"
        cursor="ns-resize"
        onPointerDown={startDrag('padV', config.padding.top)}
      />

      {/* Gap handles */}
      {gapHandles.map((g) => (
        <Handle
          key={g.key}
          x={g.cx}
          y={g.cy}
          orientation={horiz ? 'v' : 'h'}
          cursor={horiz ? 'ew-resize' : 'ns-resize'}
          onPointerDown={startDrag('gap', config.gap)}
          filled
        />
      ))}

      {/* Container resize handles — resize the box, never the children. */}
      {RESIZE_HANDLES.map((r) => (
        <rect
          key={r.id}
          x={r.x - 4}
          y={r.y - 4}
          width={8}
          height={8}
          rx={1.5}
          fill="#fff"
          stroke={AL}
          strokeWidth={1.5}
          style={{ cursor: r.cursor, pointerEvents: 'auto' }}
          onPointerDown={startResize(r.id)}
        />
      ))}
    </svg>
  )
}

// A short draggable bar (pointer-events on). `orientation` is the bar's long
// axis; `filled` marks the gap pills vs the thin padding bars.
function Handle({
  x,
  y,
  orientation,
  cursor,
  onPointerDown,
  filled = false,
}: {
  x: number
  y: number
  orientation: 'h' | 'v'
  cursor: string
  onPointerDown: (e: React.PointerEvent) => void
  filled?: boolean
}) {
  const long = 18
  const thick = filled ? 6 : 4
  const w = orientation === 'h' ? long : thick
  const h = orientation === 'h' ? thick : long
  return (
    <rect
      x={x - w / 2}
      y={y - h / 2}
      width={w}
      height={h}
      rx={thick / 2}
      fill={filled ? AL : '#fff'}
      stroke={AL}
      strokeWidth={1.5}
      style={{ cursor, pointerEvents: 'auto' }}
      onPointerDown={onPointerDown}
    />
  )
}

function PaddingBands({ config, zoom }: { config: AutoLayoutConfig; zoom: number }) {
  const p = config.padding
  const x = config.x * zoom
  const y = config.y * zoom
  const w = config.width * zoom
  const h = config.height * zoom
  const band = (bx: number, by: number, bw: number, bh: number, k: string) =>
    bw > 0 && bh > 0 ? <rect key={k} x={bx} y={by} width={bw} height={bh} fill="#6366F1" opacity={0.06} /> : null
  return (
    <>
      {band(x, y, w, p.top * zoom, 't')}
      {band(x, y + h - p.bottom * zoom, w, p.bottom * zoom, 'b')}
      {band(x, y, p.left * zoom, h, 'l')}
      {band(x + w - p.right * zoom, y, p.right * zoom, h, 'r')}
    </>
  )
}
