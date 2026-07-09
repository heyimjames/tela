import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type { Project, Folder, AdDesign, ApprovalStatus, Comment, DesignVersion } from '@/types/project'
import type { DesignDocument } from '@/types/design'

interface ProjectStore {
  projects: Project[]
  activeProjectId: string | null
  activeFolderId: string | null

  // Project CRUD
  createProject: (name: string, description?: string) => string
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'description'>>) => void
  deleteProject: (id: string) => void

  // Folder CRUD
  createFolder: (projectId: string, name: string, parentId?: string | null) => string
  renameFolder: (projectId: string, folderId: string, name: string) => void
  deleteFolder: (projectId: string, folderId: string) => void

  // Design management
  addDesign: (projectId: string, document: DesignDocument, folderId?: string | null) => string
  updateDesign: (projectId: string, designId: string, document: DesignDocument) => void
  removeDesign: (projectId: string, designId: string) => void
  setDesignStatus: (projectId: string, designId: string, status: ApprovalStatus) => void
  bulkSetStatus: (projectId: string, designIds: string[], status: ApprovalStatus) => void

  // Comments
  addComment: (projectId: string, designId: string, text: string, author: string, pinX?: number, pinY?: number) => void
  resolveComment: (projectId: string, designId: string, commentId: string) => void

  // Versions
  saveVersion: (projectId: string, designId: string, name: string) => void
  restoreVersion: (projectId: string, designId: string, versionId: string) => DesignDocument | null

  // Navigation
  setActiveProject: (id: string | null) => void
  setActiveFolder: (id: string | null) => void

  // Helpers
  getProject: (id: string) => Project | undefined
  getDesignsInFolder: (projectId: string, folderId: string | null) => AdDesign[]
  getAllDesignsInProject: (projectId: string) => AdDesign[]
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      activeFolderId: null,

      createProject: (name, description = '') => {
        const id = nanoid()
        const now = new Date().toISOString()
        const project: Project = {
          id,
          name,
          description,
          folders: [],
          designs: [],
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ projects: [...s.projects, project] }))
        return id
      },

      updateProject: (id, updates) => {
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id
              ? { ...p, ...updates, updatedAt: new Date().toISOString() }
              : p
          ),
        }))
      },

      deleteProject: (id) => {
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
        }))
      },

      createFolder: (projectId, name, parentId = null) => {
        const id = nanoid()
        const folder: Folder = {
          id,
          name,
          parentId,
          createdAt: new Date().toISOString(),
        }
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? { ...p, folders: [...p.folders, folder], updatedAt: new Date().toISOString() }
              : p
          ),
        }))
        return id
      },

      renameFolder: (projectId, folderId, name) => {
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  folders: p.folders.map((f) => (f.id === folderId ? { ...f, name } : f)),
                  updatedAt: new Date().toISOString(),
                }
              : p
          ),
        }))
      },

      deleteFolder: (projectId, folderId) => {
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  folders: p.folders.filter((f) => f.id !== folderId),
                  updatedAt: new Date().toISOString(),
                }
              : p
          ),
        }))
      },

      addDesign: (projectId, document, _folderId = null) => {
        const id = nanoid()
        const now = new Date().toISOString()
        const design: AdDesign = {
          id,
          document,
          status: 'draft',
          comments: [],
          versions: [],
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? { ...p, designs: [...p.designs, design], updatedAt: now }
              : p
          ),
        }))
        return id
      },

      updateDesign: (projectId, designId, document) => {
        const now = new Date().toISOString()
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  designs: p.designs.map((d) =>
                    d.id === designId ? { ...d, document, updatedAt: now } : d
                  ),
                  updatedAt: now,
                }
              : p
          ),
        }))
      },

      removeDesign: (projectId, designId) => {
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  designs: p.designs.filter((d) => d.id !== designId),
                  updatedAt: new Date().toISOString(),
                }
              : p
          ),
        }))
      },

      setDesignStatus: (projectId, designId, status) => {
        const now = new Date().toISOString()
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  designs: p.designs.map((d) =>
                    d.id === designId ? { ...d, status, updatedAt: now } : d
                  ),
                  updatedAt: now,
                }
              : p
          ),
        }))
      },

      bulkSetStatus: (projectId, designIds, status) => {
        const idSet = new Set(designIds)
        const now = new Date().toISOString()
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  designs: p.designs.map((d) =>
                    idSet.has(d.id) ? { ...d, status, updatedAt: now } : d
                  ),
                  updatedAt: now,
                }
              : p
          ),
        }))
      },

      setActiveProject: (id) => set({ activeProjectId: id, activeFolderId: null }),
      setActiveFolder: (id) => set({ activeFolderId: id }),

      getProject: (id) => get().projects.find((p) => p.id === id),

      getDesignsInFolder: (_projectId, _folderId) => {
        // For now, all designs are at project root (no folder assignment yet)
        const project = get().projects.find((p) => p.id === _projectId)
        return project?.designs ?? []
      },

      getAllDesignsInProject: (projectId) => {
        const project = get().projects.find((p) => p.id === projectId)
        return project?.designs ?? []
      },

      addComment: (projectId, designId, text, author, pinX, pinY) => {
        const comment: Comment = {
          id: nanoid(),
          text,
          author,
          pinX,
          pinY,
          resolved: false,
          createdAt: new Date().toISOString(),
        }
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  designs: p.designs.map((d) =>
                    d.id === designId
                      ? { ...d, comments: [...(d.comments ?? []), comment] }
                      : d
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : p
          ),
        }))
      },

      saveVersion: (projectId, designId, name) => {
        const project = get().projects.find((p) => p.id === projectId)
        const design = project?.designs.find((d) => d.id === designId)
        if (!design) return

        const version: DesignVersion = {
          id: nanoid(),
          name,
          document: structuredClone(design.document),
          createdAt: new Date().toISOString(),
        }

        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  designs: p.designs.map((d) =>
                    d.id === designId
                      ? { ...d, versions: [...(d.versions ?? []), version] }
                      : d
                  ),
                }
              : p
          ),
        }))
      },

      restoreVersion: (projectId, designId, versionId) => {
        const project = get().projects.find((p) => p.id === projectId)
        const design = project?.designs.find((d) => d.id === designId)
        const version = (design?.versions ?? []).find((v) => v.id === versionId)
        if (!version) return null
        return structuredClone(version.document)
      },

      resolveComment: (projectId, designId, commentId) => {
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  designs: p.designs.map((d) =>
                    d.id === designId
                      ? {
                          ...d,
                          comments: (d.comments ?? []).map((c) =>
                            c.id === commentId ? { ...c, resolved: true } : c
                          ),
                        }
                      : d
                  ),
                }
              : p
          ),
        }))
      },
    }),
    {
      name: 'tela-projects',
    },
  ),
)
