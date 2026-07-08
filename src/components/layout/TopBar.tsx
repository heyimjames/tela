import { useState, useRef, useEffect } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useUIStore } from '@/store/useUIStore'
import { useRouterStore } from '@/store/useRouterStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useFileStore } from '@/store/useFileStore'
import { Button } from '@/components/ui/button'
import { FormatSelector } from '@/components/panels/FormatSelector'
import {
  Undo2,
  Redo2,
  Settings,
  Download,
  ChevronDown,
  Monitor,
  ArrowLeft,
  Save,
  Bookmark,
  Clock,
  Trash2,
} from 'lucide-react'

export function TopBar() {
  const route = useRouterStore((s) => s.route)
  const navigate = useRouterStore((s) => s.navigate)
  const documentName = useDesignStore((s) => s.document.name)
  const format = useDesignStore((s) => s.document.format)
  const setDocumentName = useDesignStore((s) => s.setDocumentName)
  const undo = useDesignStore((s) => s.undo)
  const redo = useDesignStore((s) => s.redo)
  const historyIndex = useDesignStore((s) => s.historyIndex)
  const historyLength = useDesignStore((s) => s.history.length)

  const savedVersions = useDesignStore((s) => s.savedVersions)
  const saveVersion = useDesignStore((s) => s.saveVersion)
  const restoreVersion = useDesignStore((s) => s.restoreVersion)
  const deleteVersion = useDesignStore((s) => s.deleteVersion)

  const exportPanelOpen = useUIStore((s) => s.exportPanelOpen)
  const setExportPanelOpen = useUIStore((s) => s.setExportPanelOpen)

  const [formatOpen, setFormatOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const formatRef = useRef<HTMLDivElement>(null)
  const versionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!formatOpen) return
    const handler = (e: MouseEvent) => {
      if (formatRef.current && !formatRef.current.contains(e.target as Node)) {
        setFormatOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [formatOpen])

  useEffect(() => {
    if (!versionsOpen) return
    const handler = (e: MouseEvent) => {
      if (versionsRef.current && !versionsRef.current.contains(e.target as Node)) {
        setVersionsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [versionsOpen])

  return (
    <header className="h-14 bg-card border-b border-border flex items-center px-5 gap-4 shrink-0">
      {/* Back to Files */}
      <button
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
        onClick={() => {
          // Save current workspace pages back to the file store before leaving
          const { activeFileId, workspace } = useWorkspaceStore.getState()
          if (activeFileId) {
            useFileStore.getState().updateFilePages(activeFileId, workspace.pages)
          }
          navigate({ page: 'library' })
        }}
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-[13px] font-medium hidden md:inline">Files</span>
      </button>

      <div className="w-px h-5 bg-border hidden md:block" />

      {/* Document name */}
      <input
        className="text-[15px] font-medium text-foreground bg-transparent border-none outline-none min-w-0 max-w-[240px] hover:bg-muted/50 focus:bg-muted/50 rounded-[5px] px-2 py-1 transition-colors"
        value={documentName}
        onChange={(e) => {
          const name = e.target.value
          setDocumentName(name)
          // Keep the Files page in sync — the editor doc name and the file-store
          // record are separate, so a rename here must also update the file that
          // backs this editing session (skips the scratchpad, which is fixed).
          const { activeFileId } = useWorkspaceStore.getState()
          if (activeFileId) useFileStore.getState().renameFile(activeFileId, name)
        }}
      />

      {/* Format selector */}
      <div className="relative" ref={formatRef}>
        <button
          className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-muted-foreground bg-muted/50 hover:bg-muted rounded-[5px] transition-colors"
          onClick={() => setFormatOpen(!formatOpen)}
        >
          <Monitor className="w-3 h-3" />
          <span className="hidden sm:inline">{format.label}</span>
          <span className="text-muted-foreground/50 tabular-nums">{format.width}x{format.height}</span>
          <ChevronDown className="w-3 h-3" />
        </button>

        {formatOpen && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-card border border-border rounded-[7px] shadow-[var(--shadow-subtle)] z-50 max-h-[400px] overflow-y-auto py-1">
            <FormatSelector onClose={() => setFormatOpen(false)} />
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={historyIndex < 0}
          onClick={undo}
          className="rounded-[5px]"
          aria-label="Undo"
        >
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={historyIndex >= historyLength - 1}
          onClick={redo}
          className="rounded-[5px]"
          aria-label="Redo"
        >
          <Redo2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Save Version */}
      <div className="relative" ref={versionsRef}>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            className="rounded-[5px]"
            title="Save version"
            aria-label="Save version"
            onClick={() => saveVersion()}
          >
            <Bookmark className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="rounded-[5px]"
            title="Version history"
            aria-label="Version history"
            onClick={() => setVersionsOpen(!versionsOpen)}
          >
            <Clock className="w-3.5 h-3.5" />
            {savedVersions.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 text-[9px] bg-primary text-primary-foreground rounded-full flex items-center justify-center font-medium tabular-nums">
                {savedVersions.length}
              </span>
            )}
          </Button>
        </div>

        {versionsOpen && (
          <div className="absolute top-full right-0 mt-1 w-72 bg-card border border-border rounded-[7px] shadow-[var(--shadow-subtle)] z-50 max-h-[360px] overflow-y-auto">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <span className="text-[12px] font-medium text-muted-foreground">Saved Versions</span>
              <button
                className="text-[11px] text-primary hover:text-primary/80 font-medium cursor-pointer"
                onClick={() => { saveVersion(); }}
              >
                + Save Current
              </button>
            </div>
            {savedVersions.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">
                No saved versions yet
              </div>
            ) : (
              <div className="py-1">
                {savedVersions.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 group"
                  >
                    <div
                      className="flex-1 cursor-pointer min-w-0"
                      onClick={() => { restoreVersion(v.id); setVersionsOpen(false) }}
                    >
                      <div className="text-[13px] font-medium text-foreground truncate">{v.name}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {new Date(v.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {' \u00b7 '}
                        {v.document.layers.length} layers
                      </div>
                    </div>
                    <button
                      className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-opacity cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); deleteVersion(v.id) }}
                      title="Delete version"
                      aria-label="Delete version"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Settings */}
      <Button
        variant="ghost"
        size="icon-xs"
        className="rounded-[5px]"
        aria-label="Settings"
        onClick={() => useUIStore.getState().setSettingsOpen(true)}
      >
        <Settings className="w-4 h-4" />
      </Button>

      {/* Export */}
      <Button
        size="sm"
        className="rounded-[5px] gap-1.5"
        onClick={() => setExportPanelOpen(!exportPanelOpen)}
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Export</span>
      </Button>
    </header>
  )
}
