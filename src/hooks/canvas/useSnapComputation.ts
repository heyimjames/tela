import { useCallback } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useUIStore } from '@/store/useUIStore'
import { getGridSnapTargets } from '@/components/canvas/GridOverlay'
import type { LayerId } from '@/types/design'

const SNAP_THRESHOLD = 9 // px in design space (stronger pull)
const SPACING_THRESHOLD = 8 // px pull for equal-spacing (distribution) snap

export interface SnapGuide {
  orientation: 'h' | 'v'
  position: number
}

// An equal-spacing (distribution) guide: a set of equal gaps highlighted along
// one axis with the shared gap value, e.g. three stacked layers all 24px apart.
export interface SpacingGuide {
  axis: 'x' | 'y' // 'y' = layers stacked vertically, gaps measured along Y
  value: number // the equal gap in px
  segments: { start: number; end: number; cross: number }[] // each gap span + its perpendicular position
}

export interface SnapResult {
  x: number
  y: number
  guides: SnapGuide[]
  spacing?: SpacingGuide[]
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// Equal-spacing snap: when the moving box drifts into a rhythm established by
// two or more stationary siblings (matching gap before/after the run, or
// centered between a pair), pull it so the new gap equals the existing rhythm,
// and report every equal gap so the UI can highlight the whole run. Mirrors
// Figma's "smart spacing". Returns null if no rhythm is within threshold.
function rhythmSnap(
  axis: 'x' | 'y',
  mv: Rect,
  others: Rect[],
  threshold: number,
): { pos: number; guide: SpacingGuide } | null {
  // Primary axis = the stacking direction; perpendicular = overlap axis.
  const start = (r: Rect) => (axis === 'y' ? r.y : r.x)
  const size = (r: Rect) => (axis === 'y' ? r.height : r.width)
  const pStart = (r: Rect) => (axis === 'y' ? r.x : r.y)
  const pSize = (r: Rect) => (axis === 'y' ? r.width : r.height)
  const gapBetween = (a: Rect, b: Rect) => start(b) - (start(a) + size(a))

  const mvPS = pStart(mv)
  const mvPE = pStart(mv) + pSize(mv)
  // Stationary layers that overlap the moving box on the perpendicular axis —
  // i.e. they share a column (vertical rhythm) or a row (horizontal rhythm).
  const col = others.filter((l) => pStart(l) < mvPE && pStart(l) + pSize(l) > mvPS)
  if (col.length < 2) return null

  const sorted = [...col].sort((a, b) => start(a) - start(b))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const firstGap = gapBetween(sorted[0], sorted[1])
  const lastGap = gapBetween(sorted[sorted.length - 2], sorted[sorted.length - 1])
  const mvSize = size(mv)

  const cands: { pos: number; G: number }[] = []
  // Extend the rhythm before the run / after the run.
  if (firstGap > 0) cands.push({ pos: start(first) - firstGap - mvSize, G: firstGap })
  if (lastGap > 0) cands.push({ pos: start(last) + size(last) + lastGap, G: lastGap })
  // Or drop it centered between a consecutive pair (two equal sub-gaps).
  for (let i = 0; i < sorted.length - 1; i++) {
    const g = gapBetween(sorted[i], sorted[i + 1])
    if (g > mvSize + 1) {
      const sub = (g - mvSize) / 2
      cands.push({ pos: start(sorted[i]) + size(sorted[i]) + sub, G: sub })
    }
  }

  const mvStart = start(mv)
  let best: { pos: number; G: number; d: number } | null = null
  for (const c of cands) {
    const d = Math.abs(c.pos - mvStart)
    if (d <= threshold && (!best || d < best.d)) best = { pos: c.pos, G: c.G, d }
  }
  if (!best) return null

  // Place the moving box at the snapped position, then highlight every gap in the
  // resulting sequence that matches the rhythm (the existing ones + the new one).
  const placed: Rect = axis === 'y' ? { ...mv, y: best.pos } : { ...mv, x: best.pos }
  const seq = [...col, placed].sort((a, b) => start(a) - start(b))
  const cross = pStart(mv) + pSize(mv) / 2
  const segments: { start: number; end: number; cross: number }[] = []
  for (let i = 0; i < seq.length - 1; i++) {
    const g = gapBetween(seq[i], seq[i + 1])
    if (g > 0 && Math.abs(g - best.G) <= 1.5) {
      segments.push({ start: start(seq[i]) + size(seq[i]), end: start(seq[i + 1]), cross })
    }
  }
  if (segments.length === 0) return null

  return { pos: Math.round(best.pos), guide: { axis, value: Math.round(best.G), segments } }
}

export function useSnapComputation() {
  return useCallback(
    (
      layerId: LayerId,
      rawX: number,
      rawY: number,
      w: number,
      h: number,
      excludeIds?: ReadonlySet<string>,
      equalPad?: boolean,
    ): SnapResult => {
      const state = useDesignStore.getState()
      const format = state.document.format
      // Exclude the dragged layer and any co-moving members of the selection so
      // the moving set never snaps to itself (which causes jitter).
      const otherLayers = state.document.layers.filter(
        (l) =>
          l.id !== layerId &&
          !excludeIds?.has(l.id) &&
          l.type !== 'background' &&
          l.visible,
      )

      // Collect snap targets: canvas edges, center, and other layers' edges/centers
      const snapTargetsX: number[] = [0, format.width / 2, format.width]
      const snapTargetsY: number[] = [0, format.height / 2, format.height]

      for (const l of otherLayers) {
        snapTargetsX.push(l.x, l.x + l.width / 2, l.x + l.width)
        snapTargetsY.push(l.y, l.y + l.height / 2, l.y + l.height)
      }

      // Add grid snap targets when grid is visible
      const uiState = useUIStore.getState()
      if (uiState.showGrid) {
        const gridTargets = getGridSnapTargets(format, uiState.gridConfig)
        snapTargetsX.push(...gridTargets.snapX)
        snapTargetsY.push(...gridTargets.snapY)
      }

      // Layer edges and center
      const layerPointsX = [rawX, rawX + w / 2, rawX + w]
      const layerPointsY = [rawY, rawY + h / 2, rawY + h]

      let snappedX = rawX
      let snappedY = rawY
      let bestDx = SNAP_THRESHOLD + 1
      let bestDy = SNAP_THRESHOLD + 1
      // Track only the SINGLE winning guide position per axis. Pushing a guide on
      // every improvement left stale guides in the array, so several rendered per
      // axis; instead we remember just the best target and emit it once below.
      let bestGuideX: number | null = null
      let bestGuideY: number | null = null

      for (const lx of layerPointsX) {
        for (const tx of snapTargetsX) {
          const dist = Math.abs(lx - tx)
          if (dist < bestDx) {
            bestDx = dist
            snappedX = rawX + (tx - lx)
            bestGuideX = tx
          }
        }
      }

      for (const ly of layerPointsY) {
        for (const ty of snapTargetsY) {
          const dist = Math.abs(ly - ty)
          if (dist < bestDy) {
            bestDy = dist
            snappedY = rawY + (ty - ly)
            bestGuideY = ty
          }
        }
      }

      // Emit at most one guide per axis: the winning target.
      const activeGuides: SnapGuide[] = []
      if (bestGuideX != null && bestDx <= SNAP_THRESHOLD) {
        activeGuides.push({ orientation: 'v', position: bestGuideX })
      }
      if (bestGuideY != null && bestDy <= SNAP_THRESHOLD) {
        activeGuides.push({ orientation: 'h', position: bestGuideY })
      }

      let finalX = bestDx <= SNAP_THRESHOLD ? Math.round(snappedX) : Math.round(rawX)
      let finalY = bestDy <= SNAP_THRESHOLD ? Math.round(snappedY) : Math.round(rawY)

      // Shift-drag → snap to EQUAL padding from the two nearest perpendicular
      // sides (a corner): e.g. equal gap to top+left, or top+right, etc. Uses the
      // innermost containing layer if the box sits inside one, else the frame.
      // This is a hard constraint (overrides the soft snap) while Shift is held.
      if (equalPad) {
        const container =
          otherLayers
            .filter((l) => l.x <= finalX && l.y <= finalY && l.x + l.width >= finalX + w && l.y + l.height >= finalY + h)
            .sort((a, b) => a.width * a.height - b.width * b.height)[0]
          ?? { x: 0, y: 0, width: format.width, height: format.height }

        const left = finalX - container.x
        const right = container.x + container.width - (finalX + w)
        const top = finalY - container.y
        const bottom = container.y + container.height - (finalY + h)
        const nH = Math.abs(left) <= Math.abs(right) ? { side: 'left' as const, val: left } : { side: 'right' as const, val: right }
        const nV = Math.abs(top) <= Math.abs(bottom) ? { side: 'top' as const, val: top } : { side: 'bottom' as const, val: bottom }
        const pad = Math.round((nH.val + nV.val) / 2)

        finalX = nH.side === 'left' ? container.x + pad : container.x + container.width - w - pad
        finalY = nV.side === 'top' ? container.y + pad : container.y + container.height - h - pad

        return {
          x: finalX,
          y: finalY,
          guides: [
            { orientation: 'v', position: nH.side === 'left' ? finalX : finalX + w },
            { orientation: 'h', position: nV.side === 'top' ? finalY : finalY + h },
          ],
        }
      }

      // Smart padding snap: equalize distance to closest edges of containing layers
      // Works with ANY edge pair (top-left, top-right, left-bottom, etc.) not just parallel edges.
      // Always on in Basic (a guardrail); a toggle in Pro.
      if (uiState.smartPadding || uiState.appMode !== 'pro') {
        const PADDING_THRESHOLD = 15

        const containers = [
          { x: 0, y: 0, width: format.width, height: format.height },
          ...otherLayers.filter((l) =>
            l.x <= finalX && l.y <= finalY &&
            l.x + l.width >= finalX + w && l.y + l.height >= finalY + h
          ),
        ]

        for (const c of containers) {
          const dLeft = finalX - c.x
          const dRight = (c.x + c.width) - (finalX + w)
          const dTop = finalY - c.y
          const dBottom = (c.y + c.height) - (finalY + h)

          // All four distances
          const distances = [
            { axis: 'x' as const, dir: 'left' as const, val: dLeft },
            { axis: 'x' as const, dir: 'right' as const, val: dRight },
            { axis: 'y' as const, dir: 'top' as const, val: dTop },
            { axis: 'y' as const, dir: 'bottom' as const, val: dBottom },
          ].filter((d) => d.val > 0)

          // Find the two closest distances regardless of axis
          // and snap them equal if they're within threshold
          for (let i = 0; i < distances.length; i++) {
            for (let j = i + 1; j < distances.length; j++) {
              const a = distances[i]
              const b = distances[j]
              const diff = Math.abs(a.val - b.val)

              if (diff > 0 && diff < PADDING_THRESHOLD) {
                const avg = Math.round((a.val + b.val) / 2)

                // Apply the equalized distance
                if (a.axis === 'x' && a.dir === 'left') finalX = c.x + avg
                if (a.axis === 'x' && a.dir === 'right') finalX = c.x + c.width - w - avg
                if (a.axis === 'y' && a.dir === 'top') finalY = c.y + avg
                if (a.axis === 'y' && a.dir === 'bottom') finalY = c.y + c.height - h - avg
                if (b.axis === 'x' && b.dir === 'left') finalX = c.x + avg
                if (b.axis === 'x' && b.dir === 'right') finalX = c.x + c.width - w - avg
                if (b.axis === 'y' && b.dir === 'top') finalY = c.y + avg
                if (b.axis === 'y' && b.dir === 'bottom') finalY = c.y + c.height - h - avg

                // Show guides for the equalized edges
                if (a.dir === 'left' || b.dir === 'left') activeGuides.push({ orientation: 'v', position: finalX })
                if (a.dir === 'right' || b.dir === 'right') activeGuides.push({ orientation: 'v', position: finalX + w })
                if (a.dir === 'top' || b.dir === 'top') activeGuides.push({ orientation: 'h', position: finalY })
                if (a.dir === 'bottom' || b.dir === 'bottom') activeGuides.push({ orientation: 'h', position: finalY + h })
              }
            }
          }
        }
      }

      // Equal-spacing (distribution) snap. Runs only on an axis the edge/centre
      // snap did NOT already lock, so it kicks in exactly when the box is
      // floating free into a sibling rhythm rather than aligning to an edge.
      const spacing: SpacingGuide[] = []
      if (bestDy > SNAP_THRESHOLD) {
        const r = rhythmSnap('y', { x: finalX, y: finalY, width: w, height: h }, otherLayers, SPACING_THRESHOLD)
        if (r) {
          finalY = r.pos
          spacing.push(r.guide)
        }
      }
      if (bestDx > SNAP_THRESHOLD) {
        const r = rhythmSnap('x', { x: finalX, y: finalY, width: w, height: h }, otherLayers, SPACING_THRESHOLD)
        if (r) {
          finalX = r.pos
          spacing.push(r.guide)
        }
      }

      return {
        x: finalX,
        y: finalY,
        guides: activeGuides,
        spacing: spacing.length ? spacing : undefined,
      }
    },
    [],
  )
}
