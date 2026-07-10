import { useRef, useState, useCallback } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useUIStore } from '@/store/useUIStore'
import type { DrawLayer, DrawMode } from '@/types/design'

/**
 * Freehand pen / highlighter tool. Active only when the current tool is 'draw'.
 * Captures pointer samples (with pressure) in frame-local design coords, shows a
 * live preview, and on pointer-up commits a DrawLayer (bounding-box positioned,
 * points relative to its origin) so the stroke behaves like any other
 * selectable/movable layer.
 *
 * The mode ('pen' vs 'highlighter'), colour, and width come from the UI store;
 * pen and highlighter keep independent colour/width so switching doesn't clobber
 * either. The outline itself is regenerated from the stored points at render
 * time via `getDrawPath`, so nothing about the geometry is baked in here.
 *
 * The handlers return `true` when they consumed the event, so PreviewPanel can
 * fall through to the normal selection/marquee handlers when not drawing.
 */
export function useDrawTool(wrapRef: React.RefObject<HTMLDivElement | null>, zoom: number) {
  const drawingRef = useRef(false)
  const ptsRef = useRef<[number, number][]>([])
  const pressRef = useRef<number[]>([])
  const [preview, setPreview] = useState<[number, number][]>([])
  const [previewPress, setPreviewPress] = useState<number[]>([])

  // Reactive for the live preview; the committed stroke reads fresh at pointer-up.
  const mode = useUIStore((s) => s.drawMode)
  const strokeWidth = useUIStore((s) => (s.drawMode === 'highlighter' ? s.highlighterWidth : s.drawWidth))
  const color = useUIStore((s) => (s.drawMode === 'highlighter' ? s.highlighterColor : s.drawColor))
  // Pen shape controls (ignored for the highlighter, which is a round marker).
  const thinning = useUIStore((s) => s.drawThinning)
  const taper = useUIStore((s) => s.drawTaper)
  const streamline = useUIStore((s) => s.drawSmoothing)

  const localPoint = useCallback((e: React.PointerEvent): [number, number] => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return [(e.clientX - rect.left) / zoom, (e.clientY - rect.top) / zoom]
  }, [wrapRef, zoom])

  // Mouse reports pressure 0 (or a flat 0.5); pens/touch report real values.
  const pressureOf = (e: React.PointerEvent): number =>
    e.pointerType === 'mouse' ? 0.5 : (e.pressure > 0 ? e.pressure : 0.5)

  const onPointerDown = useCallback((e: React.PointerEvent): boolean => {
    if (useDesignStore.getState().tool !== 'draw') return false
    e.preventDefault()
    try { (e.target as Element).setPointerCapture?.(e.pointerId) } catch { /* ignore */ }
    drawingRef.current = true
    ptsRef.current = [localPoint(e)]
    pressRef.current = [pressureOf(e)]
    setPreview([...ptsRef.current])
    setPreviewPress([...pressRef.current])
    return true
  }, [localPoint])

  const onPointerMove = useCallback((e: React.PointerEvent): boolean => {
    if (!drawingRef.current) return false
    // Coalesced events give a denser, smoother sample stream on capable devices.
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function'
      ? e.nativeEvent.getCoalescedEvents()
      : [e.nativeEvent]
    const rect = wrapRef.current!.getBoundingClientRect()
    for (const ev of events) {
      ptsRef.current.push([(ev.clientX - rect.left) / zoom, (ev.clientY - rect.top) / zoom])
      pressRef.current.push(ev.pointerType === 'mouse' ? 0.5 : (ev.pressure > 0 ? ev.pressure : 0.5))
    }
    setPreview([...ptsRef.current])
    setPreviewPress([...pressRef.current])
    return true
  }, [wrapRef, zoom])

  const onPointerUp = useCallback((): boolean => {
    if (!drawingRef.current) return false
    drawingRef.current = false
    const pts = ptsRef.current
    const press = pressRef.current
    ptsRef.current = []
    pressRef.current = []
    setPreview([])
    setPreviewPress([])
    if (pts.length < 2) return true // ignore stray taps

    const ui = useUIStore.getState()
    const drawMode: DrawMode = ui.drawMode
    const drawColor = drawMode === 'highlighter' ? ui.highlighterColor : ui.drawColor
    const drawWidth = drawMode === 'highlighter' ? ui.highlighterWidth : ui.drawWidth

    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    const pad = drawWidth / 2 // half the stroke extends past the centreline
    const rel = pts.map(([x, y]) => [x - minX + pad, y - minY + pad] as [number, number])

    const w = maxX - minX + drawWidth
    const h = maxY - minY + drawWidth
    const d = useDesignStore.getState()
    d.pushSnapshot()
    d.addLayer({
      type: 'draw',
      name: drawMode === 'highlighter' ? 'Highlight' : 'Drawing',
      visible: true,
      locked: false,
      opacity: 1,
      x: minX - pad,
      y: minY - pad,
      width: w,
      height: h,
      rotation: 0,
      points: rel,
      pressures: press,
      color: drawColor,
      strokeWidth: drawWidth,
      mode: drawMode,
      // Persist the pen shape so a committed stroke re-renders identically and
      // can be restyled later. Highlighter keeps its constant-width round default.
      ...(drawMode === 'pen'
        ? { thinning: ui.drawThinning, taper: ui.drawTaper, streamline: ui.drawSmoothing }
        : {}),
      natWidth: w,
      natHeight: h,
    } as Omit<DrawLayer, 'id' | 'zIndex'>)
    return true
  }, [])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    preview,
    previewPress,
    mode,
    strokeWidth,
    color,
    thinning,
    taper,
    streamline,
    drawing: preview.length > 0,
  }
}
