import { useState, useRef } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useContextMenuStore } from '@/store/useContextMenuStore'
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Type,
  Image,
  Square,
  FileCode,
  Paintbrush,
  Trash2,
  Copy,
  Group,
  ChevronDown,
  ChevronRight,
  Frame as FrameIcon,
  Plus,
  FileText,
  Pencil,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import type { LayerType } from '@/types/design'
import type { Page } from '@/types/workspace'

const LAYER_ICONS: Record<LayerType, React.ElementType> = {
  background: Paintbrush,
  text: Type,
  image: Image,
  svg: FileCode,
  shape: Square,
  gradient: Paintbrush,
  group: Group,
  draw: Pencil,
}

export function LayerListPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace)
  const activeFrameId = useWorkspaceStore((s) => s.activeFrameId)
  const setActiveFrame = useWorkspaceStore((s) => s.setActiveFrame)
  const duplicateFrame = useWorkspaceStore((s) => s.duplicateFrame)
  const removeFrame = useWorkspaceStore((s) => s.removeFrame)
  const renameFrame = useWorkspaceStore((s) => s.renameFrame)
  const addFrame = useWorkspaceStore((s) => s.addFrame)
  const addPage = useWorkspaceStore((s) => s.addPage)
  const removePage = useWorkspaceStore((s) => s.removePage)
  const renamePage = useWorkspaceStore((s) => s.renamePage)
  const setActivePage = useWorkspaceStore((s) => s.setActivePage)

  // Design store for current editing (backwards compat)
  const designLayers = useDesignStore((s) => s.document.layers)
  const selectedLayerIds = useDesignStore((s) => s.selectedLayerIds)
  const activeLayerId = useDesignStore((s) => s.activeLayerId)
  const selectLayer = useDesignStore((s) => s.selectLayer)
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const removeLayer = useDesignStore((s) => s.removeLayer)
  const removeLayers = useDesignStore((s) => s.removeLayers)
  const duplicateLayer = useDesignStore((s) => s.duplicateLayer)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  const reorderLayer = useDesignStore((s) => s.reorderLayer)

  const [collapsedFrames, setCollapsedFrames] = useState<Set<string>>(new Set())
  const [collapsedPages, setCollapsedPages] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  // Double-click a layer name to rename it (mirrors page/frame rename).
  const layerRename = (layer: { id: string; name: string }) => ({
    editing: editingId === `layer-${layer.id}`,
    value: editValue,
    onChange: setEditValue,
    onStart: () => { setEditingId(`layer-${layer.id}`); setEditValue(layer.name) },
    onCommit: () => { if (editValue.trim()) updateLayer(layer.id, { name: editValue.trim() }); setEditingId(null) },
    onCancel: () => setEditingId(null),
  })

  // Right-click a layer row → shared context menu. Mirrors the canvas layer
  // menu (PreviewPanel) so both surfaces offer the same actions; Rename reuses
  // the inline-rename flow above rather than a separate dialog.
  const openMenu = useContextMenuStore((s) => s.openMenu)
  const openLayerMenu = (e: React.MouseEvent, layer: (typeof designLayers)[number]) => {
    e.preventDefault()
    e.stopPropagation()
    selectLayer(layer.id)
    const isBg = layer.type === 'background'
    openMenu(e.clientX, e.clientY, [
      { id: 'rename', label: 'Rename', icon: Pencil, action: () => { setEditingId(`layer-${layer.id}`); setEditValue(layer.name) } },
      ...(isBg ? [] : [{ id: 'dup', label: 'Duplicate', icon: Copy, action: () => duplicateLayer(layer.id) }]),
      { id: 'vis', label: layer.visible ? 'Hide' : 'Show', icon: layer.visible ? EyeOff : Eye, action: () => updateLayer(layer.id, { visible: !layer.visible }) },
      { id: 'lock', label: layer.locked ? 'Unlock' : 'Lock', icon: layer.locked ? Unlock : Lock, action: () => updateLayer(layer.id, { locked: !layer.locked }) },
      ...(isBg ? [] : [
        { id: 'fwd', label: 'Bring forward', icon: ArrowUp, separatorBefore: true, action: () => { pushSnapshot(); reorderLayer(layer.id, layer.zIndex + 1) } },
        { id: 'bwd', label: 'Send backward', icon: ArrowDown, action: () => { pushSnapshot(); reorderLayer(layer.id, Math.max(1, layer.zIndex - 1)) } },
        { id: 'del', label: 'Delete', icon: Trash2, danger: true, separatorBefore: true, action: () => { pushSnapshot(); removeLayer(layer.id) } },
      ]),
    ])
  }

  // Layer drag-to-reorder (operates on the active frame's design-store layers).
  const [dragLayerId, setDragLayerId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: 'above' | 'below' } | null>(null)

  const finishLayerReorder = () => {
    if (dragLayerId && dropTarget && dragLayerId !== dropTarget.id) {
      const layers = useDesignStore.getState().document.layers
      const target = layers.find((l) => l.id === dropTarget.id)
      const dragged = layers.find((l) => l.id === dragLayerId)
      if (target && dragged && dragged.type !== 'background') {
        // List is rendered front→back (zIndex desc); "above" means more in front.
        // A half-step lands the layer between neighbours; reorderLayer renumbers.
        const newZ = dropTarget.pos === 'above' ? target.zIndex + 0.5 : target.zIndex - 0.5
        reorderLayer(dragLayerId, Math.max(0.5, newZ)) // never sink below the background
      }
    }
    setDragLayerId(null)
    setDropTarget(null)
  }

  const toggleGroup = (groupId: string) =>
    setCollapsedGroups((p) => { const n = new Set(p); n.has(groupId) ? n.delete(groupId) : n.add(groupId); return n })

  // Select every member of a group as one unit (Shift toggles the whole group).
  const selectGroup = (members: { id: string }[], additive: boolean) => {
    useDesignStore.setState((s) => {
      const next = additive ? new Set(s.selectedLayerIds) : new Set<string>()
      const allIn = members.every((m) => s.selectedLayerIds.has(m.id))
      for (const m of members) {
        if (additive && allIn) next.delete(m.id)
        else next.add(m.id)
      }
      return { selectedLayerIds: next, activeLayerId: members[members.length - 1]?.id ?? null }
    })
  }

  // Collapse the flat layer list into rows, folding groupId-tagged layers into a
  // single group row positioned where their topmost member sits in the z-order.
  type Row =
    | { kind: 'layer'; layer: (typeof designLayers)[number] }
    | { kind: 'group'; groupId: string; members: (typeof designLayers)[number][] }
  const buildRows = (sorted: typeof designLayers): Row[] => {
    const done = new Set<string>()
    const rows: Row[] = []
    for (const l of sorted) {
      if (done.has(l.id)) continue
      if (l.groupId) {
        const members = sorted.filter((m) => m.groupId === l.groupId)
        members.forEach((m) => done.add(m.id))
        rows.push({ kind: 'group', groupId: l.groupId, members })
      } else {
        done.add(l.id)
        rows.push({ kind: 'layer', layer: l })
      }
    }
    return rows
  }

  const renderTree = (sorted: typeof designLayers, baseIndent: number, reorderActive: boolean) =>
    buildRows(sorted).map((row) => {
      if (row.kind === 'layer') {
        const layer = row.layer
        const canReorder = reorderActive && layer.type !== 'background'
        return (
          <LayerRow
            key={layer.id}
            layer={layer}
            indentPx={baseIndent}
            rename={layerRename(layer)}
            isSelected={selectedLayerIds.has(layer.id)}
            isActive={activeLayerId === layer.id}
            onSelect={(e) => selectLayer(layer.id, e.shiftKey)}
            onContextMenu={(e) => openLayerMenu(e, layer)}
            onVisibility={() => updateLayer(layer.id, { visible: !layer.visible })}
            onLock={() => updateLayer(layer.id, { locked: !layer.locked })}
            onDuplicate={layer.type !== 'background' ? () => duplicateLayer(layer.id) : undefined}
            onDelete={layer.type !== 'background' ? () => removeLayer(layer.id) : undefined}
            reorderEnabled={canReorder}
            isDragging={dragLayerId === layer.id}
            dropPos={dropTarget?.id === layer.id ? dropTarget.pos : null}
            onDragStartLayer={canReorder ? () => setDragLayerId(layer.id) : undefined}
            onDragOverLayer={canReorder ? (pos) => {
              if (dragLayerId && dragLayerId !== layer.id) {
                setDropTarget({ id: layer.id, pos })
              }
            } : undefined}
            onDropLayer={canReorder ? finishLayerReorder : undefined}
            onDragEndLayer={canReorder ? () => { setDragLayerId(null); setDropTarget(null) } : undefined}
          />
        )
      }

      const { groupId, members } = row
      const expanded = !collapsedGroups.has(groupId)
      const anyVisible = members.some((m) => m.visible)
      const allLocked = members.every((m) => m.locked)
      return (
        <div key={`group-${groupId}`}>
          <GroupHeaderRow
            indentPx={baseIndent}
            count={members.length}
            expanded={expanded}
            selected={members.every((m) => selectedLayerIds.has(m.id))}
            anyVisible={anyVisible}
            allLocked={allLocked}
            onToggle={() => toggleGroup(groupId)}
            onSelect={(e) => selectGroup(members, e.shiftKey)}
            onVisibility={() => { pushSnapshot(); members.forEach((m) => updateLayer(m.id, { visible: !anyVisible })) }}
            onLock={() => { pushSnapshot(); members.forEach((m) => updateLayer(m.id, { locked: !allLocked })) }}
            onDelete={() => removeLayers(members.map((m) => m.id))}
          />
          {expanded && members.map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              indentPx={baseIndent + 18}
              rename={layerRename(layer)}
              isSelected={selectedLayerIds.has(layer.id)}
              isActive={activeLayerId === layer.id}
              onSelect={(e) => selectLayer(layer.id, e.shiftKey)}
              onContextMenu={(e) => openLayerMenu(e, layer)}
              onVisibility={() => updateLayer(layer.id, { visible: !layer.visible })}
              onLock={() => updateLayer(layer.id, { locked: !layer.locked })}
              onDuplicate={layer.type !== 'background' ? () => duplicateLayer(layer.id) : undefined}
              onDelete={layer.type !== 'background' ? () => removeLayer(layer.id) : undefined}
              reorderEnabled={false}
            />
          ))}
        </div>
      )
    })

  const activePage = workspace.pages.find((p) => p.id === workspace.activePageId)
  const sortedDesignLayers = [...designLayers].sort((a, b) => b.zIndex - a.zIndex)

  return (
    <div className="flex flex-col h-full">
      {/* Pages — vertical list */}
      <div className="border-b border-border shrink-0 px-3 py-2 space-y-0.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">Pages</span>
          <button
            className="p-1 hover:bg-muted rounded-[3px] text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => addPage()}
            title="Add Page"
            aria-label="Add page"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        {workspace.pages.map((page) => {
          const isActive = page.id === workspace.activePageId
          return (
            <div
              key={page.id}
              className={`
                group flex items-center gap-2 px-2.5 py-1.5 rounded-[5px] cursor-pointer transition-colors
                ${isActive ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/50'}
              `}
              onClick={() => setActivePage(page.id)}
            >
              <FileText className="w-3.5 h-3.5 shrink-0" />

              {editingId === `page-${page.id}` ? (
                <input
                  className="flex-1 text-[13px] bg-white text-foreground border border-border rounded-[3px] px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-ring"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => { if (editValue.trim()) renamePage(page.id, editValue.trim()); setEditingId(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { if (editValue.trim()) renamePage(page.id, editValue.trim()); setEditingId(null) }; if (e.key === 'Escape') setEditingId(null) }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span
                  className="text-[13px] truncate flex-1"
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingId(`page-${page.id}`); setEditValue(page.name) }}
                >
                  {page.name}
                </span>
              )}

              {/* Delete page (only if more than one page) */}
              {workspace.pages.length > 1 && (
                <button
                  className="p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted rounded-[3px] text-muted-foreground/50 hover:text-destructive cursor-pointer transition-opacity"
                  onClick={(e) => { e.stopPropagation(); removePage(page.id) }}
                  title="Delete page"
                  aria-label="Delete page"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Layer content for active page */}
      <div className="flex-1 overflow-y-auto">
        {activePage && (
          <>
            {/* Frames within this page */}
            {activePage.frames.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">Frames</span>
                  <button
                    className="p-1 hover:bg-muted rounded-[3px] text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => addFrame()}
                    title="Add Frame"
                    aria-label="Add frame"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                {activePage.frames.map((frame) => {
                  const isActive = activeFrameId === frame.id
                  const isCollapsed = collapsedFrames.has(frame.id)
                  const sortedLayers = [...frame.layers].sort((a, b) => b.zIndex - a.zIndex)

                  return (
                    <div key={frame.id}>
                      {/* Frame header */}
                      <div
                        className={`
                          group flex items-center gap-2 px-3 py-2 cursor-pointer border-l-[3px] transition-colors
                          ${isActive ? 'border-l-primary bg-primary/5' : 'border-l-transparent hover:bg-muted/30'}
                        `}
                        onClick={() => {
                          // The active-frame subscription in EditorView loads
                          // this frame into the design store for the canvas.
                          setActiveFrame(frame.id)
                        }}
                      >
                        <button
                          className="p-0.5 text-muted-foreground/40 hover:text-muted-foreground cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); setCollapsedFrames((p) => { const n = new Set(p); n.has(frame.id) ? n.delete(frame.id) : n.add(frame.id); return n }) }}
                          aria-label={isCollapsed ? 'Expand frame' : 'Collapse frame'}
                        >
                          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        <FrameIcon className="w-4 h-4 text-primary/60 shrink-0" />

                        {editingId === `frame-${frame.id}` ? (
                          <input
                            className="flex-1 text-[13px] font-medium text-foreground bg-white border border-border rounded-[3px] px-1 py-0.5 outline-none focus:ring-1 focus:ring-ring"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => { if (editValue.trim()) renameFrame(frame.id, editValue.trim()); setEditingId(null) }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { if (editValue.trim()) renameFrame(frame.id, editValue.trim()); setEditingId(null) }; if (e.key === 'Escape') setEditingId(null) }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span
                            className="text-[13px] font-medium text-foreground truncate flex-1"
                            onDoubleClick={(e) => { e.stopPropagation(); setEditingId(`frame-${frame.id}`); setEditValue(frame.name) }}
                          >
                            {frame.name}
                          </span>
                        )}

                        <span className="text-[10px] text-muted-foreground/40 shrink-0 tabular-nums">{frame.width}x{frame.height}</span>

                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button className="p-1 hover:bg-muted rounded-[3px] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); duplicateFrame(frame.id) }} title="Duplicate" aria-label="Duplicate frame">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          {activePage.frames.length > 1 && (
                            <button className="p-1 hover:bg-muted rounded-[3px] text-muted-foreground/50 hover:text-destructive cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); removeFrame(frame.id) }} title="Delete" aria-label="Delete frame">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Frame's layers — grouped layers fold into expandable rows.
                          Reorder only the active frame (its layers mirror the design store). */}
                      {!isCollapsed && renderTree(sortedLayers, 40, isActive)}
                    </div>
                  )
                })}
              </div>
            )}

            {/* If no frames (scratchpad mode), show layers from design store */}
            {activePage.frames.length === 0 && (
              <div>
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">Layers</span>
                  <button
                    className="p-1 hover:bg-muted rounded-[3px] text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => addFrame()}
                    title="Add Frame"
                    aria-label="Add frame"
                  >
                    <FrameIcon className="w-3 h-3" />
                  </button>
                </div>
                {renderTree(sortedDesignLayers, 16, true)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// --- Layer row component ---

function LayerRow({
  layer,
  isSelected,
  isActive,
  indentPx,
  onSelect,
  onVisibility,
  onLock,
  onDuplicate,
  onDelete,
  reorderEnabled = false,
  isDragging = false,
  dropPos = null,
  onDragStartLayer,
  onDragOverLayer,
  onDropLayer,
  onDragEndLayer,
  onContextMenu,
  rename,
}: {
  layer: any
  isSelected: boolean
  isActive: boolean
  indentPx: number
  onSelect: (e: React.MouseEvent) => void
  onVisibility: () => void
  onLock: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  reorderEnabled?: boolean
  isDragging?: boolean
  dropPos?: 'above' | 'below' | null
  onDragStartLayer?: () => void
  onDragOverLayer?: (pos: 'above' | 'below') => void
  onDropLayer?: () => void
  onDragEndLayer?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  rename?: {
    editing: boolean
    value: string
    onChange: (v: string) => void
    onStart: () => void
    onCommit: () => void
    onCancel: () => void
  }
}) {
  const Icon = LAYER_ICONS[layer.type as LayerType] ?? Square

  return (
    <div
      draggable={reorderEnabled}
      onDragStart={reorderEnabled ? (e) => { e.dataTransfer.effectAllowed = 'move'; onDragStartLayer?.() } : undefined}
      onDragOver={onDragOverLayer ? (e) => {
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect()
        onDragOverLayer(e.clientY < r.top + r.height / 2 ? 'above' : 'below')
      } : undefined}
      onDrop={onDropLayer ? (e) => { e.preventDefault(); onDropLayer() } : undefined}
      onDragEnd={onDragEndLayer}
      onContextMenu={onContextMenu}
      style={{ paddingLeft: indentPx, paddingRight: 12 }}
      className={`
        group relative flex items-center gap-2 py-2 cursor-pointer border-l-[3px] transition-colors
        ${isDragging ? 'opacity-40' : ''}
        ${isActive ? 'border-l-primary bg-accent/30' : isSelected ? 'border-l-primary/40 bg-accent/15' : 'border-l-transparent hover:bg-muted/50'}
      `}
      onClick={onSelect}
    >
      {dropPos === 'above' && <div className="absolute inset-x-2 -top-px h-0.5 rounded-full bg-primary pointer-events-none" />}
      {dropPos === 'below' && <div className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary pointer-events-none" />}
      <Icon className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
      {rename?.editing ? (
        <input
          className="flex-1 text-[12px] text-foreground bg-white border border-border rounded-[3px] px-1 py-0.5 outline-none focus:ring-1 focus:ring-ring"
          value={rename.value}
          onChange={(e) => rename.onChange(e.target.value)}
          onBlur={rename.onCommit}
          onKeyDown={(e) => { if (e.key === 'Enter') rename.onCommit(); if (e.key === 'Escape') rename.onCancel() }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="text-[12px] truncate flex-1 text-foreground/80"
          onDoubleClick={rename ? (e) => { e.stopPropagation(); rename.onStart() } : undefined}
        >
          {layer.name}
        </span>
      )}

      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ opacity: isActive ? 1 : undefined }}>
        <button className="p-0.5 hover:bg-muted rounded-[3px] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onVisibility() }} aria-label={layer.visible ? 'Hide layer' : 'Show layer'}>
          {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
        <button className="p-0.5 hover:bg-muted rounded-[3px] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onLock() }} aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}>
          {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
        </button>
        {onDuplicate && (
          <button className="p-0.5 hover:bg-muted rounded-[3px] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onDuplicate() }} aria-label="Duplicate layer">
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
        {onDelete && (
          <button className="p-0.5 hover:bg-muted rounded-[3px] text-muted-foreground/50 hover:text-destructive cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onDelete() }} aria-label="Delete layer">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// --- Group header row ---

function GroupHeaderRow({
  indentPx,
  count,
  expanded,
  selected,
  anyVisible,
  allLocked,
  onToggle,
  onSelect,
  onVisibility,
  onLock,
  onDelete,
}: {
  indentPx: number
  count: number
  expanded: boolean
  selected: boolean
  anyVisible: boolean
  allLocked: boolean
  onToggle: () => void
  onSelect: (e: React.MouseEvent) => void
  onVisibility: () => void
  onLock: () => void
  onDelete: () => void
}) {
  return (
    <div
      style={{ paddingLeft: indentPx, paddingRight: 12 }}
      className={`
        group relative flex items-center gap-1.5 py-2 cursor-pointer border-l-[3px] transition-colors
        ${selected ? 'border-l-primary/40 bg-accent/15' : 'border-l-transparent hover:bg-muted/50'}
      `}
      onClick={onSelect}
    >
      <button
        className="p-0.5 -ml-1 text-muted-foreground/40 hover:text-muted-foreground cursor-pointer shrink-0"
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        aria-label={expanded ? 'Collapse group' : 'Expand group'}
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      <Group className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
      <span className="text-[12px] truncate flex-1 text-foreground/90">Group</span>
      <span className="text-[10px] text-muted-foreground/40 shrink-0 tabular-nums">{count}</span>

      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button className="p-0.5 hover:bg-muted rounded-[3px] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onVisibility() }} aria-label={anyVisible ? 'Hide group' : 'Show group'}>
          {anyVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
        <button className="p-0.5 hover:bg-muted rounded-[3px] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onLock() }} aria-label={allLocked ? 'Unlock group' : 'Lock group'}>
          {allLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
        </button>
        <button className="p-0.5 hover:bg-muted rounded-[3px] text-muted-foreground/50 hover:text-destructive cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onDelete() }} aria-label="Delete group">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
