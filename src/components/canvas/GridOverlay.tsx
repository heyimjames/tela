import { useDesignStore } from '@/store/useDesignStore'
import { useUIStore, resolveGrid, type GridConfig } from '@/store/useUIStore'

interface Props {
  zoom: number
}

export function GridOverlay({ zoom }: Props) {
  const showGrid = useUIStore((s) => s.showGrid)
  const gridConfig = useUIStore((s) => s.gridConfig)
  const format = useDesignStore((s) => s.document.format)

  if (!showGrid) return null

  const w = format.width * zoom
  const h = format.height * zoom
  // Resolve against the active frame so the grid fills it and adapts to its
  // aspect ratio (square modules, proportional margins/gutters).
  const { columns, rows, padding, gutter, cellW, cellH } = resolveGrid(gridConfig, format)

  const innerW = format.width - padding * 2
  const innerH = format.height - padding * 2

  const cells: Array<{ x: number; y: number; w: number; h: number }> = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      cells.push({
        x: (padding + col * (cellW + gutter)) * zoom,
        y: (padding + row * (cellH + gutter)) * zoom,
        w: cellW * zoom,
        h: cellH * zoom,
      })
    }
  }

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      width={w}
      height={h}
    >
      <rect
        x={padding * zoom} y={padding * zoom}
        width={innerW * zoom} height={innerH * zoom}
        fill="none" stroke="#0017c7" strokeWidth={0.5} strokeDasharray="4 4" opacity={0.2}
      />
      {cells.map((cell, i) => (
        <rect key={i}
          x={cell.x} y={cell.y} width={cell.w} height={cell.h}
          fill="#0017c7" fillOpacity={0.04}
          stroke="#0017c7" strokeWidth={0.5} strokeOpacity={0.15}
        />
      ))}
      <line x1={w / 2} y1={0} x2={w / 2} y2={h} stroke="#F56139" strokeWidth={0.5} strokeDasharray="6 4" opacity={0.25} />
      <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="#F56139" strokeWidth={0.5} strokeDasharray="6 4" opacity={0.25} />
    </svg>
  )
}

export function getGridSnapTargets(
  format: { width: number; height: number },
  gridConfig: GridConfig,
): { snapX: number[]; snapY: number[] } {
  const { columns, rows, padding, gutter, cellW, cellH } = resolveGrid(gridConfig, format)
  const snapX: number[] = [padding]
  const snapY: number[] = [padding]
  for (let col = 0; col <= columns; col++) {
    const x = padding + col * (cellW + gutter)
    snapX.push(Math.round(x))
    if (col < columns) snapX.push(Math.round(x + cellW))
  }
  for (let row = 0; row <= rows; row++) {
    const y = padding + row * (cellH + gutter)
    snapY.push(Math.round(y))
    if (row < rows) snapY.push(Math.round(y + cellH))
  }
  return { snapX: [...new Set(snapX)], snapY: [...new Set(snapY)] }
}
