import { useEffect, useRef } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useUIStore } from '@/store/useUIStore'
import { useIsProMode } from '@/hooks/useIsProMode'
import { BackgroundPanel } from '@/components/panels/BackgroundPanel'
import { FramePropertiesPanel } from '@/components/panels/FramePropertiesPanel'
import { FrameAlignmentPanel } from '@/components/panels/FrameAlignmentPanel'
import { TextPropertiesPanel } from '@/components/panels/TextPropertiesPanel'
import { ImagePropertiesPanel } from '@/components/panels/ImagePropertiesPanel'
import { ShapePropertiesPanel } from '@/components/panels/ShapePropertiesPanel'
import { SvgPropertiesPanel } from '@/components/panels/SvgPropertiesPanel'
import { ExportPanel } from '@/components/panels/ExportPanel'
import { AutoResizePanel } from '@/components/panels/AutoResizePanel'
import { AlignmentPanel } from '@/components/panels/AlignmentPanel'
import { AIPanel } from '@/components/panels/AIPanel'
import { EffectsPanel } from '@/components/panels/EffectsPanel'
import { GradientPropertiesPanel } from '@/components/panels/GradientPropertiesPanel'
import { PositionSizePanel } from '@/components/panels/PositionSizePanel'
import { DrawToolPanel } from '@/components/panels/DrawToolPanel'
import { AutoLayoutPanel } from '@/components/panels/AutoLayoutPanel'
import { LayoutGrid } from 'lucide-react'
import type { TextLayer, ImageLayer, ShapeLayer, SvgLayer, GradientLayer, Layer } from '@/types/design'

export function RightSidebar() {
  const activeLayerId = useDesignStore((s) => s.activeLayerId)
  const tool = useDesignStore((s) => s.tool)
  const layers = useDesignStore((s) => s.document.layers)
  const rightPanel = useUIStore((s) => s.rightPanel)
  const setRightPanel = useUIStore((s) => s.setRightPanel)
  const exportPanelOpen = useUIStore((s) => s.exportPanelOpen)
  const setExportPanelOpen = useUIStore((s) => s.setExportPanelOpen)

  const activeFrameId = useWorkspaceStore((s) => s.activeFrameId)
  const selectedFrameIds = useWorkspaceStore((s) => s.selectedFrameIds)
  const selectedLayerIds = useDesignStore((s) => s.selectedLayerIds)
  const activeFrame = useWorkspaceStore((s) => {
    const page = s.workspace.pages.find((p) => p.id === s.workspace.activePageId)
    return page?.frames.find((f) => f.id === s.activeFrameId) ?? null
  })
  const multiFrameSelection = useWorkspaceStore((s) => s.selectedFrameIds.size >= 2)

  // Selecting a layer or frame should leave the Export / Auto-resize panel and
  // show that selection's inspector — otherwise Export stays pinned once opened.
  // (selectLayer replaces the Set on every click, so re-selecting the same layer
  // still fires this.) The AI panel is a deliberate mode and is left alone.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    if (exportPanelOpen) setExportPanelOpen(false)
    if (rightPanel === 'export' || rightPanel === 'auto-resize') setRightPanel('inspector')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerIds, activeFrameId, selectedFrameIds])

  const activeLayer = activeLayerId
    ? layers.find((l) => l.id === activeLayerId)
    : null

  return (
    <aside className="hidden md:flex flex-col bg-card border-l border-border h-full overflow-hidden">
      {rightPanel === 'ai' ? (
        <div className="flex-1 overflow-hidden p-3">
          <AIPanel />
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto p-3 no-scrollbar">
        {exportPanelOpen || rightPanel === 'export' ? (
          <ExportPanel />
        ) : rightPanel === 'auto-resize' ? (
          <AutoResizePanel />
        ) : tool === 'draw' ? (
          <DrawToolPanel />
        ) : activeLayer ? (
          <LayerInspector layer={activeLayer} />
        ) : multiFrameSelection ? (
          <FrameAlignmentPanel />
        ) : activeFrame ? (
          <FramePropertiesPanel frame={activeFrame} />
        ) : (
          <NoSelectionPanel />
        )}
      </div>
      )}
    </aside>
  )
}

function LayerInspector({ layer }: { layer: Layer }) {
  const isPro = useIsProMode()

  return (
    <>
      <AutoLayoutSection layer={layer} />
      <AlignmentPanel />
      <LayerTypeInspector layer={layer} />
      {layer.type !== 'background' && <PositionSizePanel layer={layer} />}
      {isPro && layer.type !== 'background' && <EffectsPanel layer={layer} />}
    </>
  )
}

// Auto Layout: the config panel when the active layer's group has one, else an
// "Add auto layout" CTA when ≥2 layers are selected (a group-able selection).
//
// A selection spanning more than one *unit* (multiple Auto Layout groups, or a
// group plus loose layers) shows the CTA even though the active layer already
// has a config — applying then *nests* those units into a new outer layout
// rather than editing the active group.
function AutoLayoutSection({ layer }: { layer: Layer }) {
  const groupId = layer.groupId
  const config = useDesignStore((s) => (groupId ? s.document.autoLayouts?.[groupId] : undefined))
  const autoLayouts = useDesignStore((s) => s.document.autoLayouts)
  const layers = useDesignStore((s) => s.document.layers)
  const selectedLayerIds = useDesignStore((s) => s.selectedLayerIds)
  const applyAutoLayout = useDesignStore((s) => s.applyAutoLayout)

  const selectedLayers = layers.filter((l) => selectedLayerIds.has(l.id) && l.type !== 'background')
  const selectedCount = selectedLayers.length
  // Distinct layout units in the selection: each Auto Layout group counts once;
  // every loose layer is its own unit.
  const unitCount = new Set(
    selectedLayers.map((l) => (l.groupId && autoLayouts?.[l.groupId] ? `g:${l.groupId}` : `l:${l.id}`)),
  ).size
  const isSingleAutoLayoutUnit = !!(groupId && config) && unitCount === 1

  if (isSingleAutoLayoutUnit && groupId) {
    return (
      <div className="pb-4 mb-4 border-b border-border">
        <AutoLayoutPanel groupId={groupId} activeLayer={layer} />
      </div>
    )
  }
  if (selectedCount >= 2) {
    return (
      <div className="pb-4 mb-4 border-b border-border">
        <button
          className="flex w-full items-center justify-center gap-1.5 py-2 text-[12px] bg-muted text-foreground rounded-[5px] cursor-pointer transition-[transform,background-color] duration-150 hover:bg-muted/70 active:scale-[0.98]"
          onClick={() => applyAutoLayout()}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          Add auto layout
        </button>
      </div>
    )
  }
  return null
}

function LayerTypeInspector({ layer }: { layer: Layer }) {
  const isPro = useIsProMode()

  switch (layer.type) {
    case 'background':
      return <BackgroundPanel />
    case 'text':
      return <TextPropertiesPanel layer={layer as TextLayer} />
    case 'image':
      return <ImagePropertiesPanel layer={layer as ImageLayer} />
    case 'shape':
      return <ShapePropertiesPanel layer={layer as ShapeLayer} />
    case 'gradient':
      return isPro ? <GradientPropertiesPanel layer={layer as GradientLayer} /> : null
    case 'svg':
      return <SvgPropertiesPanel layer={layer as SvgLayer} />
    default:
      return null
  }
}

function NoSelectionPanel() {
  const format = useDesignStore((s) => s.document.format)

  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        Canvas
      </div>
      <div className="text-[11px] text-muted-foreground space-y-1">
        <p>Select a frame or layer to edit its properties.</p>
        <p className="text-muted-foreground/60 tabular-nums">
          {format.label} — {format.width} x {format.height}
        </p>
      </div>
    </div>
  )
}
