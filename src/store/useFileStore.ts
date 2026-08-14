import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { DEFAULT_FORMAT } from '@/brand/formats'
import { getBrandColor } from '@/brand/palette'
import type { DesignFile, DesignPage, DesignFrame, Folder } from '@/types/fileSystem'
import type { BackgroundLayer, BrandColor } from '@/types/design'

// --- Factories ---

function createDefaultFrame(name?: string): DesignFrame {
  return {
    id: nanoid(),
    name: name ?? DEFAULT_FORMAT.label,
    x: 0,
    y: 0,
    width: DEFAULT_FORMAT.width,
    height: DEFAULT_FORMAT.height,
    format: DEFAULT_FORMAT,
    backgroundColor: getBrandColor('cloud'),
    backgroundFill: { type: 'solid', color: getBrandColor('cloud') },
    locked: false,
    visible: true,
    layers: [{
      id: nanoid(),
      type: 'background',
      name: 'Background',
      visible: true,
      locked: false,
      opacity: 1,
      x: 0, y: 0,
      width: DEFAULT_FORMAT.width,
      height: DEFAULT_FORMAT.height,
      rotation: 0,
      zIndex: 0,
      fill: { type: 'solid', color: getBrandColor('cloud') },
    } as BackgroundLayer],
  }
}

/**
 * Draw layers persisted before `natWidth`/`natHeight` existed have no natural size.
 * Every render path already guards for that (`layer.natWidth ? … : 1`), but the
 * `.tela` schema requires both, so a cache holding one of these layers could never be
 * exported. The natural size *is* the layer's own size for a stroke that has never
 * been scaled, which is exactly the case for these.
 */
function backfillDrawLayers(layers: unknown[]): void {
  for (const layer of layers) {
    if (typeof layer !== 'object' || layer === null) continue
    const record = layer as Record<string, unknown>
    if (record.type !== 'draw') continue
    if (typeof record.natWidth !== 'number') record.natWidth = record.width
    if (typeof record.natHeight !== 'number') record.natHeight = record.height
  }
}

function createDefaultPage(name: string = 'Page 1', frameName?: string): DesignPage {
  return {
    id: nanoid(),
    name,
    frames: [createDefaultFrame(frameName)],
    looseElements: [],
  }
}

function createScratchpadFile(): DesignFile {
  const now = new Date().toISOString()
  return {
    id: 'scratchpad',
    name: 'Scratchpad',
    folderId: null,
    pages: [createDefaultPage('Draft')],
    isScratchpad: true,
    createdAt: now,
    updatedAt: now,
  }
}

// --- Store ---

interface FileStore {
  files: DesignFile[]
  folders: Folder[]

  // File CRUD
  createFile: (name: string, folderId?: string | null) => string
  deleteFile: (id: string) => void
  renameFile: (id: string, name: string) => void
  moveFileToFolder: (fileId: string, folderId: string | null) => void
  duplicateFile: (id: string) => string

  // Folder CRUD
  createFolder: (name: string, parentId?: string | null) => string
  deleteFolder: (id: string) => void
  renameFolder: (id: string, name: string) => void

  // Page management within a file
  addPage: (fileId: string, name?: string) => string
  removePage: (fileId: string, pageId: string) => void
  renamePage: (fileId: string, pageId: string, name: string) => void

  /**
   * Sync workspace pages back into a file.
   *
   * Takes whole `DesignPage`s and stores them structurally. The previous
   * signature took loosely-typed frames and rebuilt each one from a ten-field
   * list, which is what made every save lossy; a structural copy cannot forget a
   * field, and the shared type means the compiler catches a new one.
   */
  updateFilePages: (fileId: string, pages: DesignPage[]) => void

  // Helpers
  getFile: (id: string) => DesignFile | undefined
  getFilesInFolder: (folderId: string | null) => DesignFile[]
  getSubFolders: (parentId: string | null) => Folder[]
  getScratchpad: () => DesignFile
}

export const useFileStore = create<FileStore>()(
  persist(
    (set, get) => ({
      files: [createScratchpadFile()],
      folders: [],

      createFile: (name, folderId = null) => {
        const id = nanoid()
        const now = new Date().toISOString()
        const file: DesignFile = {
          id,
          name,
          folderId,
          // Name the default frame after the file so the editor title matches.
          pages: [createDefaultPage('Page 1', name)],
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ files: [...s.files, file] }))
        return id
      },

      deleteFile: (id) => {
        set((s) => ({ files: s.files.filter((f) => f.id !== id && !f.isScratchpad) }))
      },

      renameFile: (id, name) => {
        set((s) => ({
          files: s.files.map((f) => f.id === id && !f.isScratchpad ? { ...f, name, updatedAt: new Date().toISOString() } : f),
        }))
      },

      moveFileToFolder: (fileId, folderId) => {
        set((s) => ({
          files: s.files.map((f) => f.id === fileId ? { ...f, folderId } : f),
        }))
      },

      duplicateFile: (id) => {
        const file = get().getFile(id)
        if (!file) return ''
        const newId = nanoid()
        const now = new Date().toISOString()
        const duplicate: DesignFile = {
          ...structuredClone(file),
          id: newId,
          name: `${file.name} copy`,
          isScratchpad: false,
          createdAt: now,
          updatedAt: now,
          pages: file.pages.map((p) => ({
            ...p,
            id: nanoid(),
            frames: p.frames.map((fr) => ({ ...fr, id: nanoid(), layers: fr.layers.map((l) => ({ ...l, id: nanoid() })) })),
            looseElements: (p.looseElements ?? []).map((l) => ({ ...l, id: nanoid() })),
          })),
        }
        set((s) => ({ files: [...s.files, duplicate] }))
        return newId
      },

      createFolder: (name, parentId = null) => {
        const id = nanoid()
        const folder: Folder = { id, name, parentId, createdAt: new Date().toISOString() }
        set((s) => ({ folders: [...s.folders, folder] }))
        return id
      },

      deleteFolder: (id) => {
        set((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          files: s.files.map((f) => f.folderId === id ? { ...f, folderId: null } : f),
        }))
      },

      renameFolder: (id, name) => {
        set((s) => ({ folders: s.folders.map((f) => f.id === id ? { ...f, name } : f) }))
      },

      addPage: (fileId, name) => {
        const pageId = nanoid()
        const page = createDefaultPage(name ?? 'New Page')
        page.id = pageId
        set((s) => ({
          files: s.files.map((f) => f.id === fileId ? { ...f, pages: [...f.pages, page], updatedAt: new Date().toISOString() } : f),
        }))
        return pageId
      },

      removePage: (fileId, pageId) => {
        set((s) => ({
          files: s.files.map((f) => {
            if (f.id !== fileId || f.pages.length <= 1) return f
            return { ...f, pages: f.pages.filter((p) => p.id !== pageId), updatedAt: new Date().toISOString() }
          }),
        }))
      },

      renamePage: (fileId, pageId, name) => {
        set((s) => ({
          files: s.files.map((f) => f.id === fileId ? {
            ...f,
            pages: f.pages.map((p) => p.id === pageId ? { ...p, name } : p),
            updatedAt: new Date().toISOString(),
          } : f),
        }))
      },

      updateFilePages: (fileId, pages) => {
        set((s) => ({
          files: s.files.map((f) =>
            f.id === fileId
              ? { ...f, pages: structuredClone(pages), updatedAt: new Date().toISOString() }
              : f
          ),
        }))
      },

      getFile: (id) => get().files.find((f) => f.id === id),
      getFilesInFolder: (folderId) => get().files.filter((f) => f.folderId === folderId),
      getSubFolders: (parentId) => get().folders.filter((f) => f.parentId === parentId),
      getScratchpad: () => get().files.find((f) => f.isScratchpad) ?? createScratchpadFile(),
    }),
    {
      name: 'tela-files',
      // localStorage is a *cache*, not the master. The durable artifact is the
      // `.tela` bundle; see docs/tela-format.md.
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        if (version >= 2) return persisted
        // v1 stored the narrower frame shape. Restore the three frame fields and
        // the loose-element list it had no room for, so a cache written by the
        // old code still loads into the single frame model.
        const state = persisted as { files?: Array<{ pages?: Array<Record<string, unknown>> }> }
        for (const file of state?.files ?? []) {
          for (const page of file.pages ?? []) {
            const frames = (page.frames ?? []) as Array<Record<string, unknown>>
            for (const frame of frames) {
              const fill = frame.backgroundFill as { type?: string; color?: BrandColor } | undefined
              frame.backgroundColor ??=
                fill?.type === 'solid' && fill.color ? fill.color : getBrandColor('cloud')
              frame.locked ??= false
              frame.visible ??= true
              // The old `createFromTemplate` built frames with no coordinates at
              // all, and the old whitelisting writer dropped the undefined values,
              // so a v1 cache can hold frames without x/y. The canvas would place
              // them at NaN and the lossless save path would reject the document.
              frame.x ??= 0
              frame.y ??= 0
            }
            page.looseElements ??= []
            backfillDrawLayers(frames.flatMap((frame) => (frame.layers ?? []) as unknown[]))
            backfillDrawLayers((page.looseElements ?? []) as unknown[])
          }
        }
        return persisted
      },
    },
  ),
)
