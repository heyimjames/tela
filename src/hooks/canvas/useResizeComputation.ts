import { useDesignStore } from '@/store/useDesignStore'
import { useUIStore } from '@/store/useUIStore'
import { getGridSnapTargets } from '@/components/canvas/GridOverlay'

const SNAP_THRESHOLD = 6 // px in design space

interface DragState {
  type: 'move' | 'resize' | 'pan' | 'marquee' | 'draw' | 'group-resize' | 'rotate'
  layerId: string
  handle?: string
  startX: number
  startY: number
  startLayerX: number
  startLayerY: number
  startLayerW: number
  startLayerH: number
  startPanX?: number
  startPanY?: number
}

export function computeResize(
  drag: DragState,
  dx: number,
  dy: number,
  constrainAspect = false,
): { x?: number; y?: number; width?: number; height?: number } {
  const h = drag.handle!
  const updates: { x?: number; y?: number; width?: number; height?: number } = {}

  // Collect snap targets for edges: frame edges/center + grid + other layers'
  // edges/centers (mirrors the move-time snapping in useSnapComputation).
  const state = useDesignStore.getState()
  const format = state.document.format
  const snapX: number[] = [0, format.width / 2, format.width]
  const snapY: number[] = [0, format.height / 2, format.height]

  const otherLayers = state.document.layers.filter(
    (l) => l.id !== drag.layerId && l.type !== 'background' && l.visible,
  )
  for (const l of otherLayers) {
    snapX.push(l.x, l.x + l.width / 2, l.x + l.width)
    snapY.push(l.y, l.y + l.height / 2, l.y + l.height)
  }

  const uiState = useUIStore.getState()
  if (uiState.showGrid) {
    const gridTargets = getGridSnapTargets(format, uiState.gridConfig)
    snapX.push(...gridTargets.snapX)
    snapY.push(...gridTargets.snapY)
  }

  const snapVal = (raw: number, targets: number[]): number => {
    let best = raw
    let bestDist = SNAP_THRESHOLD + 1
    for (const t of targets) {
      const dist = Math.abs(raw - t)
      if (dist < bestDist) {
        bestDist = dist
        best = t
      }
    }
    return bestDist <= SNAP_THRESHOLD ? Math.round(best) : Math.round(raw)
  }

  if (h.includes('w')) {
    const rawX = drag.startLayerX + dx
    const snappedX = snapVal(rawX, snapX)
    updates.x = snappedX
    updates.width = Math.max(20, Math.round(drag.startLayerW - (snappedX - drag.startLayerX)))
  } else if (h.includes('e')) {
    const rawRight = drag.startLayerX + drag.startLayerW + dx
    const snappedRight = snapVal(rawRight, snapX)
    updates.width = Math.max(20, Math.round(snappedRight - drag.startLayerX))
  }

  if (h.includes('n')) {
    const rawY = drag.startLayerY + dy
    const snappedY = snapVal(rawY, snapY)
    updates.y = snappedY
    updates.height = Math.max(20, Math.round(drag.startLayerH - (snappedY - drag.startLayerY)))
  } else if (h.includes('s')) {
    const rawBottom = drag.startLayerY + drag.startLayerH + dy
    const snappedBottom = snapVal(rawBottom, snapY)
    updates.height = Math.max(20, Math.round(snappedBottom - drag.startLayerY))
  }

  // Constrain aspect ratio when Shift is held (Figma convention) or the layer
  // has a persistent aspect-ratio lock.
  const layer = state.getLayer(drag.layerId)
  const shouldConstrainAspect = (constrainAspect || layer?.aspectRatioLocked) ?? false
  if (shouldConstrainAspect && drag.startLayerW > 0 && drag.startLayerH > 0) {
    const ratio = drag.startLayerW / drag.startLayerH
    if (updates.width != null && updates.height == null) {
      updates.height = Math.max(20, Math.round(updates.width / ratio))
    } else if (updates.height != null && updates.width == null) {
      updates.width = Math.max(20, Math.round(updates.height * ratio))
    } else if (updates.width != null && updates.height != null) {
      // Corner handle — use the larger delta to determine size
      const newRatio = updates.width / updates.height
      if (newRatio > ratio) {
        updates.height = Math.max(20, Math.round(updates.width / ratio))
      } else {
        updates.width = Math.max(20, Math.round(updates.height * ratio))
      }
    }
  }

  return updates
}
