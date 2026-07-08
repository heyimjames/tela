import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { DEFAULT_FORMAT } from '@/brand/formats'
import { getBrandColor } from '@/brand/palette'
import type { DesignFile, DesignPage, DesignFrame, Folder } from '@/types/fileSystem'
import type { BackgroundLayer } from '@/types/design'

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
    backgroundFill: { type: 'solid', color: getBrandColor('cloud') },
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

function createDefaultPage(name: string = 'Page 1'): DesignPage {
  return {
    id: nanoid(),
    name,
    frames: [createDefaultFrame()],
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

  // Sync workspace pages back into file
  updateFilePages: (fileId: string, pages: Array<{ id: string; name: string; frames: Array<Record<string, any>> }>) => void

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
          pages: [createDefaultPage()],
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
              ? {
                  ...f,
                  pages: pages.map((p) => ({
                    id: p.id,
                    name: p.name,
                    frames: p.frames.map((fr) => ({
                      id: fr.id,
                      name: fr.name,
                      x: fr.x,
                      y: fr.y,
                      width: fr.width,
                      height: fr.height,
                      format: fr.format,
                      backgroundFill: fr.backgroundFill,
                      layers: fr.layers,
                      autoLayouts: fr.autoLayouts,
                    })),
                  })),
                  updatedAt: new Date().toISOString(),
                }
              : f
          ),
        }))
      },

      getFile: (id) => get().files.find((f) => f.id === id),
      getFilesInFolder: (folderId) => get().files.filter((f) => f.folderId === folderId),
      getSubFolders: (parentId) => get().folders.filter((f) => f.parentId === parentId),
      getScratchpad: () => get().files.find((f) => f.isScratchpad) ?? createScratchpadFile(),
    }),
    { name: 'canvas-studio-files' },
  ),
)
