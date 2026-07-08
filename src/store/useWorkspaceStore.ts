import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { DEFAULT_FORMAT, AD_FORMATS } from '@/brand/formats'
import { getBrandColor } from '@/brand/palette'
import { reflowLayers } from '@/engine/reflow'
import { useDesignStore } from '@/store/useDesignStore'
import type { Frame, Workspace, Page } from '@/types/workspace'
import type { Layer, AdFormat, BackgroundLayer } from '@/types/design'

// --- Default frame ---

function createDefaultFrame(
  format: AdFormat = DEFAULT_FORMAT,
  position: { x: number; y: number } = { x: 0, y: 0 },
  name?: string,
): Frame {
  return {
    id: nanoid(),
    name: name ?? format.label,
    x: position.x,
    y: position.y,
    width: format.width,
    height: format.height,
    format,
    backgroundColor: getBrandColor('cloud'),
    backgroundFill: { type: 'solid', color: getBrandColor('cloud') },
    layers: [{
      id: nanoid(),
      type: 'background',
      name: 'Background',
      visible: true,
      locked: false,
      opacity: 1,
      x: 0,
      y: 0,
      width: format.width,
      height: format.height,
      rotation: 0,
      zIndex: 0,
      fill: { type: 'solid', color: getBrandColor('cloud') },
    } as BackgroundLayer],
    locked: false,
    visible: true,
  }
}

function createDefaultPage(name: string = 'Scratchpad', includeFrame: boolean = false): Page {
  return {
    id: nanoid(),
    name,
    frames: includeFrame ? [createDefaultFrame()] : [],
    looseElements: [],
  }
}

// Helper to update frames in the active page
function updateActivePageFrames(
  workspace: Workspace,
  updater: (frames: Frame[]) => Frame[],
): Workspace {
  return {
    ...workspace,
    pages: workspace.pages.map((p) =>
      p.id === workspace.activePageId
        ? { ...p, frames: updater(p.frames) }
        : p
    ),
  }
}

function getActivePageFrames(workspace: Workspace): Frame[] {
  const page = workspace.pages.find((p) => p.id === workspace.activePageId)
  return page?.frames ?? []
}

// --- Store ---

interface WorkspaceStore {
  workspace: Workspace
  activeFrameId: string | null
  activeFileId: string | null
  // Multi-frame selection (ephemeral — drives marquee/outlines, not persisted).
  selectedFrameIds: Set<string>
  setSelectedFrames: (ids: string[]) => void

  // Page CRUD
  addPage: (name?: string) => string
  removePage: (id: string) => void
  renamePage: (id: string, name: string) => void
  setActivePage: (id: string) => void
  getActivePage: () => Page | undefined

  // Frame CRUD (operates on active page)
  addFrame: (format?: AdFormat, position?: { x: number; y: number }, name?: string) => string
  removeFrame: (id: string) => void
  duplicateFrame: (id: string) => string
  updateFrame: (id: string, updates: Partial<Pick<Frame, 'name' | 'x' | 'y' | 'locked' | 'visible'>>) => void
  /** Change a frame's format in place, reflowing its layers to fit the new size. */
  setFrameFormat: (id: string, format: AdFormat) => void
  setActiveFrame: (id: string | null) => void

  // Convenience
  getActiveFrame: () => Frame | undefined
  getFrame: (id: string) => Frame | undefined

  // Auto-arrange frames
  arrangeFrames: (gap?: number) => void

  // Frame layers
  addLayerToFrame: (frameId: string, layer: Omit<Layer, 'id' | 'zIndex'>) => string
  updateLayerInFrame: (frameId: string, layerId: string, updates: Partial<Layer>) => void
  removeLayerFromFrame: (frameId: string, layerId: string) => void
  renameFrame: (frameId: string, name: string) => void

  // Generate all format variants
  generateFormatVariants: (sourceFrameId: string) => void
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      workspace: (() => {
        const scratchpad = createDefaultPage('Scratchpad')
        return {
          id: nanoid(),
          name: 'Untitled Workspace',
          pages: [scratchpad],
          activePageId: scratchpad.id,
          showFrameLabels: true,
          snapFrames: true,
        }
      })(),
      activeFrameId: null,
      activeFileId: null,
      selectedFrameIds: new Set<string>(),

      setSelectedFrames: (ids) => set({ selectedFrameIds: new Set(ids) }),

      // Page actions
      addPage: (name = 'New Page') => {
        const page = createDefaultPage(name, true) // Non-scratchpad pages get a default frame
        set((s) => ({
          workspace: {
            ...s.workspace,
            pages: [...s.workspace.pages, page],
            activePageId: page.id,
          },
        }))
        return page.id
      },

      removePage: (id) => {
        set((s) => {
          if (s.workspace.pages.length <= 1) return s
          const pages = s.workspace.pages.filter((p) => p.id !== id)
          return {
            workspace: {
              ...s.workspace,
              pages,
              activePageId: s.workspace.activePageId === id ? pages[0].id : s.workspace.activePageId,
            },
          }
        })
      },

      renamePage: (id, name) => {
        set((s) => ({
          workspace: {
            ...s.workspace,
            pages: s.workspace.pages.map((p) => p.id === id ? { ...p, name } : p),
          },
        }))
      },

      setActivePage: (id) => {
        set((s) => ({
          workspace: { ...s.workspace, activePageId: id },
          activeFrameId: null,
          selectedFrameIds: new Set<string>(),
        }))
      },

      getActivePage: () => {
        const { workspace } = get()
        return workspace.pages.find((p) => p.id === workspace.activePageId)
      },


      addFrame: (format, position, name) => {
        const id = nanoid()
        const page = get().getActivePage()
        if (!page) return id

        // Auto-position: place to the right of the last frame with gap
        if (!position) {
          const frames = page.frames
          if (frames.length > 0) {
            const rightmost = frames.reduce((max, f) =>
              (f.x + f.width) > (max.x + max.width) ? f : max, frames[0])
            position = { x: rightmost.x + rightmost.width + 80, y: rightmost.y }
          } else {
            position = { x: 0, y: 0 }
          }
        }

        const frame = createDefaultFrame(format ?? DEFAULT_FORMAT, position, name)
        frame.id = id

        set((s) => ({
          workspace: {
            ...s.workspace,
            ...updateActivePageFrames(s.workspace, (f) => [...f, frame]),
          },
          activeFrameId: id,
          selectedFrameIds: new Set([id]),
        }))
        return id
      },

      removeFrame: (id) => {
        set((s) => {
          const selectedFrameIds = new Set(s.selectedFrameIds)
          selectedFrameIds.delete(id)
          return {
            workspace: {
              ...s.workspace,
              ...updateActivePageFrames(s.workspace, (frames) => frames.filter((f) => f.id !== id)),
            },
            activeFrameId: s.activeFrameId === id ? null : s.activeFrameId,
            selectedFrameIds,
          }
        })
      },

      duplicateFrame: (id) => {
        const frame = get().getFrame(id)
        if (!frame) return ''

        const newId = nanoid()
        const duplicate: Frame = {
          ...structuredClone(frame),
          id: newId,
          name: `${frame.name} copy`,
          x: frame.x + frame.width + 80,
          layers: frame.layers.map((l) => ({ ...l, id: nanoid() })),
        }

        set((s) => ({
          workspace: {
            ...s.workspace,
            ...updateActivePageFrames(s.workspace, (f) => [...f, duplicate]),
          },
          activeFrameId: newId,
          selectedFrameIds: new Set([newId]),
        }))
        return newId
      },

      updateFrame: (id, updates) => {
        set((s) => ({
          workspace: updateActivePageFrames(s.workspace, (frames) =>
            frames.map((f) => f.id === id ? { ...f, ...updates } : f)
          ),
        }))
      },

      setFrameFormat: (id, format) => {
        // The active frame's live copy lives in the design store, so route
        // through it (reflow + sync-back) to keep the two in step. Any other
        // frame is reflowed directly here.
        if (get().activeFrameId === id) {
          useDesignStore.getState().setFormat(format)
          return
        }
        set((s) => ({
          workspace: updateActivePageFrames(s.workspace, (frames) =>
            frames.map((f) => f.id === id
              ? {
                  ...f,
                  format,
                  width: format.width,
                  height: format.height,
                  layers: reflowLayers(f.layers, { width: f.width, height: f.height }, format),
                }
              : f),
          ),
        }))
      },

      setActiveFrame: (id) => set({ activeFrameId: id }),

      getActiveFrame: () => {
        const { activeFrameId } = get()
        const page = get().getActivePage()
        return page?.frames.find((f) => f.id === activeFrameId)
      },

      getFrame: (id) => {
        const page = get().getActivePage()
        return page?.frames.find((f) => f.id === id)
      },

      arrangeFrames: (gap = 80) => {
        set((s) => ({
          workspace: updateActivePageFrames(s.workspace, (frames) => {
            const sorted = [...frames].sort((a, b) => a.height - b.height || a.x - b.x)
            let currentX = 0
            return sorted.map((f) => {
              const updated = { ...f, x: currentX, y: 0 }
              currentX += f.width + gap
              return updated
            })
          }),
        }))
      },

      addLayerToFrame: (frameId, layerWithoutId) => {
        const id = nanoid()
        set((s) => ({
          workspace: updateActivePageFrames(s.workspace, (frames) =>
            frames.map((f) => {
              if (f.id !== frameId) return f
              const maxZ = f.layers.length === 0 ? -1 : Math.max(...f.layers.map((l) => l.zIndex))
              return { ...f, layers: [...f.layers, { ...layerWithoutId, id, zIndex: maxZ + 1 } as Layer] }
            })
          ),
        }))
        return id
      },

      updateLayerInFrame: (frameId, layerId, updates) => {
        set((s) => ({
          workspace: updateActivePageFrames(s.workspace, (frames) =>
            frames.map((f) => f.id !== frameId ? f : {
              ...f,
              layers: f.layers.map((l) => l.id === layerId ? ({ ...l, ...updates } as Layer) : l),
            })
          ),
        }))
      },

      removeLayerFromFrame: (frameId, layerId) => {
        set((s) => ({
          workspace: updateActivePageFrames(s.workspace, (frames) =>
            frames.map((f) => f.id !== frameId ? f : {
              ...f,
              layers: f.layers.filter((l) => l.id !== layerId),
            })
          ),
        }))
      },

      renameFrame: (frameId, name) => {
        set((s) => ({
          workspace: updateActivePageFrames(s.workspace, (frames) =>
            frames.map((f) => f.id === frameId ? { ...f, name } : f)
          ),
        }))
      },

      generateFormatVariants: (sourceFrameId) => {
        const source = get().getFrame(sourceFrameId)
        if (!source) return

        const otherFormats = AD_FORMATS.filter((f) => f.id !== source.format.id)
        let offsetX = source.x + source.width + 80

        for (const format of otherFormats) {
          const frame = createDefaultFrame(format, { x: offsetX, y: source.y })

          // Scale layers from source to new format
          const scaleX = format.width / source.width
          const scaleY = format.height / source.height
          const uniformScale = Math.min(scaleX, scaleY)

          frame.layers = source.layers.map((layer) => {
            const scaled = { ...structuredClone(layer), id: nanoid() }

            if (scaled.type === 'background') {
              scaled.width = format.width
              scaled.height = format.height
              return scaled
            }

            // Scale and reposition
            const relX = (scaled.x + scaled.width / 2) / source.width
            const relY = (scaled.y + scaled.height / 2) / source.height
            scaled.width = Math.round(scaled.width * uniformScale)
            scaled.height = Math.round(scaled.height * uniformScale)
            scaled.x = Math.round(relX * format.width - scaled.width / 2)
            scaled.y = Math.round(relY * format.height - scaled.height / 2)

            if ('fontSize' in scaled) {
              (scaled as any).fontSize = Math.round((scaled as any).fontSize * uniformScale)
            }

            return scaled
          })

          frame.backgroundFill = structuredClone(source.backgroundFill)

          set((s) => ({
            workspace: {
              ...s.workspace,
              ...updateActivePageFrames(s.workspace, (f) => [...f, frame]),
            },
          }))

          offsetX += format.width + 80
        }
      },
    }),
    {
      name: 'canvas-studio-workspace',
      version: 2,
      partialize: (state) => ({
        workspace: state.workspace,
        activeFrameId: state.activeFrameId,
        activeFileId: state.activeFileId,
      }),
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          // Old format had workspace.frames — migrate to workspace.pages
          const old = persisted as any
          if (old?.workspace?.frames && !old?.workspace?.pages) {
            const pageId = nanoid()
            old.workspace.pages = [{
              id: pageId,
              name: 'Scratchpad',
              frames: old.workspace.frames,
              looseElements: [],
            }]
            old.workspace.activePageId = pageId
            delete old.workspace.frames
          }
        }
        return persisted
      },
    },
  ),
)
