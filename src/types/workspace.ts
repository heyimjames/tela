import type { Layer, AdFormat, BackgroundFill, BrandColor, AutoLayoutConfig } from '@/types/design'

/**
 * A Frame is an artboard on the infinite canvas.
 * Each frame has its own dimensions, background, and layer stack.
 * Layers within a frame use coordinates relative to the frame's origin.
 */
export interface Frame {
  id: string
  name: string
  // Position on the workspace canvas
  x: number
  y: number
  // Dimensions
  width: number
  height: number
  // Frame-specific properties
  format: AdFormat
  backgroundColor: BrandColor
  backgroundFill: BackgroundFill
  // Layers within this frame
  layers: Layer[]
  // Auto Layout configs for this frame's groups (keyed by groupId). Persisted so
  // the layout survives frame switches, save/load, and duplication.
  autoLayouts?: Record<string, AutoLayoutConfig>
  // Metadata
  locked: boolean
  visible: boolean
}

/**
 * A Page is a separate canvas within a workspace.
 * Like Figma pages — each page has its own frames and loose elements.
 */
export interface Page {
  id: string
  name: string
  frames: Frame[]
  // Loose elements on the canvas (not inside any frame — scratchpad items)
  looseElements: Layer[]
}

/**
 * The Workspace is the root container — holds multiple pages.
 */
export interface Workspace {
  id: string
  name: string
  pages: Page[]
  activePageId: string
  // Global workspace settings
  showFrameLabels: boolean
  snapFrames: boolean
}
