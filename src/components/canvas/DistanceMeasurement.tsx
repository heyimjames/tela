import { useState, useEffect } from 'react'
import { useDesignStore } from '@/store/useDesignStore'

interface Measurement {
  // Lines to draw (from point to point)
  lines: Array<{ x1: number; y1: number; x2: number; y2: number; label: string }>
}

interface Props {
  zoom: number
}

export function DistanceMeasurement({ zoom }: Props) {
  const [altHeld, setAltHeld] = useState(false)
  const [, setMousePos] = useState<{ x: number; y: number } | null>(null)
  const activeLayerId = useDesignStore((s) => s.activeLayerId)
  const layers = useDesignStore((s) => s.document.layers)
  const format = useDesignStore((s) => s.document.format)

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(true) }
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(false) }
    const move = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY })
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('mousemove', move)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('mousemove', move)
    }
  }, [])

  if (!altHeld || !activeLayerId) return null

  const activeLayer = layers.find((l) => l.id === activeLayerId)
  if (!activeLayer || activeLayer.type === 'background') return null

  // Measure distances to canvas edges
  const measurements: Measurement = { lines: [] }

  const ax = activeLayer.x
  const ay = activeLayer.y
  const aw = activeLayer.width
  const ah = activeLayer.height

  // Distance to canvas edges
  const distTop = ay
  const distBottom = format.height - (ay + ah)
  const distLeft = ax
  const distRight = format.width - (ax + aw)

  const midX = ax + aw / 2
  const midY = ay + ah / 2

  if (distTop > 0) {
    measurements.lines.push({ x1: midX, y1: 0, x2: midX, y2: ay, label: `${Math.round(distTop)}` })
  }
  if (distBottom > 0) {
    measurements.lines.push({ x1: midX, y1: ay + ah, x2: midX, y2: format.height, label: `${Math.round(distBottom)}` })
  }
  if (distLeft > 0) {
    measurements.lines.push({ x1: 0, y1: midY, x2: ax, y2: midY, label: `${Math.round(distLeft)}` })
  }
  if (distRight > 0) {
    measurements.lines.push({ x1: ax + aw, y1: midY, x2: format.width, y2: midY, label: `${Math.round(distRight)}` })
  }

  if (measurements.lines.length === 0) return null

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: format.width * zoom, height: format.height * zoom, overflow: 'visible' }}
    >
      {measurements.lines.map((line, i) => {
        const x1 = line.x1 * zoom
        const y1 = line.y1 * zoom
        const x2 = line.x2 * zoom
        const y2 = line.y2 * zoom
        const midLX = (x1 + x2) / 2
        const midLY = (y1 + y2) / 2
        const isVertical = Math.abs(x1 - x2) < 1

        return (
          <g key={i}>
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="#F56139"
              strokeWidth={1}
              strokeDasharray="3 2"
            />
            {/* End caps */}
            {isVertical ? (
              <>
                <line x1={x1 - 4} y1={y1} x2={x1 + 4} y2={y1} stroke="#F56139" strokeWidth={1} />
                <line x1={x2 - 4} y1={y2} x2={x2 + 4} y2={y2} stroke="#F56139" strokeWidth={1} />
              </>
            ) : (
              <>
                <line x1={x1} y1={y1 - 4} x2={x1} y2={y1 + 4} stroke="#F56139" strokeWidth={1} />
                <line x1={x2} y1={y2 - 4} x2={x2} y2={y2 + 4} stroke="#F56139" strokeWidth={1} />
              </>
            )}
            {/* Label */}
            <rect
              x={midLX - 16}
              y={midLY - 8}
              width={32}
              height={16}
              rx={3}
              fill="#F56139"
            />
            <text
              x={midLX}
              y={midLY + 4}
              textAnchor="middle"
              fill="white"
              fontSize={10}
              fontFamily="'Inter Variable', system-ui"
              fontWeight={600}
            >
              {line.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
