import { TopBar } from '@/components/layout/TopBar'
import { ToolBar } from '@/components/layout/ToolBar'
import { LeftSidebar } from '@/components/layout/LeftSidebar'
import { RightSidebar } from '@/components/layout/RightSidebar'
import { PreviewPanel } from '@/components/layout/PreviewPanel'
import { MobileControlSheet } from '@/components/layout/MobileControlSheet'
import { HomePage } from '@/components/library/HomePage'
import { SettingsPage } from '@/components/library/SettingsPage'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CommandPalette } from '@/components/canvas/CommandPalette'
import { ContextMenu } from '@/components/canvas/ContextMenu'
import { SettingsModal } from '@/components/panels/SettingsModal'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useRouterStore } from '@/store/useRouterStore'
import { useStudioBridge } from '@/hooks/useStudioBridge'
import { installAgentRpc } from '@/agent/rpc'
import { useEffect } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'

function EditorView() {
  useKeyboardShortcuts()
  // Ensure tool is select on mount (prevents stale tool state from blocking interaction)
  useEffect(() => { useDesignStore.getState().setTool('select') }, [])

  // Keep the visible canvas in sync with the active frame. Adding, duplicating,
  // or AI-generating a frame all set `activeFrameId` but don't themselves load
  // the frame into the design store the canvas renders — so without this the
  // new frame never appears. Subscribing to `activeFrameId` makes every path
  // that switches frames reflect on the canvas through one bridge.
  useEffect(() => {
    const loadActiveFrame = (frameId: string | null) => {
      if (!frameId) return
      const frame = useWorkspaceStore.getState().getFrame(frameId)
      if (!frame) return
      useDesignStore.getState().loadFromFrame({
        name: frame.name,
        width: frame.width,
        height: frame.height,
        format: frame.format,
        layers: frame.layers,
        autoLayouts: frame.autoLayouts,
      })
    }

    let previousFrameId = useWorkspaceStore.getState().activeFrameId
    loadActiveFrame(previousFrameId)
    return useWorkspaceStore.subscribe((state) => {
      if (state.activeFrameId === previousFrameId) return
      previousFrameId = state.activeFrameId
      loadActiveFrame(state.activeFrameId)
    })
  }, [])

  return (
    <div className="h-dvh grid grid-rows-[auto_auto_1fr] grid-cols-[1fr] md:grid-cols-[280px_1fr_300px] overflow-hidden">
      <div className="col-span-full">
        <TopBar />
      </div>
      <div className="col-span-full">
        <ToolBar />
      </div>
      <LeftSidebar />
      <PreviewPanel />
      <RightSidebar />
      <MobileControlSheet />
      <CommandPalette />
      <ContextMenu />
      <SettingsModal />
    </div>
  )
}

export default function App() {
  const route = useRouterStore((s) => s.route)

  // Sync navigation with a parent /studio host when embedded (no-op standalone).
  useStudioBridge()

  // Expose the command bus to a parent window / agent harness (and window.canvasStudio).
  useEffect(() => installAgentRpc(), [])

  return (
    <TooltipProvider>
      {route.page === 'library' && <HomePage />}
      {route.page === 'settings' && <SettingsPage />}
      {(route.page === 'editor' || route.page === 'editor-standalone' || route.page === 'project') && <EditorView />}
    </TooltipProvider>
  )
}
