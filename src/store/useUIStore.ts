import { create } from 'zustand'
import { getBrandColor } from '@/brand/palette'
import type { BrandColor, DrawMode } from '@/types/design'

export interface GridConfig {
  columns: number
  // `'auto'` derives the row count from the frame's aspect ratio so modules stay
  // roughly square (the grid reflects whatever frame it's drawn on).
  rows: number | 'auto'
  // Outer margin + gutter expressed as a fraction of the frame's *shorter* side,
  // so spacing scales consistently across frames of any size.
  marginRatio: number
  gutterRatio: number
}

// Concrete, pixel-space grid resolved against a specific frame format.
export interface ResolvedGrid {
  columns: number
  rows: number
  padding: number
  gutter: number
  cellW: number
  cellH: number
}

// Resolve a (possibly adaptive) grid config into concrete pixel values for a
// given frame size. `rows: 'auto'` picks a row count that keeps cells ~square,
// so the same preset fills a square, portrait, or landscape frame correctly.
export function resolveGrid(
  config: GridConfig,
  format: { width: number; height: number },
): ResolvedGrid {
  const minDim = Math.min(format.width, format.height)
  const padding = Math.max(0, Math.round(config.marginRatio * minDim))
  const gutter = Math.max(0, Math.round(config.gutterRatio * minDim))
  const columns = Math.max(1, Math.round(config.columns))
  const innerW = Math.max(1, format.width - padding * 2)
  const innerH = Math.max(1, format.height - padding * 2)
  const cellW = (innerW - gutter * (columns - 1)) / columns
  const rows =
    config.rows === 'auto'
      ? Math.max(1, Math.round((innerH + gutter) / (cellW + gutter)))
      : Math.max(1, Math.round(config.rows))
  const cellH = (innerH - gutter * (rows - 1)) / rows
  return { columns, rows, padding, gutter, cellW, cellH }
}

const GRID_PRESETS: Record<string, GridConfig> = {
  thirds: { columns: 3, rows: 3, marginRatio: 0.04, gutterRatio: 0.02 },
  square: { columns: 4, rows: 'auto', marginRatio: 0.04, gutterRatio: 0.02 },
  grid: { columns: 6, rows: 'auto', marginRatio: 0.035, gutterRatio: 0.016 },
  dense: { columns: 8, rows: 'auto', marginRatio: 0.03, gutterRatio: 0.012 },
  fine: { columns: 12, rows: 'auto', marginRatio: 0.025, gutterRatio: 0.01 },
  micro: { columns: 16, rows: 'auto', marginRatio: 0.02, gutterRatio: 0.008 },
}

export type AppMode = 'basic' | 'pro'

interface UIStore {
  // Mode
  appMode: AppMode
  settingsOpen: boolean

  leftPanel: 'layers'
  rightPanel: 'inspector' | 'export' | 'auto-resize' | 'ai'

  mobileDrawer: 'layers' | 'inspector' | null

  formatSelectorOpen: boolean
  exportPanelOpen: boolean

  showGrid: boolean
  snapToGrid: boolean
  smartPadding: boolean
  gridConfig: GridConfig
  gridPreset: string

  // Pen tool settings (shown in the right sidebar when the draw tool is active).
  drawMode: DrawMode
  // Pen and highlighter keep independent colours so toggling doesn't clobber
  // your marker colour with your ink colour and vice-versa.
  drawColor: BrandColor
  highlighterColor: BrandColor
  drawWidth: number
  highlighterWidth: number
  // Pen shape controls (highlighter is a constant-width round marker, so these
  // only apply to the pen): pressure→width variation, end taper, and smoothing.
  drawThinning: number
  drawTaper: number
  drawSmoothing: number

  // Arrow-key nudge distances in design px. Plain arrow uses `nudgeSmall`;
  // Shift+arrow uses `nudgeLarge`.
  nudgeSmall: number
  nudgeLarge: number

  // Actions
  setAppMode: (mode: AppMode) => void
  setSettingsOpen: (open: boolean) => void
  setRightPanel: (panel: UIStore['rightPanel']) => void
  setMobileDrawer: (drawer: UIStore['mobileDrawer']) => void
  setFormatSelectorOpen: (open: boolean) => void
  setExportPanelOpen: (open: boolean) => void
  toggleGrid: () => void
  toggleSnap: () => void
  toggleSmartPadding: () => void
  setGridPreset: (preset: string) => void
  setGridConfig: (config: Partial<GridConfig>) => void
  setDrawMode: (mode: DrawMode) => void
  setDrawColor: (color: BrandColor) => void
  setHighlighterColor: (color: BrandColor) => void
  setDrawWidth: (width: number) => void
  setHighlighterWidth: (width: number) => void
  setDrawThinning: (n: number) => void
  setDrawTaper: (n: number) => void
  setDrawSmoothing: (n: number) => void
  setNudgeSmall: (n: number) => void
  setNudgeLarge: (n: number) => void
}

export const useUIStore = create<UIStore>((set) => ({
  appMode: 'pro' as AppMode,
  settingsOpen: false,

  leftPanel: 'layers',
  rightPanel: 'inspector',

  mobileDrawer: null,

  formatSelectorOpen: false,
  exportPanelOpen: false,

  showGrid: false,
  snapToGrid: true,
  smartPadding: true,
  gridConfig: GRID_PRESETS.grid,
  gridPreset: 'grid',

  drawMode: 'pen' as DrawMode,
  drawColor: getBrandColor('charcoal'),
  highlighterColor: getBrandColor('gold-300'),
  drawWidth: 6,
  highlighterWidth: 22,
  drawThinning: 0.55,
  // A gentle taper (not a full calligraphic point) reads like a real pen and
  // keeps short strokes visible; crank it to "Pointed" for sharp ends.
  drawTaper: 0.5,
  drawSmoothing: 0.5,

  nudgeSmall: 1,
  nudgeLarge: 10,

  setAppMode: (mode) => set({ appMode: mode }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setRightPanel: (panel) => set({ rightPanel: panel }),
  setMobileDrawer: (drawer) => set({ mobileDrawer: drawer }),
  setFormatSelectorOpen: (open) => set({ formatSelectorOpen: open }),
  setExportPanelOpen: (open) => set({ exportPanelOpen: open }),
  setDrawMode: (mode) => set({ drawMode: mode }),
  setDrawColor: (color) => set({ drawColor: color }),
  setHighlighterColor: (color) => set({ highlighterColor: color }),
  setDrawWidth: (width) => set({ drawWidth: width }),
  setHighlighterWidth: (width) => set({ highlighterWidth: width }),
  setDrawThinning: (n) => set({ drawThinning: n }),
  setDrawTaper: (n) => set({ drawTaper: n }),
  setDrawSmoothing: (n) => set({ drawSmoothing: n }),
  setNudgeSmall: (n) => set({ nudgeSmall: Math.max(0.1, n) }),
  setNudgeLarge: (n) => set({ nudgeLarge: Math.max(1, n) }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleSnap: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
  toggleSmartPadding: () => set((s) => ({ smartPadding: !s.smartPadding })),

  setGridPreset: (preset) => {
    const config = GRID_PRESETS[preset]
    if (config) {
      set({ gridPreset: preset, gridConfig: config })
    }
  },

  setGridConfig: (partial) => {
    set((s) => ({
      gridConfig: { ...s.gridConfig, ...partial },
      gridPreset: 'custom',
    }))
  },
}))

export { GRID_PRESETS }
