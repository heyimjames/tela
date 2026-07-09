import { useState, useMemo } from 'react'
import { useFileStore } from '@/store/useFileStore'
import { useRouterStore } from '@/store/useRouterStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useDesignStore } from '@/store/useDesignStore'
import { renderThumbnail } from '@/engine/thumbnail'
import { getBrandColor } from '@/brand/palette'
import { BRAND } from '@/brand/brand.config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDeleteModal } from '@/components/library/ConfirmDeleteModal'
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  FileText,
  FolderOpen,
  FolderPlus,
  Trash2,
  Pencil,
  Copy,
  MoreHorizontal,
  Clock,
  Archive,
  Settings,
  Sparkles,
  FolderInput,
  Check,
} from 'lucide-react'
import { cardGradient } from '@/lib/cardGradient'
import { useIsMobile } from '@/hooks/useIsMobile'
import { Drawer, DrawerContent, DrawerTitle, DrawerClose } from '@/components/ui/drawer'
import type { DesignFile, DesignFrame, Folder } from '@/types/fileSystem'

// dataTransfer MIME for dragging a file card onto a folder (desktop).
const FILE_DND = 'application/tela-file'
import type { Frame } from '@/types/workspace'
import type { Layer } from '@/types/design'

type FilterTab = 'all' | 'recents' | 'archived'
type ViewMode = 'grid' | 'list'

// A file's DesignFrame is a subset of a workspace Frame — it has no
// backgroundColor / locked / visible. Fill those in (deriving the colour from
// the frame's solid fill) so loaded file pages satisfy the workspace model.
function frameFromDesignFrame(df: DesignFrame): Frame {
  return {
    ...df,
    backgroundColor:
      df.backgroundFill.type === 'solid' ? df.backgroundFill.color : getBrandColor('cloud'),
    locked: false,
    visible: true,
  }
}

export function HomePage() {
  const files = useFileStore((s) => s.files)
  const folders = useFileStore((s) => s.folders)
  const createFile = useFileStore((s) => s.createFile)
  const deleteFile = useFileStore((s) => s.deleteFile)
  const renameFile = useFileStore((s) => s.renameFile)
  const duplicateFile = useFileStore((s) => s.duplicateFile)
  const createFolder = useFileStore((s) => s.createFolder)
  const deleteFolder = useFileStore((s) => s.deleteFolder)
  const renameFolder = useFileStore((s) => s.renameFolder)
  const moveFileToFolder = useFileStore((s) => s.moveFileToFolder)
  const navigate = useRouterStore((s) => s.navigate)

  const [filter, setFilter] = useState<FilterTab>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  // Delete is confirmed through a modal rather than firing immediately.
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'file' | 'folder'; id: string; name: string } | null>(null)
  const [movingFileId, setMovingFileId] = useState<string | null>(null)

  const confirmDelete = () => {
    if (!pendingDelete) return
    if (pendingDelete.kind === 'file') deleteFile(pendingDelete.id)
    else deleteFolder(pendingDelete.id)
    setPendingDelete(null)
  }

  // Filter and sort files
  const visibleFiles = useMemo(() => {
    let result = files.filter((f) => f.folderId === activeFolderId)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = files.filter((f) => f.name.toLowerCase().includes(q))
    }
    if (filter === 'recents') {
      result = [...result].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    }
    // Scratchpad always first
    return result.sort((a, b) => (a.isScratchpad ? -1 : b.isScratchpad ? 1 : 0))
  }, [files, searchQuery, filter, activeFolderId])

  const visibleFolders = useMemo(() => {
    return folders.filter((f) => f.parentId === activeFolderId)
  }, [folders, activeFolderId])

  const handleOpenFile = (fileId: string) => {
    const file = useFileStore.getState().getFile(fileId)
    if (!file) return

    // Load file's pages into workspace store
    const pages = file.pages.map((page) => ({
      id: page.id,
      name: page.name,
      frames: page.frames.map(frameFromDesignFrame),
      looseElements: [] as Layer[],
    }))

    useWorkspaceStore.setState((s) => ({
      workspace: {
        ...s.workspace,
        name: file.name,
        pages,
        activePageId: pages[0]?.id ?? s.workspace.activePageId,
      },
      activeFrameId: null,
      activeFileId: fileId,
    }))

    // Load first frame into design store for editing
    const firstFrame = file.pages[0]?.frames[0]
    if (firstFrame) {
      useDesignStore.getState().loadFromFrame({
        name: firstFrame.name,
        width: firstFrame.width,
        height: firstFrame.height,
        format: firstFrame.format,
        layers: firstFrame.layers,
        autoLayouts: firstFrame.autoLayouts,
      })
      useWorkspaceStore.setState({ activeFrameId: firstFrame.id })
    }

    navigate({ page: 'editor-standalone' })
  }

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 30) return `${days} days ago`
    return `${Math.floor(days / 30)} months ago`
  }

  return (
    <div className="h-dvh flex bg-background">
      {/* Left sidebar (desktop) */}
      <aside className="hidden md:flex w-[220px] bg-card border-r border-border flex-col shrink-0">
        {/* User */}
        <div className="px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-[#3e4576] flex items-center justify-center">
              <span className="text-[10px] font-bold text-white">
                {BRAND.productName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
            </div>
            <span className="text-[14px] font-medium text-foreground">{BRAND.productName}</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          <NavItem
            icon={FileText}
            label="Files"
            active={!activeFolderId}
            onClick={() => setActiveFolderId(null)}
            onDropFile={(id) => moveFileToFolder(id, null)}
          />
          <NavItem
            icon={Clock}
            label="Recents"
            active={filter === 'recents'}
            onClick={() => { setFilter('recents'); setActiveFolderId(null) }}
          />
          <NavItem
            icon={Sparkles}
            label="Templates"
            onClick={() => {/* TODO: open template browser */}}
          />

          {/* Folders */}
          {folders.length > 0 && (
            <div className="pt-4">
              <div className="px-3 mb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/50 font-medium">
                Folders
              </div>
              {folders.filter((f) => f.parentId === null).map((folder) => (
                <NavItem
                  key={folder.id}
                  icon={FolderOpen}
                  label={folder.name}
                  active={activeFolderId === folder.id}
                  onClick={() => setActiveFolderId(folder.id)}
                  onDelete={() => setPendingDelete({ kind: 'folder', id: folder.id, name: folder.name })}
                  onDropFile={(id) => moveFileToFolder(id, folder.id)}
                />
              ))}
            </div>
          )}
        </nav>

        {/* Bottom */}
        <div className="px-3 py-3 border-t border-border">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-[5px] transition-colors cursor-pointer"
            onClick={() => navigate({ page: 'settings' })}
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {/* Mobile top bar — brand + nav pills + settings (replaces the sidebar) */}
        <div className="md:hidden sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border">
          <div className="flex items-center justify-between px-4 h-14">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#3e4576] flex items-center justify-center">
                <span className="text-[10px] font-bold text-white">
                  {BRAND.productName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
              </div>
              <span className="text-[15px] font-semibold text-foreground">{BRAND.productName}</span>
            </div>
            <button
              aria-label="Settings"
              className="h-10 w-10 flex items-center justify-center rounded-full text-muted-foreground active:bg-muted/50"
              onClick={() => navigate({ page: 'settings' })}
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
          <div className="flex gap-1.5 px-4 pb-2.5 overflow-x-auto no-scrollbar">
            {[
              { label: 'Files', active: !activeFolderId && filter === 'all', on: () => { setFilter('all'); setActiveFolderId(null) } },
              { label: 'Recents', active: filter === 'recents', on: () => { setFilter('recents'); setActiveFolderId(null) } },
              { label: 'Templates', active: false, on: () => {/* TODO: template browser */} },
            ].map((t) => (
              <button
                key={t.label}
                className={`shrink-0 px-3.5 h-9 rounded-full text-[13px] font-medium transition-colors ${t.active ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground active:bg-muted'}`}
                onClick={t.on}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Header */}
        <div className="px-4 md:px-8 pt-4 md:pt-8 pb-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-6">
            <h1 className="text-[22px] md:text-[28px] font-semibold text-foreground tracking-tight">
              {activeFolderId ? folders.find((f) => f.id === activeFolderId)?.name ?? 'Files' : 'Files'}
            </h1>
            <div className="flex items-center gap-2">
              {/* Filters (desktop) */}
              <div className="hidden md:flex gap-0.5 bg-muted/30 rounded-[5px] p-0.5">
                {(['all', 'recents'] as const).map((tab) => (
                  <button
                    key={tab}
                    className={`px-3 py-1 text-[13px] rounded-[4px] transition-colors cursor-pointer ${filter === tab ? 'bg-white text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setFilter(tab)}
                  >
                    {tab === 'all' ? 'All' : 'Recents'}
                  </button>
                ))}
              </div>

              {/* View toggle (desktop) */}
              <div className="hidden md:flex gap-0.5 bg-muted/30 rounded-[5px] p-0.5">
                <button aria-label="Grid view" className={`p-1.5 rounded-[4px] ${viewMode === 'grid' ? 'bg-white shadow-sm' : ''} cursor-pointer`} onClick={() => setViewMode('grid')}>
                  <LayoutGrid className="w-4 h-4 text-muted-foreground" />
                </button>
                <button aria-label="List view" className={`p-1.5 rounded-[4px] ${viewMode === 'list' ? 'bg-white shadow-sm' : ''} cursor-pointer`} onClick={() => setViewMode('list')}>
                  <List className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              {/* Search */}
              <div className="relative flex-1 md:flex-none md:w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
                <Input
                  className="pl-9 h-10 md:h-8 text-[13px] rounded-[5px]"
                  placeholder="Search files"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* New file */}
              <Button size="sm" className="h-10 md:h-8 rounded-[5px] gap-1.5 shrink-0" onClick={() => {
                const id = createFile('Untitled', activeFolderId)
                handleOpenFile(id)
              }}>
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">New file</span>
                <span className="sm:hidden">New</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="px-8 pb-8">
          {/* Folders row */}
          {visibleFolders.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[13px] text-muted-foreground font-medium">Folders</span>
                <button
                  aria-label="New folder"
                  className="p-1 hover:bg-muted rounded-[3px] text-muted-foreground cursor-pointer"
                  onClick={() => createFolder('New Folder', activeFolderId)}
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex gap-3 flex-wrap">
                {visibleFolders.map((folder) => (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    isEditing={editingId === folder.id}
                    editValue={editValue}
                    onOpen={() => setActiveFolderId(folder.id)}
                    onStartEdit={() => { setEditingId(folder.id); setEditValue(folder.name) }}
                    onSaveEdit={(name) => { renameFolder(folder.id, name); setEditingId(null) }}
                    onCancelEdit={() => setEditingId(null)}
                    onEditValueChange={setEditValue}
                    onDelete={() => deleteFolder(folder.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* New folder button (when none exist and at root) */}
          {visibleFolders.length === 0 && !activeFolderId && (
            <div className="mb-4">
              <button
                className="text-[13px] text-primary hover:underline cursor-pointer"
                onClick={() => createFolder('New Folder')}
              >
                + Create folder
              </button>
            </div>
          )}

          {/* Files grid */}
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {visibleFiles.map((file) => (
                <FileCard
                  key={file.id}
                  file={file}
                  editingId={editingId}
                  editValue={editValue}
                  onOpen={() => handleOpenFile(file.id)}
                  onStartEdit={() => { setEditingId(file.id); setEditValue(file.name) }}
                  onSaveEdit={(name) => { renameFile(file.id, name); setEditingId(null) }}
                  onCancelEdit={() => setEditingId(null)}
                  onEditValueChange={setEditValue}
                  onDuplicate={() => duplicateFile(file.id)}
                  onDelete={() => setPendingDelete({ kind: 'file', id: file.id, name: file.name })}
                  onMove={() => setMovingFileId(file.id)}
                  timeAgo={timeAgo}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {visibleFiles.map((file) => (
                <FileListRow
                  key={file.id}
                  file={file}
                  onOpen={() => handleOpenFile(file.id)}
                  onDuplicate={() => duplicateFile(file.id)}
                  onDelete={() => setPendingDelete({ kind: 'file', id: file.id, name: file.name })}
                  onMove={() => setMovingFileId(file.id)}
                  timeAgo={timeAgo}
                />
              ))}
            </div>
          )}

          {visibleFiles.length === 0 && !searchQuery && (
            <div className="text-center py-20">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground/20 mb-4" />
              <h2 className="text-[16px] font-medium text-foreground mb-1">No files yet</h2>
              <p className="text-[13px] text-muted-foreground mb-4">Create a file to start designing.</p>
              <Button className="rounded-[5px] gap-1.5" onClick={() => createFile('Untitled', activeFolderId)}>
                <Plus className="w-4 h-4" />
                New file
              </Button>
            </div>
          )}
        </div>
      </main>

      <ConfirmDeleteModal
        open={!!pendingDelete}
        itemName={pendingDelete?.name}
        kind={pendingDelete?.kind}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <MoveToFolderPicker
        file={movingFileId ? files.find((f) => f.id === movingFileId) ?? null : null}
        folders={folders}
        onMove={(folderId) => { if (movingFileId) moveFileToFolder(movingFileId, folderId); setMovingFileId(null) }}
        onClose={() => setMovingFileId(null)}
      />
    </div>
  )
}

// Move a file to a folder (or the top level). A bottom sheet on mobile, a
// compact centred modal on desktop — same list either way.
function MoveToFolderPicker({
  file, folders, onMove, onClose,
}: {
  file: DesignFile | null
  folders: Folder[]
  onMove: (folderId: string | null) => void
  onClose: () => void
}) {
  const isMobile = useIsMobile()
  if (!file) return null

  const currentId = file.folderId ?? null
  const rows = (
    <div className="py-1">
      <MoveRow label="Top level" icon={FileText} active={currentId === null} onClick={() => onMove(null)} />
      {folders.map((f) => (
        <MoveRow key={f.id} label={f.name} icon={FolderOpen} active={currentId === f.id} onClick={() => onMove(f.id)} />
      ))}
      {folders.length === 0 && (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">No folders yet — create one from the sidebar first.</p>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()}>
        <DrawerContent>
          <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-0.5">
            <DrawerTitle className="p-0 text-[16px] font-semibold text-foreground">Move “{file.name}”</DrawerTitle>
            <DrawerClose asChild>
              <button className="h-10 rounded-full bg-muted px-4 text-[13px] font-medium text-foreground transition-transform active:scale-[0.96]">Cancel</button>
            </DrawerClose>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)] no-scrollbar">{rows}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative w-full max-w-[380px] rounded-[16px] bg-white shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border text-[14px] font-semibold text-foreground truncate">Move “{file.name}” to…</div>
        <div className="max-h-[50vh] overflow-y-auto">{rows}</div>
      </div>
    </div>
  )
}

function MoveRow({ label, icon: Icon, active, onClick }: { label: string; icon: React.ElementType; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`w-full flex items-center gap-2.5 px-4 h-11 text-[14px] transition-colors ${active ? 'text-primary font-medium' : 'text-foreground hover:bg-muted/50'}`}
      onClick={onClick}
      disabled={active}
    >
      <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-left truncate">{label}</span>
      {active && <Check className="w-4 h-4 text-primary" />}
    </button>
  )
}

// --- Sub-components ---

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  onDelete,
  onDropFile,
}: {
  icon: React.ElementType
  label: string
  active?: boolean
  onClick: () => void
  onDelete?: () => void
  onDropFile?: (fileId: string) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  return (
    <button
      className={`
        group w-full flex items-center gap-2.5 px-3 py-2 rounded-[5px] text-[14px] transition-colors cursor-pointer
        ${dragOver ? 'ring-2 ring-primary ring-inset bg-primary/5 text-foreground' : active ? 'bg-muted/60 text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'}
      `}
      onClick={onClick}
      onDragOver={onDropFile ? (e) => { if (e.dataTransfer.types.includes(FILE_DND)) { e.preventDefault(); setDragOver(true) } } : undefined}
      onDragLeave={onDropFile ? () => setDragOver(false) : undefined}
      onDrop={onDropFile ? (e) => { e.preventDefault(); const id = e.dataTransfer.getData(FILE_DND); if (id) onDropFile(id); setDragOver(false) } : undefined}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 text-left truncate">{label}</span>
      {onDelete && (
        <button
          aria-label="Delete folder"
          className="p-0.5 opacity-0 group-hover:opacity-100 hover:text-destructive cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </button>
  )
}

// A folder tile in the main view. Renameable inline (double-click the name, the
// hover pencil, or right-click), consistent with how file cards rename.
function FolderCard({
  folder,
  isEditing,
  editValue,
  onOpen,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditValueChange,
  onDelete,
}: {
  folder: Folder
  isEditing: boolean
  editValue: string
  onOpen: () => void
  onStartEdit: () => void
  onSaveEdit: (name: string) => void
  onCancelEdit: () => void
  onEditValueChange: (v: string) => void
  onDelete: () => void
}) {
  return (
    <div
      className="group relative flex items-center gap-2.5 px-4 py-3 bg-card border border-border rounded-[7px] hover:shadow-[var(--shadow-subtle)] transition-shadow cursor-pointer min-w-[180px]"
      onClick={() => { if (!isEditing) onOpen() }}
      // Rename without navigating in: right-click, or the hover pencil. (A
      // double-click can't be used — the first click already opens the folder.)
      onContextMenu={(e) => { e.preventDefault(); onStartEdit() }}
    >
      <FolderOpen className="w-5 h-5 text-muted-foreground/60 shrink-0" />
      {isEditing ? (
        <input
          className="text-[14px] font-medium text-foreground bg-white border border-border rounded-[5px] px-1.5 py-0.5 min-w-0 flex-1 outline-none focus:ring-1 focus:ring-ring"
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onBlur={() => { if (editValue.trim()) onSaveEdit(editValue.trim()); else onCancelEdit() }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && editValue.trim()) onSaveEdit(editValue.trim())
            if (e.key === 'Escape') onCancelEdit()
          }}
          onClick={(e) => e.stopPropagation()}
          autoFocus
        />
      ) : (
        <>
          <span className="text-[14px] text-foreground font-medium truncate flex-1">{folder.name}</span>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity shrink-0">
            <button
              aria-label="Rename folder"
              className="p-1 hover:bg-muted rounded-[3px] cursor-pointer"
              onClick={(e) => { e.stopPropagation(); onStartEdit() }}
              title="Rename"
            >
              <Pencil className="w-3 h-3 text-muted-foreground" />
            </button>
            <button
              aria-label="Delete folder"
              className="p-1 hover:bg-muted rounded-[3px] cursor-pointer"
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              title="Delete"
            >
              <Trash2 className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function FileCard({
  file,
  editingId,
  editValue,
  onOpen,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditValueChange,
  onDuplicate,
  onDelete,
  onMove,
  timeAgo,
}: {
  file: DesignFile
  editingId: string | null
  editValue: string
  onOpen: () => void
  onStartEdit: () => void
  onSaveEdit: (name: string) => void
  onCancelEdit: () => void
  onEditValueChange: (v: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onMove: () => void
  timeAgo: (d: string) => string
}) {
  const isEditing = editingId === file.id

  // Generate thumbnail from first frame of first page
  const thumb = useMemo(() => {
    const firstPage = file.pages[0]
    const firstFrame = firstPage?.frames[0]
    if (!firstFrame || firstFrame.layers.length <= 1) return null

    try {
      // Create a minimal document for the thumbnail renderer
      const doc = {
        id: file.id,
        name: file.name,
        format: firstFrame.format,
        layers: firstFrame.layers,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      }
      return renderThumbnail(doc as any, 400, 280)
    } catch { return null }
  }, [file])

  return (
    <div
      className="group bg-card border border-border rounded-[12px] overflow-hidden cursor-pointer hover:shadow-[0_2px_8px_-2px_rgba(17,17,17,0.08)] transition-[box-shadow] duration-200"
      onClick={onOpen}
      draggable={!file.isScratchpad && !isEditing}
      onDragStart={(e) => { e.dataTransfer.setData(FILE_DND, file.id); e.dataTransfer.effectAllowed = 'move' }}
    >
      {/* Thumbnail */}
      <div className="aspect-[4/3] bg-[#ebe9e1] relative overflow-hidden">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          // No preview yet → a seeded, on-brand OKLCH mesh gradient, locked to
          // this file's id (stable across loads). No icon — the gradient is it.
          <div className="w-full h-full" style={{ background: cardGradient(file.id) }} />
        )}

        {/* Hover actions */}
        {!file.isScratchpad && (
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity">
            <button aria-label="Rename" className="p-1.5 bg-white/90 rounded-[5px] shadow-sm hover:bg-white cursor-pointer" onClick={(e) => { e.stopPropagation(); onStartEdit() }} title="Rename">
              <Pencil className="w-3 h-3 text-muted-foreground" />
            </button>
            <button aria-label="Move to folder" className="p-1.5 bg-white/90 rounded-[5px] shadow-sm hover:bg-white cursor-pointer" onClick={(e) => { e.stopPropagation(); onMove() }} title="Move to folder">
              <FolderInput className="w-3 h-3 text-muted-foreground" />
            </button>
            <button aria-label="Duplicate" className="p-1.5 bg-white/90 rounded-[5px] shadow-sm hover:bg-white cursor-pointer" onClick={(e) => { e.stopPropagation(); onDuplicate() }} title="Duplicate">
              <Copy className="w-3 h-3 text-muted-foreground" />
            </button>
            <button aria-label="Delete" className="p-1.5 bg-white/90 rounded-[5px] shadow-sm hover:bg-white cursor-pointer" onClick={(e) => { e.stopPropagation(); onDelete() }} title="Delete">
              <Trash2 className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-3 py-2.5">
        {isEditing ? (
          <input
            className="text-[14px] font-medium text-foreground bg-white border border-border rounded-[5px] px-2 py-0.5 w-full outline-none focus:ring-1 focus:ring-ring"
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onBlur={() => { if (editValue.trim()) onSaveEdit(editValue.trim()); else onCancelEdit() }}
            onKeyDown={(e) => { if (e.key === 'Enter' && editValue.trim()) onSaveEdit(editValue.trim()); if (e.key === 'Escape') onCancelEdit() }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-medium text-foreground truncate">{file.name}</span>
              {file.isScratchpad && <Pencil className="w-3 h-3 text-muted-foreground/40 shrink-0" />}
            </div>
            <p className="text-[12px] text-muted-foreground/60 mt-0.5">
              {file.isScratchpad ? 'Your permanent draft' : `Edited ${timeAgo(file.updatedAt)}`}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function FileListRow({
  file,
  onOpen,
  onDuplicate,
  onDelete,
  onMove,
  timeAgo,
}: {
  file: DesignFile
  onOpen: () => void
  onDuplicate: () => void
  onDelete: () => void
  onMove: () => void
  timeAgo: (d: string) => string
}) {
  return (
    <div
      className="group flex items-center gap-4 px-4 py-3 rounded-[7px] cursor-pointer hover:bg-muted/30 transition-colors"
      onClick={onOpen}
      draggable={!file.isScratchpad}
      onDragStart={(e) => { e.dataTransfer.setData(FILE_DND, file.id); e.dataTransfer.effectAllowed = 'move' }}
    >
      <FileText className="w-5 h-5 text-muted-foreground/40 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-[14px] font-medium text-foreground">{file.name}</span>
        {file.isScratchpad && <span className="text-[11px] text-muted-foreground/50 ml-2">Draft</span>}
      </div>
      <span className="text-[12px] text-muted-foreground/50 shrink-0 tabular-nums">
        {file.pages.length} page{file.pages.length !== 1 ? 's' : ''}
      </span>
      <span className="text-[12px] text-muted-foreground/50 shrink-0 w-24 text-right">
        {timeAgo(file.updatedAt)}
      </span>
      {!file.isScratchpad && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity shrink-0">
          <button aria-label="Move to folder" className="p-1 hover:bg-muted rounded-[3px] cursor-pointer" onClick={(e) => { e.stopPropagation(); onMove() }} title="Move to folder">
            <FolderInput className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button aria-label="Duplicate" className="p-1 hover:bg-muted rounded-[3px] cursor-pointer" onClick={(e) => { e.stopPropagation(); onDuplicate() }}>
            <Copy className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button aria-label="Delete" className="p-1 hover:bg-muted rounded-[3px] cursor-pointer" onClick={(e) => { e.stopPropagation(); onDelete() }}>
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      )}
    </div>
  )
}
