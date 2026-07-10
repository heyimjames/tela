import { useCallback, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useDesignStore } from '@/store/useDesignStore'
import { getBrandColor } from '@/brand/palette'
import { useSnapComputation } from '@/hooks/canvas/useSnapComputation'
import { computeResize } from '@/hooks/canvas/useResizeComputation'
import type { SnapGuide, SpacingGuide } from '@/hooks/canvas/useSnapComputation'
import type { LayerId, Layer, ShapeLayer } from '@/types/design'

const DOUBLE_CLICK_MS = 300 // max ms between clicks for double-click
const DRAG_DEAD_ZONE = 3 // px in screen space before drag starts

interface DragState {
  type: 'move' | 'resize' | 'pan' | 'marquee' | 'draw' | 'group-resize' | 'rotate'
  layerId: LayerId
  handle?: string
  startX: number
  startY: number
  startLayerX: number
  startLayerY: number
  startLayerW: number
  startLayerH: number
  startPanX?: number
  startPanY?: number
  // Rotation gesture state (design-space center + starting angles, degrees).
  centerX?: number
  centerY?: number
  startRotation?: number
  startPointerAngle?: number
}

// Snapshot of each member's geometry at the start of a group resize, plus the
// combined bounding box, so we can scale every layer relative to a fixed anchor.
interface GroupResizeStart {
  handle: string
  bbox: { x: number; y: number; w: number; h: number }
  layers: Map<string, { x: number; y: number; w: number; h: number; fontSize?: number; borderRadius?: number }>
}

const MIN_GROUP_SIZE = 8 // px — floor for the combined bbox so it can't collapse

// Shortest distance from a point to a polyline (min over each segment). Used to
// hit-test freehand strokes against the actual ink instead of their bbox.
function distToPolyline(px: number, py: number, pts: readonly (readonly [number, number])[]): number {
  if (pts.length === 0) return Infinity
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1])
  let min = Infinity
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1]
    const [x2, y2] = pts[i]
    const dx = x2 - x1
    const dy = y2 - y1
    const l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0
    const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
    if (d < min) min = d
  }
  return min
}

// Scale every group member relative to a fixed anchor edge. Corner handles are
// free-form (independent axes) unless Shift is held, in which case they scale
// uniformly (aspect locked) — matching Figma and single-layer resize. Edge
// handles always scale one axis.
function applyGroupResize(start: GroupResizeStart, dx: number, dy: number, constrainAspect: boolean) {
  const { handle, bbox } = start
  const movingLeft = handle.includes('w')
  const movingRight = handle.includes('e')
  const movingTop = handle.includes('n')
  const movingBottom = handle.includes('s')
  const isCorner = (movingLeft || movingRight) && (movingTop || movingBottom)

  let newW = movingRight ? bbox.w + dx : movingLeft ? bbox.w - dx : bbox.w
  let newH = movingBottom ? bbox.h + dy : movingTop ? bbox.h - dy : bbox.h
  newW = Math.max(MIN_GROUP_SIZE, newW)
  newH = Math.max(MIN_GROUP_SIZE, newH)

  let sx = newW / bbox.w
  let sy = newH / bbox.h

  // Lock aspect on corners only while Shift is held (Figma convention).
  if (isCorner && constrainAspect) {
    const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy
    sx = s
    sy = s
    newW = bbox.w * sx
    newH = bbox.h * sy
  }

  // Anchor = the edge that isn't being dragged.
  const originX = movingLeft ? bbox.x + bbox.w - newW : bbox.x
  const originY = movingTop ? bbox.y + bbox.h - newH : bbox.y

  const update = useDesignStore.getState().updateLayer
  for (const [id, geo] of start.layers) {
    const x = originX + (geo.x - bbox.x) * sx
    const y = originY + (geo.y - bbox.y) * sy
    const width = Math.max(1, geo.w * sx)
    const height = Math.max(1, geo.h * sy)
    const updates: Record<string, number> = { x, y, width, height }
    // Text font size tracks vertical scale; rounded corners track the smaller axis.
    if (geo.fontSize != null) updates.fontSize = Math.max(1, Math.round(geo.fontSize * sy))
    if (geo.borderRadius != null) updates.borderRadius = Math.max(0, Math.round(geo.borderRadius * Math.min(sx, sy)))
    update(id, updates)
  }
}

export function useCanvasInteraction(
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [isDragging, setIsDragging] = useState(false)
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([])
  const [spacingGuides, setSpacingGuides] = useState<SpacingGuide[]>([])
  const [hoverCursor, setHoverCursor] = useState<string>('default')
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const hasMoved = useRef(false)
  const dragExceededDeadZone = useRef(false)
  const multiDragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const groupResizeRef = useRef<GroupResizeStart | null>(null)
  // When the user presses on an already-selected unit without dragging, we keep
  // the selection so it can be dragged as a whole, then collapse to this unit on
  // release if no drag happened (classic select-on-mouseup behaviour).
  const pendingCollapseRef = useRef<{ ids: string[]; activeId: string } | null>(null)

  // Double-click detection for text editing
  const lastClickRef = useRef<{ layerId: string; time: number } | null>(null)

  // canvasWrapperRef tracks the inner canvas-sized div for accurate coord conversion
  const canvasWrapperRef = useRef<HTMLElement | null>(null)

  const computeSnap = useSnapComputation()

  const getDesignCoords = useCallback(
    (clientX: number, clientY: number) => {
      const el = canvasWrapperRef.current
      if (!el) return { x: 0, y: 0 }

      const rect = el.getBoundingClientRect()
      const zoom = useDesignStore.getState().zoom

      return {
        x: (clientX - rect.left) / zoom,
        y: (clientY - rect.top) / zoom,
      }
    },
    [],
  )

  const hitTest = useCallback(
    (designX: number, designY: number): LayerId | null => {
      const layers = useDesignStore.getState().document.layers
      const zoom = useDesignStore.getState().zoom
      // A finger is far less precise than a cursor: give a generous hit slop on
      // touch, a small one on mouse. Kept in *design* units (screen px ÷ zoom) so
      // the tappable margin is a constant on-screen size at any zoom.
      const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
      const slop = (coarse ? 20 : 7) / (zoom || 1)

      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i]
        if (!layer.visible || layer.locked || layer.type === 'background') continue

        // Inverse-rotate the pointer around the layer centre so rotated layers
        // hit-test against their true (rotated) bounds, not the original AABB.
        let px = designX
        let py = designY
        if (layer.rotation) {
          const cx = layer.x + layer.width / 2
          const cy = layer.y + layer.height / 2
          const rad = (-layer.rotation * Math.PI) / 180
          const ox = designX - cx
          const oy = designY - cy
          px = cx + ox * Math.cos(rad) - oy * Math.sin(rad)
          py = cy + ox * Math.sin(rad) + oy * Math.cos(rad)
        }

        // Freehand strokes hit-test against the *ink*, not the bounding box: a
        // thin diagonal line has a huge, mostly-empty bbox that both makes the
        // line itself hard to tap and blocks clicks meant for layers underneath.
        // Measure the distance to the stroke polyline (in its own point space)
        // and accept a hit within half the stroke width plus the touch slop.
        if (layer.type === 'draw') {
          const sx = layer.natWidth ? layer.width / layer.natWidth : 1
          const sy = layer.natHeight ? layer.height / layer.natHeight : 1
          const avg = (Math.abs(sx) + Math.abs(sy)) / 2 || 1
          const lx = (px - layer.x) / (sx || 1)
          const ly = (py - layer.y) / (sy || 1)
          const d = distToPolyline(lx, ly, layer.points)
          if (d <= (layer.strokeWidth ?? 4) / 2 + slop / avg) return layer.id
          continue
        }

        if (
          px >= layer.x - slop &&
          px <= layer.x + layer.width + slop &&
          py >= layer.y - slop &&
          py <= layer.y + layer.height + slop
        ) {
          return layer.id
        }
      }
      return null
    },
    [],
  )

  // The full set of layer ids that should select/move together with `id`: all
  // members of its group, or just itself when ungrouped.
  const unitFor = useCallback((id: LayerId): LayerId[] => {
    const layers = useDesignStore.getState().document.layers
    const layer = layers.find((l) => l.id === id)
    if (!layer?.groupId) return [id]
    return layers
      .filter((l) => l.groupId === layer.groupId && l.type !== 'background')
      .map((l) => l.id)
  }, [])

  // Expand a set of ids to include every groupmate (used after marquee select).
  const expandToGroups = useCallback((ids: Set<string>): Set<string> => {
    const layers = useDesignStore.getState().document.layers
    const groupIds = new Set(
      [...ids].map((id) => layers.find((l) => l.id === id)?.groupId).filter(Boolean) as string[],
    )
    if (groupIds.size === 0) return ids
    const out = new Set(ids)
    for (const l of layers) {
      if (l.groupId && groupIds.has(l.groupId) && l.type !== 'background') out.add(l.id)
    }
    return out
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Cache the canvas wrapper element for coordinate calculations
      canvasWrapperRef.current = e.currentTarget as HTMLElement

      const tool = useDesignStore.getState().tool
      const { x, y } = getDesignCoords(e.clientX, e.clientY)
      // Resolve the layer under the cursor up front: Alt+drag means "duplicate"
      // over a layer, and "pan" only over empty canvas.
      const hitId = (tool === 'select' || tool === 'comment') ? hitTest(x, y) : null

      // Pan: middle mouse, the pan tool, or Alt+drag on EMPTY canvas.
      if (e.button === 1 || tool === 'pan' || (e.button === 0 && e.altKey && !hitId)) {
        const pan = useDesignStore.getState().panOffset
        dragRef.current = {
          type: 'pan',
          layerId: '',
          startX: e.clientX,
          startY: e.clientY,
          startLayerX: 0, startLayerY: 0, startLayerW: 0, startLayerH: 0,
          startPanX: pan.x,
          startPanY: pan.y,
        }
        setIsDragging(true)
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        e.preventDefault()
        return
      }

      if (e.button !== 0) return

      // Shape tool — draw-to-create
      if (tool === 'shape') {
        dragRef.current = {
          type: 'draw',
          layerId: '',
          startX: e.clientX,
          startY: e.clientY,
          startLayerX: Math.round(x),
          startLayerY: Math.round(y),
          startLayerW: 0,
          startLayerH: 0,
        }
        hasMoved.current = false
        setIsDragging(true)
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        return
      }

      if (tool !== 'select' && tool !== 'comment') return

      if (hitId) {
        // hitTest already skips locked layers (click-through), so the resolved
        // layer is guaranteed unlocked — no early return on lock here.
        const layer = useDesignStore.getState().getLayer(hitId)
        if (!layer) return

        // Double-click detection: if clicking the same text layer within 300ms, enter edit mode
        const now = Date.now()
        const lastClick = lastClickRef.current
        if (
          layer.type === 'text' &&
          lastClick &&
          lastClick.layerId === hitId &&
          now - lastClick.time < DOUBLE_CLICK_MS
        ) {
          lastClickRef.current = null
          useDesignStore.getState().setEditingTextLayerId(hitId)
          return
        }
        lastClickRef.current = { layerId: hitId, time: now }

        // Resolve the unit (whole group, or the single layer) under the cursor
        // and reconcile it with the current selection.
        const store = useDesignStore.getState()
        const unitIds = unitFor(hitId)
        const currentSel = store.selectedLayerIds
        pendingCollapseRef.current = null

        if (e.shiftKey) {
          // Toggle the whole unit in/out of the selection.
          const next = new Set(currentSel)
          const allIn = unitIds.every((id) => next.has(id))
          for (const id of unitIds) {
            if (allIn) next.delete(id)
            else next.add(id)
          }
          useDesignStore.setState({
            selectedLayerIds: next,
            activeLayerId: allIn ? (next.size ? [...next][next.size - 1] : null) : hitId,
          })
        } else {
          const alreadySelected = unitIds.every((id) => currentSel.has(id))
          if (alreadySelected && currentSel.size >= unitIds.length) {
            // Keep the existing selection so a multi-selection can be dragged as
            // one. If the pointer doesn't move, collapse to this unit on release.
            useDesignStore.setState({ activeLayerId: hitId })
            pendingCollapseRef.current = { ids: unitIds, activeId: hitId }
          } else {
            // Select the whole unit.
            useDesignStore.setState({
              selectedLayerIds: new Set(unitIds),
              activeLayerId: hitId,
            })
          }
        }

        let targetId = hitId

        // Alt/Option + drag = duplicate the whole selection, then drag the copies.
        if (e.altKey) {
          const dupStore = useDesignStore.getState()
          const sel = [...dupStore.selectedLayerIds]
            .map((id) => dupStore.getLayer(id))
            .filter((l): l is Layer => !!l && l.type !== 'background')
          if (sel.length) {
            // If the copied set shared a single group, the copies form a fresh
            // group; otherwise they stay ungrouped.
            const groupIds = new Set(sel.map((l) => l.groupId).filter(Boolean))
            const newGroupId = groupIds.size === 1 && sel.length > 1 ? nanoid() : undefined
            const clones = sel.map((l) => {
              const { id: _id, zIndex: _z, groupId, ...rest } = l
              return {
                ...rest,
                name: `${rest.name} copy`,
                ...(groupId ? { groupId: newGroupId } : {}),
              } as Omit<Layer, 'id' | 'zIndex'>
            })
            // addLayers preserves input order and selects the clones in one
            // undo step, so the clone of `hitId` sits at the same index as `hitId`.
            const newIds = useDesignStore.getState().addLayers(clones)
            const hitIdx = sel.findIndex((l) => l.id === hitId)
            targetId = hitIdx >= 0 ? newIds[hitIdx] : (newIds[newIds.length - 1] ?? hitId)
            useDesignStore.setState({ activeLayerId: targetId })
          }
        } else {
          useDesignStore.getState().pushSnapshot()
        }

        // Store start positions of all selected layers for multi-drag
        multiDragStartRef.current = new Map()
        const selectedIds = useDesignStore.getState().selectedLayerIds
        for (const id of selectedIds) {
          const l = useDesignStore.getState().getLayer(id)
          if (l && l.type !== 'background') {
            multiDragStartRef.current.set(id, { x: l.x, y: l.y })
          }
        }

        const targetLayer = useDesignStore.getState().getLayer(targetId) ?? layer

        dragRef.current = {
          type: 'move',
          layerId: targetId,
          startX: e.clientX,
          startY: e.clientY,
          startLayerX: targetLayer.x,
          startLayerY: targetLayer.y,
          startLayerW: targetLayer.width,
          startLayerH: targetLayer.height,
        }
        hasMoved.current = false
        dragExceededDeadZone.current = false
        setIsDragging(true)
        // NOTE: Don't setPointerCapture here — it blocks double-click.
        // Capture happens in pointerMove once actual drag movement starts.
      } else {
        // Empty area — start marquee selection
        if (!e.shiftKey) {
          useDesignStore.getState().deselectAll()
        }
        dragRef.current = {
          type: 'marquee',
          layerId: '',
          startX: e.clientX,
          startY: e.clientY,
          startLayerX: Math.round(x),
          startLayerY: Math.round(y),
          startLayerW: 0,
          startLayerH: 0,
        }
        hasMoved.current = false
        setIsDragging(true)
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      }
    },
    [getDesignCoords, hitTest, unitFor],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current

      // Hover cursor when not dragging
      if (!drag) {
        canvasWrapperRef.current = e.currentTarget as HTMLElement
        const { x, y } = getDesignCoords(e.clientX, e.clientY)
        const hitId = hitTest(x, y)
        const tool = useDesignStore.getState().tool
        // Track the layer under the cursor for the hover highlight (select tool
        // only). Guarded so we only write when it actually changes.
        const nextHover = tool === 'select' ? hitId : null
        if (useDesignStore.getState().hoveredLayerId !== nextHover) {
          useDesignStore.getState().setHoveredLayerId(nextHover)
        }
        if (tool === 'pan') {
          setHoverCursor('grab')
        } else if (hitId) {
          const layer = useDesignStore.getState().getLayer(hitId)
          if (layer?.type === 'text') {
            setHoverCursor('text')
          } else {
            setHoverCursor('move')
          }
        } else {
          setHoverCursor('default')
        }
        return
      }

      // Dead zone: don't start move drag until pointer moves more than DRAG_DEAD_ZONE px
      if (!dragExceededDeadZone.current && drag.type === 'move') {
        const dx = Math.abs(e.clientX - drag.startX)
        const dy = Math.abs(e.clientY - drag.startY)
        if (dx < DRAG_DEAD_ZONE && dy < DRAG_DEAD_ZONE) {
          return // Still within dead zone — don't move anything yet
        }
        dragExceededDeadZone.current = true
        // Capture pointer once we exceed the dead zone
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      }
      hasMoved.current = true

      if (drag.type === 'pan') {
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        useDesignStore.getState().setPanOffset({
          x: (drag.startPanX ?? 0) + dx,
          y: (drag.startPanY ?? 0) + dy,
        })
        return
      }

      const zoom = useDesignStore.getState().zoom
      const dx = (e.clientX - drag.startX) / zoom
      const dy = (e.clientY - drag.startY) / zoom

      if (drag.type === 'move') {
        const selectedIds = useDesignStore.getState().selectedLayerIds
        const isMulti = selectedIds.size > 1

        // Snap the whole moving set as one: for a multi-selection we snap the
        // combined bounding box (edges + center), for a single layer we snap the
        // layer itself. In both cases every selected layer is excluded as a snap
        // target so the moving set never snaps to itself.
        let refX: number // reference (top-left) start position we compute the delta against
        let refY: number
        let snapW: number
        let snapH: number
        if (isMulti) {
          let minX = Infinity
          let minY = Infinity
          let maxX = -Infinity
          let maxY = -Infinity
          for (const id of selectedIds) {
            const start = multiDragStartRef.current.get(id)
            const layer = useDesignStore.getState().getLayer(id)
            if (!start || !layer || layer.type === 'background') continue
            minX = Math.min(minX, start.x)
            minY = Math.min(minY, start.y)
            maxX = Math.max(maxX, start.x + layer.width)
            maxY = Math.max(maxY, start.y + layer.height)
          }
          refX = Number.isFinite(minX) ? minX : drag.startLayerX
          refY = Number.isFinite(minY) ? minY : drag.startLayerY
          snapW = Number.isFinite(maxX) ? maxX - refX : drag.startLayerW
          snapH = Number.isFinite(maxY) ? maxY - refY : drag.startLayerH
        } else {
          refX = drag.startLayerX
          refY = drag.startLayerY
          snapW = drag.startLayerW
          snapH = drag.startLayerH
        }

        const snapped = computeSnap(
          drag.layerId,
          refX + dx,
          refY + dy,
          snapW,
          snapH,
          selectedIds,
          e.shiftKey, // Shift → snap to equal padding from the two nearest sides
        )

        // Snap correction resolved against the reference point, then applied to
        // every member from its own start position (keeps the set rigid).
        const actualDx = snapped.x - refX
        const actualDy = snapped.y - refY

        useDesignStore.getState().updateLayer(drag.layerId, {
          x: Math.round(drag.startLayerX + actualDx),
          y: Math.round(drag.startLayerY + actualDy),
        })

        if (isMulti) {
          for (const id of selectedIds) {
            if (id === drag.layerId) continue
            const layer = useDesignStore.getState().getLayer(id)
            if (!layer || layer.type === 'background' || layer.locked) continue
            const start = multiDragStartRef.current.get(id)
            if (!start) continue
            useDesignStore.getState().updateLayer(id, {
              x: Math.round(start.x + actualDx),
              y: Math.round(start.y + actualDy),
            })
          }
        }

        setSnapGuides(snapped.guides)
        setSpacingGuides(snapped.spacing ?? [])
      } else if (drag.type === 'marquee') {
        // Update marquee selection rectangle
        const x = Math.min(drag.startLayerX, drag.startLayerX + dx)
        const y = Math.min(drag.startLayerY, drag.startLayerY + dy)
        const w = Math.abs(dx)
        const h = Math.abs(dy)
        setMarqueeRect({ x, y, w, h })

        // Select layers whose bounds intersect the marquee
        const layers = useDesignStore.getState().document.layers
        const ids = new Set<string>()
        for (const layer of layers) {
          if (layer.type === 'background' || !layer.visible) continue
          const lRight = layer.x + layer.width
          const lBottom = layer.y + layer.height
          // Check if layer overlaps marquee
          if (layer.x < x + w && lRight > x && layer.y < y + h && lBottom > y) {
            ids.add(layer.id)
          }
        }
        const expanded = expandToGroups(ids)
        useDesignStore.setState({
          selectedLayerIds: expanded,
          activeLayerId: expanded.size > 0 ? [...expanded][expanded.size - 1] : null,
        })
      } else if (drag.type === 'draw') {
        // Preview the shape being drawn (no layer created yet, just visual feedback)
        const x = Math.min(drag.startLayerX, drag.startLayerX + dx)
        const y = Math.min(drag.startLayerY, drag.startLayerY + dy)
        const w = Math.abs(dx)
        const h = Math.abs(dy)
        setMarqueeRect({ x, y, w, h })
      } else if (drag.type === 'resize' && drag.handle) {
        // For a rotated layer, rotate the pointer delta into the layer's local
        // axes so the axis-aligned e/w/n/s resize math drives the correct
        // dimension (dragging the visible east handle grows local width).
        let rdx = dx
        let rdy = dy
        const rLayer = useDesignStore.getState().getLayer(drag.layerId)
        if (rLayer?.rotation) {
          const rad = (-rLayer.rotation * Math.PI) / 180
          rdx = dx * Math.cos(rad) - dy * Math.sin(rad)
          rdy = dx * Math.sin(rad) + dy * Math.cos(rad)
        }
        const updates = computeResize(drag, rdx, rdy, e.shiftKey)
        useDesignStore.getState().updateLayer(drag.layerId, updates)
      } else if (drag.type === 'group-resize' && groupResizeRef.current) {
        applyGroupResize(groupResizeRef.current, dx, dy, e.shiftKey)
      } else if (drag.type === 'rotate') {
        // Rotate around the layer center: current pointer angle vs. the angle at
        // grab time, added to the layer's starting rotation. On touch we auto-snap
        // to 45° (no modifier keys on a phone); on mouse, Shift snaps to 15°.
        const p = getDesignCoords(e.clientX, e.clientY)
        const cx = drag.centerX ?? 0
        const cy = drag.centerY ?? 0
        const pointerAngle = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI
        let deg = (drag.startRotation ?? 0) + (pointerAngle - (drag.startPointerAngle ?? 0))
        if (e.pointerType === 'touch') deg = Math.round(deg / 45) * 45
        else if (e.shiftKey) deg = Math.round(deg / 15) * 15
        deg = ((deg % 360) + 360) % 360
        useDesignStore.getState().updateLayer(drag.layerId, { rotation: Math.round(deg) })
      }
    },
    [computeSnap, expandToGroups, getDesignCoords, hitTest],
  )

  const handlePointerUp = useCallback((e?: React.PointerEvent) => {
    if (e) {
      ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    }

    const drag = dragRef.current

    // Finalize draw-to-create shape
    if (drag?.type === 'draw' && marqueeRect && marqueeRect.w > 10 && marqueeRect.h > 10) {
      useDesignStore.getState().addLayer({
        type: 'shape',
        name: 'Rectangle',
        visible: true,
        locked: false,
        opacity: 1,
        x: Math.round(marqueeRect.x),
        y: Math.round(marqueeRect.y),
        width: Math.round(marqueeRect.w),
        height: Math.round(marqueeRect.h),
        rotation: 0,
        shape: 'rectangle',
        fill: getBrandColor('brand-dark'),
        borderRadius: 7,
      } satisfies Omit<ShapeLayer, 'id' | 'zIndex'>)
      // Switch back to select tool
      useDesignStore.getState().setTool('select')
    }

    // Click (no drag) on an already-selected unit collapses the selection to it.
    if (drag?.type === 'move' && !hasMoved.current && pendingCollapseRef.current) {
      const { ids, activeId } = pendingCollapseRef.current
      useDesignStore.setState({
        selectedLayerIds: new Set(ids),
        activeLayerId: activeId,
      })
    }

    dragRef.current = null
    groupResizeRef.current = null
    pendingCollapseRef.current = null
    dragExceededDeadZone.current = false
    setIsDragging(false)
    setSnapGuides([])
    setSpacingGuides([])
    setMarqueeRect(null)
  }, [marqueeRect])

  const handleResizeStart = useCallback(
    (layerId: string, handle: string, e: React.PointerEvent) => {
      const layer = useDesignStore.getState().getLayer(layerId)
      if (!layer) return

      useDesignStore.getState().pushSnapshot()

      // The rotate handle reuses this entry point (handle === 'rotate') so it
      // doesn't need a separate prop threaded through PreviewPanel.
      if (handle === 'rotate') {
        const cx = layer.x + layer.width / 2
        const cy = layer.y + layer.height / 2
        const p = getDesignCoords(e.clientX, e.clientY)
        dragRef.current = {
          type: 'rotate',
          layerId,
          handle,
          startX: e.clientX,
          startY: e.clientY,
          startLayerX: layer.x,
          startLayerY: layer.y,
          startLayerW: layer.width,
          startLayerH: layer.height,
          centerX: cx,
          centerY: cy,
          startRotation: layer.rotation ?? 0,
          startPointerAngle: (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI,
        }
        hasMoved.current = false
        dragExceededDeadZone.current = true // rotation applies immediately, no dead zone
        setIsDragging(true)
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        return
      }

      dragRef.current = {
        type: 'resize',
        layerId,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startLayerX: layer.x,
        startLayerY: layer.y,
        startLayerW: layer.width,
        startLayerH: layer.height,
      }
      hasMoved.current = false
      setIsDragging(true)
    },
    [getDesignCoords],
  )

  // Begin scaling the whole multi-selection from its combined bounding box.
  const handleGroupResizeStart = useCallback(
    (handle: string, e: React.PointerEvent) => {
      const state = useDesignStore.getState()
      const selected = state.document.layers.filter(
        (l) => state.selectedLayerIds.has(l.id) && l.type !== 'background',
      )
      if (selected.length < 2) return

      const minX = Math.min(...selected.map((l) => l.x))
      const minY = Math.min(...selected.map((l) => l.y))
      const maxX = Math.max(...selected.map((l) => l.x + l.width))
      const maxY = Math.max(...selected.map((l) => l.y + l.height))

      const layerGeo = new Map<string, { x: number; y: number; w: number; h: number; fontSize?: number; borderRadius?: number }>()
      for (const l of selected) {
        layerGeo.set(l.id, {
          x: l.x,
          y: l.y,
          w: l.width,
          h: l.height,
          fontSize: l.type === 'text' ? (l as { fontSize: number }).fontSize : undefined,
          borderRadius: l.type === 'shape' ? (l as { borderRadius: number }).borderRadius : undefined,
        })
      }

      state.pushSnapshot()
      groupResizeRef.current = {
        handle,
        bbox: { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) },
        layers: layerGeo,
      }
      dragRef.current = {
        type: 'group-resize',
        layerId: '',
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startLayerX: minX,
        startLayerY: minY,
        startLayerW: maxX - minX,
        startLayerH: maxY - minY,
      }
      hasMoved.current = false
      setIsDragging(true)
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    },
    [],
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      canvasWrapperRef.current = e.currentTarget as HTMLElement
      const { x, y } = getDesignCoords(e.clientX, e.clientY)
      const hitId = hitTest(x, y)

      if (hitId) {
        const layer = useDesignStore.getState().getLayer(hitId)
        if (layer?.type === 'text') {
          // Clear click ref so we don't double-fire
          lastClickRef.current = null
          useDesignStore.getState().setEditingTextLayerId(hitId)
        } else if (layer?.groupId) {
          // Double-click "enters" a group: select just the clicked child so it
          // can be edited individually without ungrouping.
          useDesignStore.setState({
            selectedLayerIds: new Set([hitId]),
            activeLayerId: hitId,
          })
        }
      }
    },
    [getDesignCoords, hitTest],
  )

  return {
    isDragging,
    snapGuides,
    spacingGuides,
    hoverCursor,
    marqueeRect,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleResizeStart,
    handleGroupResizeStart,
    handleDoubleClick,
  }
}
