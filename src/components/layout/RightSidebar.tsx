import { useEffect, useRef } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useUIStore } from '@/store/useUIStore'
import { useIsProMode } from '@/hooks/useIsProMode'
import { FramePropertiesPanel } from '@/components/panels/FramePropertiesPanel'
import { FrameAlignmentPanel } from '@/components/panels/FrameAlignmentPanel'
import { ExportPanel } from '@/components/panels/ExportPanel'
import { AutoResizePanel } from '@/components/panels/AutoResizePanel'
import { AIPanel } from '@/components/panels/AIPanel'
import { DrawToolPanel } from '@/components/panels/DrawToolPanel'
import { LayerInspector } from '@/components/panels/LayerInspector'

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
