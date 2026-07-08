import { useCallback, useEffect, useRef } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import type { AdFormat } from '@/types/design'

const FIT_RATIO = 0.9

export function calcFitZoom(
  containerWidth: number,
  containerHeight: number,
  format: AdFormat,
): number {
  if (containerWidth <= 0 || containerHeight <= 0) return 0.5
  const scaleX = (containerWidth * FIT_RATIO) / format.width
  const scaleY = (containerHeight * FIT_RATIO) / format.height
  return Math.min(scaleX, scaleY, 3)
}

export function useSmartZoom(containerRef: React.RefObject<HTMLDivElement | null>) {
  const animRef = useRef<number>(0)
  const prevFormatRef = useRef<string | null>(null)

  const getContainerSize = useCallback(() => {
    const el = containerRef.current
    if (!el) return { w: 800, h: 600 }
    const rect = el.getBoundingClientRect()
    return { w: rect.width, h: rect.height }
  }, [containerRef])

  const smoothZoomTo = useCallback((targetZoom: number, duration = 250) => {
    cancelAnimationFrame(animRef.current)

    const startZoom = useDesignStore.getState().zoom
    const startTime = performance.now()
    const delta = targetZoom - startZoom

    if (Math.abs(delta) < 0.005) {
      useDesignStore.getState().setZoom(targetZoom)
      return
    }

    const animate = (now: number) => {
      const elapsed = now - startTime
      const t = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      useDesignStore.getState().setZoom(startZoom + delta * eased)
      if (t < 1) {
        animRef.current = requestAnimationFrame(animate)
      }
    }

    animRef.current = requestAnimationFrame(animate)
  }, [])

  const smoothPanTo = useCallback((targetX: number, targetY: number, duration = 250) => {
    cancelAnimationFrame(animRef.current)

    const startPan = useDesignStore.getState().panOffset
    const startTime = performance.now()
    const dx = targetX - startPan.x
    const dy = targetY - startPan.y

    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      useDesignStore.getState().setPanOffset({ x: targetX, y: targetY })
      return
    }

    const animate = (now: number) => {
      const elapsed = now - startTime
      const t = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      useDesignStore.getState().setPanOffset({
        x: startPan.x + dx * eased,
        y: startPan.y + dy * eased,
      })
      if (t < 1) {
        animRef.current = requestAnimationFrame(animate)
      }
    }

    animRef.current = requestAnimationFrame(animate)
  }, [])

  const fitToView = useCallback(() => {
    const { w, h } = getContainerSize()
    const format = useDesignStore.getState().document.format
    const target = calcFitZoom(w, h, format)
    smoothZoomTo(target)
    smoothPanTo(0, 0, 250)
  }, [getContainerSize, smoothZoomTo, smoothPanTo])

  const centreInView = useCallback(() => {
    smoothPanTo(0, 0, 200)
  }, [smoothPanTo])

  // Fit on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      fitToView()
      prevFormatRef.current = useDesignStore.getState().document.format.id
    }, 50)
    return () => clearTimeout(timer)
  }, [fitToView])

  // Watch for format changes and auto-fit
  useEffect(() => {
    const unsub = useDesignStore.subscribe((state) => {
      const currentId = state.document.format.id
      if (prevFormatRef.current && prevFormatRef.current !== currentId) {
        prevFormatRef.current = currentId
        const { w, h } = getContainerSize()
        const target = calcFitZoom(w, h, state.document.format)
        smoothZoomTo(target)
        smoothPanTo(0, 0, 250)
      }
    })
    return unsub
  }, [getContainerSize, smoothZoomTo, smoothPanTo])

  // Wheel handler — pinch-to-zoom AND two-finger pan
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()

      if (e.ctrlKey) {
        // Pinch-to-zoom (trackpad sends ctrlKey for pinch gestures)
        const currentZoom = useDesignStore.getState().zoom
        const factor = e.deltaY > 0 ? 0.97 : 1.03
        const newZoom = Math.max(0.1, Math.min(4, currentZoom * factor))
        useDesignStore.getState().setZoom(newZoom)
      } else {
        // Two-finger scroll = pan
        const pan = useDesignStore.getState().panOffset
        useDesignStore.getState().setPanOffset({
          x: pan.x - e.deltaX,
          y: pan.y - e.deltaY,
        })
      }
    },
    [],
  )

  const zoomIn = useCallback(() => {
    const current = useDesignStore.getState().zoom
    smoothZoomTo(Math.min(4, current * 1.25), 200)
  }, [smoothZoomTo])

  const zoomOut = useCallback(() => {
    const current = useDesignStore.getState().zoom
    smoothZoomTo(Math.max(0.1, current / 1.25), 200)
  }, [smoothZoomTo])

  return {
    handleWheel,
    fitToView,
    centreInView,
    zoomIn,
    zoomOut,
  }
}
