import { useState, useEffect, useRef } from 'react'
import { useDesignStore, createTextLayer } from '@/store/useDesignStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useUIStore } from '@/store/useUIStore'
import { useRouterStore } from '@/store/useRouterStore'
import { getBrandColor } from '@/brand/palette'
import { AD_FORMATS } from '@/brand/formats'
import {
  Type,
  ImageIcon,
  Square,
  FileCode,
  Undo2,
  Redo2,
  Copy,
  Trash2,
  Download,
  ArrowLeft,
  Maximize,
  Search,
  Plus,
  Frame,
  Keyboard,
} from 'lucide-react'
import type { ShapeLayer } from '@/types/design'

interface Command {
  id: string
  label: string
  shortcut?: string
  icon: React.ElementType
  action: () => void
  category: string
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands: Command[] = [
    // Add elements
    { id: 'add-text', label: 'Add Text Layer', shortcut: 'T', icon: Type, category: 'Add', action: () => { useDesignStore.getState().addLayer(createTextLayer()); setOpen(false) } },
    { id: 'add-shape', label: 'Add Rectangle', shortcut: 'R', icon: Square, category: 'Add', action: () => { useDesignStore.getState().addLayer({ type: 'shape', name: 'Rectangle', visible: true, locked: false, opacity: 1, x: 100, y: 100, width: 200, height: 200, rotation: 0, shape: 'rectangle', fill: getBrandColor('brand-dark'), borderRadius: 7 } satisfies Omit<ShapeLayer, 'id' | 'zIndex'>); setOpen(false) } },
    { id: 'add-ellipse', label: 'Add Ellipse', icon: Square, category: 'Add', action: () => { useDesignStore.getState().addLayer({ type: 'shape', name: 'Ellipse', visible: true, locked: false, opacity: 1, x: 100, y: 100, width: 200, height: 200, rotation: 0, shape: 'ellipse', fill: getBrandColor('brand-accent'), borderRadius: 0 } satisfies Omit<ShapeLayer, 'id' | 'zIndex'>); setOpen(false) } },

    // Edit
    { id: 'undo', label: 'Undo', shortcut: '⌘Z', icon: Undo2, category: 'Edit', action: () => { useDesignStore.getState().undo(); setOpen(false) } },
    { id: 'redo', label: 'Redo', shortcut: '⇧⌘Z', icon: Redo2, category: 'Edit', action: () => { useDesignStore.getState().redo(); setOpen(false) } },
    { id: 'duplicate', label: 'Duplicate Layer', shortcut: '⌘D', icon: Copy, category: 'Edit', action: () => { const id = useDesignStore.getState().activeLayerId; if (id) useDesignStore.getState().duplicateLayer(id); setOpen(false) } },
    { id: 'delete', label: 'Delete Layer', shortcut: '⌫', icon: Trash2, category: 'Edit', action: () => { const ids = [...useDesignStore.getState().selectedLayerIds]; ids.forEach((id) => { const l = useDesignStore.getState().getLayer(id); if (l && l.type !== 'background') useDesignStore.getState().removeLayer(id) }); setOpen(false) } },

    // Frames
    { id: 'new-frame', label: 'New Frame', icon: Plus, category: 'Frame', action: () => { useWorkspaceStore.getState().addFrame(useDesignStore.getState().document.format); setOpen(false) } },
    { id: 'duplicate-frame', label: 'Duplicate Frame', shortcut: '⌘C ⌘V', icon: Frame, category: 'Frame', action: () => { const ws = useWorkspaceStore.getState(); const fid = [...ws.selectedFrameIds][0] ?? ws.activeFrameId; if (fid) ws.duplicateFrame(fid); setOpen(false) } },

    // View
    { id: 'fit-view', label: 'Fit to View', shortcut: '⇧1', icon: Maximize, category: 'View', action: () => { window.dispatchEvent(new CustomEvent('canvas-zoom', { detail: { action: 'fit' } })); setOpen(false) } },
    { id: 'zoom-100', label: 'Zoom to 100%', shortcut: '⌘0', icon: Maximize, category: 'View', action: () => { window.dispatchEvent(new CustomEvent('canvas-zoom', { detail: { action: 'reset' } })); setOpen(false) } },

    // Formats
    ...AD_FORMATS.map((f) => ({
      id: `format-${f.id}`,
      label: `Switch to ${f.label}`,
      icon: Maximize,
      category: 'Format',
      action: () => { useDesignStore.getState().setFormat(f); setOpen(false) },
    })),

    // Export
    { id: 'export', label: 'Export Design', shortcut: '⌘E', icon: Download, category: 'Export', action: () => { useUIStore.getState().setExportPanelOpen(true); setOpen(false) } },

    // Help
    { id: 'shortcuts', label: 'Keyboard Shortcuts', shortcut: '?', icon: Keyboard, category: 'Help', action: () => { window.dispatchEvent(new CustomEvent('tela:shortcuts')); setOpen(false) } },

    // Nav
    { id: 'back-library', label: 'Back to Library', icon: ArrowLeft, category: 'Navigate', action: () => { useRouterStore.getState().navigate({ page: 'library' }); setOpen(false) } },
  ]

  const filtered = query
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        setQuery('')
        setSelectedIndex(0)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  if (!open) return null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[selectedIndex]?.action()
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[20vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-charcoal/30 backdrop-blur-sm" />

      <div
        className="relative w-[min(520px,calc(100vw-1.5rem))] bg-card border border-border rounded-[12px] shadow-[0_8px_30px_-4px_rgba(17,17,17,0.12)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground/50 shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/40"
            placeholder="Search commands..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="text-[11px] text-muted-foreground/40 bg-muted px-1.5 py-0.5 rounded-[3px]">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[360px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, i) => {
              const Icon = cmd.icon
              return (
                <button
                  key={cmd.id}
                  className={`
                    w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                    ${i === selectedIndex ? 'bg-primary/10 text-foreground' : 'text-foreground/80 hover:bg-muted/50'}
                  `}
                  onClick={cmd.action}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-[13px]">{cmd.label}</span>
                  {cmd.shortcut && (
                    <kbd className="text-[11px] text-muted-foreground/50">{cmd.shortcut}</kbd>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
