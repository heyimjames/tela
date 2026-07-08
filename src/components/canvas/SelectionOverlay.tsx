import { motion } from 'motion/react'
import { useDesignStore } from '@/store/useDesignStore'

const HANDLE_SIZE = 8
const HANDLE_HALF = HANDLE_SIZE / 2
const ROTATE_HANDLE_R = 5 // radius of the round rotation handle
const ROTATE_HANDLE_OFFSET = 22 // px above the top edge (screen space)

interface Props {
  zoom: number
  panOffset: { x: number; y: number }
  onResizeStart: (layerId: string, handle: string, e: React.PointerEvent) => void
  onGroupResizeStart: (handle: string, e: React.PointerEvent) => void
}

const HANDLE_DEFS = (w: number, h: number) => [
  { id: 'nw', cx: 0, cy: 0, cursor: 'nwse-resize' },
  { id: 'n', cx: w / 2, cy: 0, cursor: 'ns-resize' },
  { id: 'ne', cx: w, cy: 0, cursor: 'nesw-resize' },
  { id: 'e', cx: w, cy: h / 2, cursor: 'ew-resize' },
  { id: 'se', cx: w, cy: h, cursor: 'nwse-resize' },
  { id: 's', cx: w / 2, cy: h, cursor: 'ns-resize' },
  { id: 'sw', cx: 0, cy: h, cursor: 'nesw-resize' },
  { id: 'w', cx: 0, cy: h / 2, cursor: 'ew-resize' },
]

export function SelectionOverlay({ zoom, onResizeStart, onGroupResizeStart }: Props) {
  const selectedLayerIds = useDesignStore((s) => s.selectedLayerIds)
  const layers = useDesignStore((s) => s.document.layers)
  const autoLayouts = useDesignStore((s) => s.document.autoLayouts)

  const selectedLayers = layers.filter((l) => selectedLayerIds.has(l.id) && l.type !== 'background')
  if (selectedLayers.length === 0) return null

  // An Auto Layout group is resized through its own container-box handles
  // (AutoLayoutOverlay) — not the generic group box, which would *scale* the
  // children. Suppress the group box here only when the WHOLE Auto Layout group
  // is selected; selecting a single child still shows that child's handles
  // (resizing it reflows the container, which is the intended behaviour).
  const groupIds = new Set(selectedLayers.map((l) => l.groupId))
  const soleGroupId = groupIds.size === 1 ? selectedLayers[0].groupId : undefined
  const memberCount = soleGroupId
    ? layers.filter((l) => l.groupId === soleGroupId && l.type !== 'background').length
    : 0
  const isAutoLayoutGroup =
    !!soleGroupId && !!autoLayouts?.[soleGroupId] && memberCount > 1 && selectedLayers.length === memberCount

  const isMulti = selectedLayers.length > 1 && !isAutoLayoutGroup

  return (
    <svg className="absolute top-0 left-0 pointer-events-none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      {/* Single selection — handles directly on the layer. The whole group is
          rotated to match the layer so the box + handles sit on the rotated
          bounds (rotate around the layer center, i.e. w/2, h/2 in local space).
          An Auto Layout group (multi + suppressed) shows no per-layer handles —
          its container box + resize handles come from AutoLayoutOverlay. */}
      {selectedLayers.length === 1 && !isAutoLayoutGroup && selectedLayers.map((layer) => {
        const x = layer.x * zoom
        const y = layer.y * zoom
        const w = layer.width * zoom
        const h = layer.height * zoom
        const rotation = layer.rotation || 0
        const transform = `translate(${x}, ${y})` + (rotation ? ` rotate(${rotation}, ${w / 2}, ${h / 2})` : '')
        return (
          <g key={layer.id} transform={transform}>
            {/* Ring fades in and handles spring from their centres when a layer
                is selected — keyed by layer.id so it re-pops per new selection
                but doesn't re-animate while dragging/resizing. */}
            <motion.rect
              x={0} y={0} width={w} height={h} fill="none" stroke="#0017c7" strokeWidth={1.5}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
            />
            {/* Rotation handle: round grip above the top-center, on a short stem. */}
            <line
              x1={w / 2} y1={0} x2={w / 2} y2={-ROTATE_HANDLE_OFFSET}
              stroke="#0017c7" strokeWidth={1.5}
            />
            <motion.circle
              cx={w / 2} cy={-ROTATE_HANDLE_OFFSET} r={ROTATE_HANDLE_R}
              fill="#ffffff" stroke="#0017c7" strokeWidth={1.5}
              className="pointer-events-auto"
              style={{ cursor: 'grab', transformBox: 'fill-box', transformOrigin: 'center' }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 26, delay: 0.02 }}
              onPointerDown={(e) => { e.stopPropagation(); onResizeStart(layer.id, 'rotate', e) }}
            />
            {HANDLE_DEFS(w, h).map((handle, i) => (
              <motion.rect
                key={handle.id}
                x={handle.cx - HANDLE_HALF} y={handle.cy - HANDLE_HALF}
                width={HANDLE_SIZE} height={HANDLE_SIZE}
                fill="#ffffff" stroke="#0017c7" strokeWidth={1.5} rx={1}
                className="pointer-events-auto"
                style={{ cursor: handle.cursor, transformBox: 'fill-box', transformOrigin: 'center' }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 520, damping: 26, delay: 0.02 + i * 0.012 }}
                onPointerDown={(e) => { e.stopPropagation(); onResizeStart(layer.id, handle.id, e) }}
              />
            ))}
          </g>
        )
      })}

      {/* Multi selection — thin outline per layer + one combined bbox with handles
          that scale the whole group together. */}
      {isMulti && (() => {
        const minX = Math.min(...selectedLayers.map((l) => l.x))
        const minY = Math.min(...selectedLayers.map((l) => l.y))
        const maxX = Math.max(...selectedLayers.map((l) => l.x + l.width))
        const maxY = Math.max(...selectedLayers.map((l) => l.y + l.height))
        const bx = minX * zoom
        const by = minY * zoom
        const bw = (maxX - minX) * zoom
        const bh = (maxY - minY) * zoom

        return (
          <>
            {selectedLayers.map((layer) => (
              <rect
                key={layer.id}
                x={layer.x * zoom} y={layer.y * zoom}
                width={layer.width * zoom} height={layer.height * zoom}
                fill="none" stroke="#0017c7" strokeWidth={1} strokeOpacity={0.4}
              />
            ))}
            <g transform={`translate(${bx}, ${by})`}>
              <rect x={0} y={0} width={bw} height={bh} fill="none" stroke="#0017c7" strokeWidth={1.5} strokeDasharray="4 3" />
              {HANDLE_DEFS(bw, bh).map((handle) => (
                <rect
                  key={handle.id}
                  x={handle.cx - HANDLE_HALF} y={handle.cy - HANDLE_HALF}
                  width={HANDLE_SIZE} height={HANDLE_SIZE}
                  fill="#ffffff" stroke="#0017c7" strokeWidth={1.5} rx={1}
                  className="pointer-events-auto" style={{ cursor: handle.cursor }}
                  onPointerDown={(e) => { e.stopPropagation(); onGroupResizeStart(handle.id, e) }}
                />
              ))}
            </g>
          </>
        )
      })()}
    </svg>
  )
}
