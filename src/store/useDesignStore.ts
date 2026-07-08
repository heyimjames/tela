import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { DEFAULT_FORMAT } from '@/brand/formats'
import { getBrandColor } from '@/brand/palette'
import { reflowLayers } from '@/engine/reflow'
import { computeAutoLayout, inferAutoLayout, type LayoutChild } from '@/engine/autoLayout'
import { getTextBounds, createMeasureContext } from '@/engine/textMeasure'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import type {
  DesignDocument,
  Layer,
  LayerId,
  ToolMode,
  AdFormat,
  BackgroundLayer,
  TextLayer,
  GroupLayer,
  AutoLayoutConfig,
} from '@/types/design'

// --- Sync helper: write design store layers back to workspace frame ---
let _syncScheduled = false
// Guards reflow re-entry: reflowGroup rewrites member x/y directly, and the
// updateLayer resize-hook must not fire another reflow while one is in flight.
let _reflowing = false
// Auto-width text hugs its content: measure the natural (unwrapped) bounds and
// return a box that fits the widest line + all lines. Used on create and when
// the text/font changes, so the box tracks the text like Figma's auto-width.
function fitAutoWidthText(layer: TextLayer): { width: number; height: number } {
  const bounds = getTextBounds(createMeasureContext(), { ...layer, width: 100000 })
  return { width: Math.ceil(bounds.width) + 4, height: Math.ceil(bounds.height) + 2 }
}

function _syncBackToFrame() {
  // Debounce to avoid hammering workspace store on rapid mutations
  if (_syncScheduled) return
  _syncScheduled = true
  queueMicrotask(() => {
    _syncScheduled = false
    const wsState = useWorkspaceStore.getState()
    const frameId = wsState.activeFrameId
    if (!frameId) return

    const designLayers = useDesignStore.getState().document.layers
    const designFormat = useDesignStore.getState().document.format
    const designAutoLayouts = useDesignStore.getState().document.autoLayouts
    const frame = wsState.getFrame(frameId)
    if (!frame) return

    // Update layers in the workspace frame
    // We replace all layers at once by updating the frame via the page updater
    useWorkspaceStore.setState((s) => ({
      workspace: {
        ...s.workspace,
        pages: s.workspace.pages.map((p) =>
          p.id === s.workspace.activePageId
            ? {
                ...p,
                frames: p.frames.map((f) =>
                  f.id === frameId
                    ? { ...f, layers: structuredClone(designLayers), format: designFormat, width: designFormat.width, height: designFormat.height, autoLayouts: designAutoLayouts ? structuredClone(designAutoLayouts) : undefined }
                    : f
                ),
              }
            : p
        ),
      },
    }))
  })
}

// --- Legacy group migration ---
// Older documents stored groups as a separate `GroupLayer` container with
// `childIds`. We now tag members with a flat `groupId` instead. Convert any
// container layers into tags on their children and drop the containers.
function normalizeGroupContainers(layers: Layer[]): Layer[] {
  const containers = layers.filter((l) => l.type === 'group') as GroupLayer[]
  if (containers.length === 0) return layers

  const childToGroup = new Map<LayerId, string>()
  for (const g of containers) {
    for (const childId of g.childIds) childToGroup.set(childId, g.id)
  }
  return layers
    .filter((l) => l.type !== 'group')
    .map((l) =>
      childToGroup.has(l.id) ? ({ ...l, groupId: childToGroup.get(l.id) } as Layer) : l,
    )
}

// --- History config ---
const MAX_HISTORY = 100

// --- Default document ---

function createDefaultBackground(): BackgroundLayer {
  return {
    id: nanoid(),
    type: 'background',
    name: 'Background',
    visible: true,
    locked: false,
    opacity: 1,
    x: 0,
    y: 0,
    width: DEFAULT_FORMAT.width,
    height: DEFAULT_FORMAT.height,
    rotation: 0,
    zIndex: 0,
    fill: { type: 'solid', color: getBrandColor('cloud') },
  }
}

function createDefaultDocument(): DesignDocument {
  const now = new Date().toISOString()
  return {
    id: nanoid(),
    name: 'Untitled Ad',
    format: DEFAULT_FORMAT,
    layers: [createDefaultBackground()],
    createdAt: now,
    updatedAt: now,
  }
}

// --- Saved version type ---
interface SavedVersion {
  id: string
  name: string
  document: DesignDocument
  createdAt: string
}

// --- Store ---

interface DesignStore {
  // Document
  document: DesignDocument

  // Selection
  selectedLayerIds: Set<LayerId>
  activeLayerId: LayerId | null

  // Canvas
  tool: ToolMode
  zoom: number
  panOffset: { x: number; y: number }

  // Text editing
  editingTextLayerId: LayerId | null

  // History
  history: DesignDocument[]
  historyIndex: number

  // Saved versions
  savedVersions: SavedVersion[]

  // --- Actions ---

  // Layer CRUD
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addLayer: (layerWithoutId: Record<string, any>) => LayerId
  // Insert several layers at once (e.g. a design-system component made of a
  // shape + label). Pushes a single undo snapshot, stacks z-indices in order,
  // and leaves every new layer selected so it can be dragged as one unit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addLayers: (layersWithoutId: Array<Record<string, any>>) => LayerId[]
  removeLayer: (id: LayerId) => void
  removeLayers: (ids: LayerId[]) => void
  updateLayer: <T extends Layer>(id: LayerId, updates: Partial<T>) => void
  duplicateLayer: (id: LayerId) => void
  reorderLayer: (id: LayerId, newZIndex: number) => void
  // Reorder the whole current selection as a block (preserving its relative
  // order) in one undo step. `front`/`back` jump to the top/bottom (above the
  // background); `forward`/`backward` move one step.
  reorderSelection: (ids: LayerId[], mode: 'front' | 'back' | 'forward' | 'backward') => void
  groupSelectedLayers: () => void
  ungroupSelectedLayers: () => void
  ungroupLayer: (id: LayerId) => void

  // Auto Layout — Figma-style flow layout on a group (keyed by groupId).
  applyAutoLayout: () => void
  removeAutoLayout: (groupId: string) => void
  updateAutoLayoutConfig: (groupId: string, partial: Partial<AutoLayoutConfig>, live?: boolean) => void
  reflowGroup: (groupId: string) => void

  // Selection
  selectLayer: (id: LayerId, additive?: boolean) => void
  deselectAll: () => void

  // Format
  setFormat: (format: AdFormat) => void

  // Document
  setDocumentName: (name: string) => void
  resetDocument: () => void
  loadFromFrame: (frame: { name: string; width: number; height: number; format: AdFormat; layers: Layer[]; autoLayouts?: Record<string, AutoLayoutConfig> }) => void
  syncToFrame: () => { layers: Layer[]; format: AdFormat }

  // Canvas
  setTool: (tool: ToolMode) => void
  setZoom: (zoom: number) => void
  setPanOffset: (offset: { x: number; y: number }) => void

  // Text editing
  setEditingTextLayerId: (id: LayerId | null) => void

  // History
  undo: () => void
  redo: () => void
  pushSnapshot: () => void

  // Versions
  saveVersion: (name?: string) => void
  restoreVersion: (versionId: string) => void
  deleteVersion: (versionId: string) => void

  // Helpers
  getLayer: (id: LayerId) => Layer | undefined
  getSelectedLayers: () => Layer[]
  getMaxZIndex: () => number
}

// After ANY layer removal (single or batch), keep Auto Layout groups consistent:
// reflow groups that still have members (container re-hugs, survivors repack) and
// drop the config for any group that's now empty. Called by removeLayer AND
// removeLayers so every delete path (layer row, context menu, command palette,
// agent commands) stays in sync.
function _syncAutoLayoutsAfterRemoval() {
  const cfgs = useDesignStore.getState().document.autoLayouts
  if (!cfgs) return
  for (const gid of Object.keys(cfgs)) {
    const st = useDesignStore.getState()
    const hasMembers = st.document.layers.some((l) => l.groupId === gid && l.type !== 'background')
    if (hasMembers) {
      st.reflowGroup(gid)
    } else {
      useDesignStore.setState((s) => {
        const next = { ...(s.document.autoLayouts ?? {}) }
        delete next[gid]
        return { document: { ...s.document, autoLayouts: next } }
      })
    }
  }
}

// All groupIds in the Auto Layout subtree rooted at `gid` (itself + descendants).
function _subtreeGroupIds(autoLayouts: Record<string, AutoLayoutConfig>, gid: string): string[] {
  const out = [gid]
  for (const [g, c] of Object.entries(autoLayouts)) {
    if (c.parentGroupId === gid) out.push(..._subtreeGroupIds(autoLayouts, g))
  }
  return out
}

// Recursively reflow an Auto Layout subtree: child groups FIRST (so their
// container boxes are current), then this group — laying out its loose member
// layers AND its child groups as composite units (a nested group is one child
// sized by its container box), and moving each child group as one rigid block.
// Runs under the _reflowing guard set by reflowGroup.
function _reflowSubtree(groupId: string): void {
  const al0 = useDesignStore.getState().document.autoLayouts
  if (!al0?.[groupId]) return
  const childGids = Object.entries(al0)
    .filter(([, c]) => c.parentGroupId === groupId)
    .map(([g]) => g)
  for (const cg of childGids) _reflowSubtree(cg)

  const d = useDesignStore.getState().document
  const cfg = d.autoLayouts![groupId]
  const horiz = cfg.direction === 'horizontal'
  type Unit = { kind: 'layer' | 'group'; id: string; w: number; h: number; x: number; y: number; grow?: boolean }
  const units: Unit[] = []
  for (const l of d.layers) {
    if (l.groupId === groupId && l.type !== 'background') {
      units.push({ kind: 'layer', id: l.id, w: l.width, h: l.height, x: l.x, y: l.y, grow: l.layoutGrow })
    }
  }
  for (const g of childGids) {
    const c = d.autoLayouts![g]
    if (c) units.push({ kind: 'group', id: g, w: c.width, h: c.height, x: c.x, y: c.y })
  }
  if (units.length === 0) return
  // Spatial order along the primary axis (nested groups have no single zIndex).
  units.sort((a, b) => (horiz ? a.x - b.x : a.y - b.y))

  const children: LayoutChild[] = units.map((u) => ({
    id: u.id,
    width: u.w,
    height: u.h,
    layoutGrow: u.kind === 'layer' ? u.grow : undefined,
  }))
  const layout = computeAutoLayout(cfg, children)
  const rectById = new Map(layout.rects.map((r) => [r.id, r]))

  const layerRect = new Map<string, { x: number; y: number; width: number; height: number }>()
  const layerShift = new Map<string, { dx: number; dy: number }>()
  const cfgOrigin = new Map<string, { x: number; y: number }>()
  for (const u of units) {
    const r = rectById.get(u.id)
    if (!r) continue
    if (u.kind === 'layer') {
      layerRect.set(u.id, { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })
    } else {
      // Move the child group's whole subtree (layers + config origins) as a block.
      const dx = Math.round(r.x) - u.x
      const dy = Math.round(r.y) - u.y
      if (dx || dy) {
        const sub = new Set(_subtreeGroupIds(d.autoLayouts!, u.id))
        for (const l of d.layers) if (l.groupId && sub.has(l.groupId)) layerShift.set(l.id, { dx, dy })
        for (const g of sub) { const c = d.autoLayouts![g]; if (c) cfgOrigin.set(g, { x: c.x + dx, y: c.y + dy }) }
      }
    }
  }

  useDesignStore.setState((s) => {
    const nextAL = { ...(s.document.autoLayouts ?? {}) }
    nextAL[groupId] = { ...nextAL[groupId], width: layout.width, height: layout.height }
    for (const [g, o] of cfgOrigin) if (nextAL[g]) nextAL[g] = { ...nextAL[g], x: o.x, y: o.y }
    return {
      document: {
        ...s.document,
        layers: s.document.layers.map((l) => {
          const rp = layerRect.get(l.id)
          if (rp) return { ...l, ...rp }
          const sh = layerShift.get(l.id)
          if (sh) return { ...l, x: Math.round(l.x + sh.dx), y: Math.round(l.y + sh.dy) }
          return l
        }),
        autoLayouts: nextAL,
        updatedAt: new Date().toISOString(),
      },
    }
  })
}

export const useDesignStore = create<DesignStore>()(
  persist(
    (set, get) => ({
  document: createDefaultDocument(),

  selectedLayerIds: new Set(),
  activeLayerId: null,

  tool: 'select',
  zoom: 1,
  panOffset: { x: 0, y: 0 },

  editingTextLayerId: null,

  history: [],
  historyIndex: -1,

  savedVersions: [],

  // --- Layer CRUD ---

  addLayer: (layerWithoutId) => {
    const id = nanoid()
    const zIndex = get().getMaxZIndex() + 1
    let layer = { ...layerWithoutId, id, zIndex } as Layer
    // Auto-width text hugs its content from birth so the box isn't a wide default.
    if (layer.type === 'text' && (layer as TextLayer).textSizing === 'auto-width') {
      layer = { ...layer, ...fitAutoWidthText(layer as TextLayer) } as Layer
    }

    get().pushSnapshot()
    set((s) => ({
      document: {
        ...s.document,
        layers: [...s.document.layers, layer],
        updatedAt: new Date().toISOString(),
      },
      selectedLayerIds: new Set([id]),
      activeLayerId: id,
    }))
    _syncBackToFrame()
    return id
  },

  addLayers: (layersWithoutId) => {
    if (layersWithoutId.length === 0) return []
    const baseZ = get().getMaxZIndex()
    const ids: LayerId[] = []
    const newLayers = layersWithoutId.map((l, i) => {
      const id = nanoid()
      ids.push(id)
      return { ...l, id, zIndex: baseZ + 1 + i } as Layer
    })

    get().pushSnapshot()
    set((s) => ({
      document: {
        ...s.document,
        layers: [...s.document.layers, ...newLayers],
        updatedAt: new Date().toISOString(),
      },
      selectedLayerIds: new Set(ids),
      activeLayerId: ids[ids.length - 1] ?? null,
    }))
    _syncBackToFrame()
    return ids
  },

  removeLayer: (id) => {
    get().pushSnapshot()
    set((s) => {
      const layers = s.document.layers.filter((l) => l.id !== id)
      const newSelected = new Set(s.selectedLayerIds)
      newSelected.delete(id)
      return {
        document: {
          ...s.document,
          layers,
          updatedAt: new Date().toISOString(),
        },
        selectedLayerIds: newSelected,
        activeLayerId: s.activeLayerId === id ? null : s.activeLayerId,
        editingTextLayerId: s.editingTextLayerId === id ? null : s.editingTextLayerId,
      }
    })
    _syncBackToFrame()
    _syncAutoLayoutsAfterRemoval()
  },

  // Remove several layers in one snapshot (e.g. deleting a whole group).
  removeLayers: (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    get().pushSnapshot()
    set((s) => ({
      document: {
        ...s.document,
        layers: s.document.layers.filter((l) => !idSet.has(l.id)),
        updatedAt: new Date().toISOString(),
      },
      selectedLayerIds: new Set([...s.selectedLayerIds].filter((id) => !idSet.has(id))),
      activeLayerId: s.activeLayerId && idSet.has(s.activeLayerId) ? null : s.activeLayerId,
      editingTextLayerId:
        s.editingTextLayerId && idSet.has(s.editingTextLayerId) ? null : s.editingTextLayerId,
    }))
    _syncBackToFrame()
    _syncAutoLayoutsAfterRemoval()
  },

  updateLayer: (id, updates) => {
    // Enforce whole-pixel positioning
    const snapped = { ...updates } as Record<string, unknown>
    if (typeof snapped.x === 'number') snapped.x = Math.round(snapped.x)
    if (typeof snapped.y === 'number') snapped.y = Math.round(snapped.y)
    if (typeof snapped.width === 'number') snapped.width = Math.round(snapped.width)
    if (typeof snapped.height === 'number') snapped.height = Math.round(snapped.height)

    set((s) => ({
      document: {
        ...s.document,
        layers: s.document.layers.map((l) => {
          if (l.id !== id) return l
          let merged = { ...l, ...snapped } as Layer
          // Auto-width text re-hugs when its text/font changes — but not on an
          // explicit resize (an explicit width/height means the user is sizing it).
          if (
            merged.type === 'text' &&
            (merged as TextLayer).textSizing === 'auto-width' &&
            snapped.width === undefined && snapped.height === undefined &&
            ('content' in snapped || 'fontSize' in snapped || 'fontWeight' in snapped ||
              'letterSpacing' in snapped || 'textTransform' in snapped || 'lineHeight' in snapped ||
              'verticalTrim' in snapped)
          ) {
            merged = { ...merged, ...fitAutoWidthText(merged as TextLayer) }
          }
          return merged
        }),
        updatedAt: new Date().toISOString(),
      },
    }))
    _syncBackToFrame()
    if (!_reflowing) {
      const l = get().getLayer(id)
      const gid = l?.groupId
      const cfg = gid ? get().document.autoLayouts?.[gid] : undefined
      if (gid && cfg) {
        if (snapped.width !== undefined || snapped.height !== undefined || snapped.layoutGrow !== undefined) {
          // A resized member (or Fill toggle) re-flows the group.
          get().reflowGroup(gid)
        } else if (snapped.x !== undefined || snapped.y !== undefined) {
          // A pure move of a member (whole-group drag / arrow nudge) slides the
          // container origin to follow, so the layout stays put relative to the
          // moved children instead of snapping back on the next reflow.
          const members = get().document.layers
            .filter((m) => m.groupId === gid && m.type !== 'background')
            .sort((a, b) => a.zIndex - b.zIndex)
          if (members.length) {
            const at0 = computeAutoLayout(
              { ...cfg, x: 0, y: 0 },
              members.map((m) => ({ id: m.id, width: m.width, height: m.height, layoutGrow: m.layoutGrow })),
            )
            const nx = Math.round(Math.min(...members.map((m) => m.x)) - Math.min(...at0.rects.map((r) => r.x)))
            const ny = Math.round(Math.min(...members.map((m) => m.y)) - Math.min(...at0.rects.map((r) => r.y)))
            if (nx !== cfg.x || ny !== cfg.y) {
              set((s) => ({
                document: {
                  ...s.document,
                  autoLayouts: { ...(s.document.autoLayouts ?? {}), [gid]: { ...cfg, x: nx, y: ny } },
                },
              }))
            }
          }
        }
      }
    }
  },

  duplicateLayer: (id) => {
    const layer = get().getLayer(id)
    if (!layer || layer.type === 'background') return

    const newId = nanoid()
    const zIndex = get().getMaxZIndex() + 1
    const duplicate: Layer = {
      ...layer,
      id: newId,
      name: `${layer.name} copy`,
      x: layer.x + 20,
      y: layer.y + 20,
      zIndex,
      // A single duplicated layer never keeps the source's group — it becomes
      // standalone rather than silently merging back into the original group.
      groupId: undefined,
    }

    get().pushSnapshot()
    set((s) => ({
      document: {
        ...s.document,
        layers: [...s.document.layers, duplicate],
        updatedAt: new Date().toISOString(),
      },
      selectedLayerIds: new Set([newId]),
      activeLayerId: newId,
    }))
    _syncBackToFrame()
  },

  reorderLayer: (id, newZIndex) => {
    get().pushSnapshot()
    set((s) => {
      const layers = [...s.document.layers]
      const layerIdx = layers.findIndex((l) => l.id === id)
      if (layerIdx === -1) return s

      const [layer] = layers.splice(layerIdx, 1)
      layer.zIndex = newZIndex

      // Renumber all layers
      layers.push(layer)
      layers
        .sort((a, b) => a.zIndex - b.zIndex)
        .forEach((l, i) => { l.zIndex = i })

      return {
        document: { ...s.document, layers, updatedAt: new Date().toISOString() },
      }
    })
    _syncBackToFrame()
  },

  reorderSelection: (ids, mode) => {
    const idSet = new Set(ids)
    // Nothing to do unless at least one non-background layer is selected.
    const hasSelectable = get().document.layers.some(
      (l) => idSet.has(l.id) && l.type !== 'background',
    )
    if (!hasSelectable) return

    get().pushSnapshot()
    set((s) => {
      const sorted = [...s.document.layers].sort((a, b) => a.zIndex - b.zIndex)
      // Backgrounds always stay pinned at the bottom; only non-background
      // layers participate in reordering.
      const backgrounds = sorted.filter((l) => l.type === 'background')
      const others = sorted.filter((l) => l.type !== 'background')

      let ordered: Layer[]
      if (mode === 'front') {
        ordered = [
          ...others.filter((l) => !idSet.has(l.id)),
          ...others.filter((l) => idSet.has(l.id)),
        ]
      } else if (mode === 'back') {
        ordered = [
          ...others.filter((l) => idSet.has(l.id)),
          ...others.filter((l) => !idSet.has(l.id)),
        ]
      } else {
        // One-step move: bubble each selected layer past its unselected
        // neighbour, preserving the selection's relative order and grouping.
        const arr = others.map((l) => ({ layer: l, selected: idSet.has(l.id) }))
        if (mode === 'forward') {
          for (let i = arr.length - 2; i >= 0; i--) {
            if (arr[i].selected && !arr[i + 1].selected) {
              const tmp = arr[i]
              arr[i] = arr[i + 1]
              arr[i + 1] = tmp
            }
          }
        } else {
          for (let i = 1; i < arr.length; i++) {
            if (arr[i].selected && !arr[i - 1].selected) {
              const tmp = arr[i]
              arr[i] = arr[i - 1]
              arr[i - 1] = tmp
            }
          }
        }
        ordered = arr.map((a) => a.layer)
      }

      // Renumber to contiguous integers (same scheme as reorderLayer).
      const layers = [...backgrounds, ...ordered].map((l, i) => ({ ...l, zIndex: i }))
      return {
        document: { ...s.document, layers, updatedAt: new Date().toISOString() },
      }
    })
    _syncBackToFrame()
  },

  // Tag every selected non-background layer with a shared groupId so they
  // re-select and transform as one unit. Layers stay flat and renderable.
  groupSelectedLayers: () => {
    const state = get()
    const selectedIds = new Set(state.selectedLayerIds)
    const members = state.document.layers.filter(
      (l) => selectedIds.has(l.id) && l.type !== 'background',
    )
    if (members.length < 2) return

    state.pushSnapshot()
    const groupId = nanoid()
    set((s) => ({
      document: {
        ...s.document,
        layers: s.document.layers.map((l) =>
          selectedIds.has(l.id) && l.type !== 'background' ? { ...l, groupId } : l,
        ),
        updatedAt: new Date().toISOString(),
      },
    }))
    _syncBackToFrame()
  },

  // Clear the groupId from every group represented in the current selection.
  ungroupSelectedLayers: () => {
    const state = get()
    const selected = state.getSelectedLayers().filter((l) => l.type !== 'background')
    const groupIds = new Set(selected.map((l) => l.groupId).filter(Boolean) as string[])
    if (groupIds.size === 0) return

    state.pushSnapshot()
    set((s) => ({
      document: {
        ...s.document,
        layers: s.document.layers.map((l) =>
          l.groupId && groupIds.has(l.groupId) ? { ...l, groupId: undefined } : l,
        ),
        updatedAt: new Date().toISOString(),
      },
    }))
    _syncBackToFrame()
  },

  // Clear the groupId of the group the given layer belongs to.
  ungroupLayer: (id) => {
    const layer = get().getLayer(id)
    if (!layer?.groupId) return
    const groupId = layer.groupId

    get().pushSnapshot()
    set((s) => ({
      document: {
        ...s.document,
        layers: s.document.layers.map((l) =>
          l.groupId === groupId ? { ...l, groupId: undefined } : l,
        ),
        updatedAt: new Date().toISOString(),
      },
    }))
    _syncBackToFrame()
  },

  // --- Auto Layout ---

  // Turn the current selection into an Auto Layout container: tag it as a group
  // (or reuse its group), infer direction + gap from the arrangement, and reflow.
  applyAutoLayout: () => {
    const state = get()
    const selected = state.getSelectedLayers().filter((l) => l.type !== 'background')
    if (selected.length < 2) return
    const autoLayouts = state.document.autoLayouts ?? {}

    const mkConfig = (boxes: { x: number; y: number; width: number; height: number }[]): AutoLayoutConfig => {
      const minX = Math.min(...boxes.map((b) => b.x))
      const minY = Math.min(...boxes.map((b) => b.y))
      const maxX = Math.max(...boxes.map((b) => b.x + b.width))
      const maxY = Math.max(...boxes.map((b) => b.y + b.height))
      const { direction, gap } = inferAutoLayout(boxes)
      return {
        direction, gap,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        primaryAlign: 'start', counterAlign: 'center',
        widthMode: 'hug', heightMode: 'hug',
        x: minX, y: minY, width: maxX - minX, height: maxY - minY,
      }
    }

    // Partition the selection into layout UNITS: each existing Auto Layout group
    // it touches (one composite unit) + each loose layer. Nest when ≥1 group is
    // involved — instead of flattening it, which would destroy the inner config.
    const innerGids = new Set<string>()
    const looseLayers: Layer[] = []
    for (const l of selected) {
      if (l.groupId && autoLayouts[l.groupId]) innerGids.add(l.groupId)
      else looseLayers.push(l)
    }
    const unitCount = innerGids.size + looseLayers.length

    if (innerGids.size >= 1 && unitCount >= 2) {
      // --- Nested: create an outer Auto Layout that contains the inner groups
      //     (as composite children) and any loose layers. ---
      state.pushSnapshot()
      const outerGid = nanoid()
      const boxes = [
        ...looseLayers.map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height })),
        ...[...innerGids].map((g) => {
          const c = autoLayouts[g]
          return { x: c.x, y: c.y, width: c.width, height: c.height }
        }),
      ]
      const config = mkConfig(boxes)
      const looseIds = new Set(looseLayers.map((l) => l.id))
      // Prefer a loose layer as the active layer so the outer container's overlay
      // shows (its groupId is the outer group).
      const activeId = looseLayers[0]?.id ?? selected[0].id
      set((s) => {
        const nextAL = { ...(s.document.autoLayouts ?? {}) }
        for (const g of innerGids) nextAL[g] = { ...nextAL[g], parentGroupId: outerGid }
        nextAL[outerGid] = config
        return {
          document: {
            ...s.document,
            layers: s.document.layers.map((l) => (looseIds.has(l.id) ? { ...l, groupId: outerGid } : l)),
            autoLayouts: nextAL,
            updatedAt: new Date().toISOString(),
          },
          selectedLayerIds: new Set(selected.map((m) => m.id)),
          activeLayerId: activeId,
        }
      })
      get().reflowGroup(outerGid)
      return
    }

    // --- Flat: tag the loose selection as one group and lay it out. ---
    state.pushSnapshot()
    const existing = new Set(selected.map((l) => l.groupId).filter(Boolean) as string[])
    const groupId = existing.size === 1 ? [...existing][0] : nanoid()
    const config = mkConfig(selected.map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height })))

    set((s) => ({
      document: {
        ...s.document,
        layers:
          existing.size === 1
            ? s.document.layers
            : s.document.layers.map((l) => (selected.some((m) => m.id === l.id) ? { ...l, groupId } : l)),
        autoLayouts: { ...(s.document.autoLayouts ?? {}), [groupId]: config },
        updatedAt: new Date().toISOString(),
      },
      selectedLayerIds: new Set(selected.map((m) => m.id)),
      activeLayerId: selected[0].id,
    }))
    get().reflowGroup(groupId)
  },

  // Drop the Auto Layout config but keep the group + children intact. Any nested
  // child groups are promoted to top-level (their parentGroupId is cleared).
  removeAutoLayout: (groupId) => {
    if (!get().document.autoLayouts?.[groupId]) return
    get().pushSnapshot()
    set((s) => {
      const next = { ...(s.document.autoLayouts ?? {}) }
      delete next[groupId]
      for (const [g, c] of Object.entries(next)) {
        if (c.parentGroupId === groupId) {
          const promoted = { ...c }
          delete promoted.parentGroupId
          next[g] = promoted
        }
      }
      return { document: { ...s.document, autoLayouts: next, updatedAt: new Date().toISOString() } }
    })
    _syncBackToFrame()
  },

  updateAutoLayoutConfig: (groupId, partial, live = false) => {
    const cfg = get().document.autoLayouts?.[groupId]
    if (!cfg) return
    // `live` skips the snapshot so a continuous canvas drag is one undo step
    // (the caller snapshots once at pointer-down).
    if (!live) get().pushSnapshot()
    const merged: AutoLayoutConfig = {
      ...cfg,
      ...partial,
      padding: { ...cfg.padding, ...(partial.padding ?? {}) },
    }
    set((s) => ({
      document: {
        ...s.document,
        autoLayouts: { ...(s.document.autoLayouts ?? {}), [groupId]: merged },
        updatedAt: new Date().toISOString(),
      },
    }))
    get().reflowGroup(groupId)
  },

  // Recompute member geometry from the config. Lays out from the container's
  // authoritative origin (config.x/y), so alignment offsets under a Fixed
  // dimension survive. Reflows from the ROOT of the group's tree so an edit to a
  // nested group propagates through the whole subtree (child boxes → parent).
  // Handles nesting via _reflowSubtree (child groups laid out as composite
  // units). Writes positions directly — no snapshot.
  reflowGroup: (groupId) => {
    if (_reflowing) return
    const al = get().document.autoLayouts
    if (!al?.[groupId]) return
    let root = groupId
    const seen = new Set<string>()
    while (al[root]?.parentGroupId && al[al[root].parentGroupId!] && !seen.has(root)) {
      seen.add(root)
      root = al[root].parentGroupId!
    }
    _reflowing = true
    _reflowSubtree(root)
    _reflowing = false
    _syncBackToFrame()
  },

  // --- Selection ---

  selectLayer: (id, additive = false) => {
    set((s) => {
      if (additive) {
        const next = new Set(s.selectedLayerIds)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return { selectedLayerIds: next, activeLayerId: id }
      }
      return { selectedLayerIds: new Set([id]), activeLayerId: id }
    })
  },

  deselectAll: () => {
    set({ selectedLayerIds: new Set(), activeLayerId: null, editingTextLayerId: null })
  },

  // --- Format ---

  setFormat: (format) => {
    get().pushSnapshot()
    set((s) => {
      // Reflow every layer from the old format into the new one (per-layer
      // constraints, safe centre/proportional default), so content stays on
      // canvas instead of stranding below the old height.
      const layers = reflowLayers(s.document.layers, s.document.format, format)
      return {
        document: { ...s.document, format, layers, updatedAt: new Date().toISOString() },
      }
    })
    _syncBackToFrame()
  },

  // --- Document ---

  setDocumentName: (name) => {
    set((s) => ({
      document: { ...s.document, name, updatedAt: new Date().toISOString() },
    }))
  },

  resetDocument: () => {
    set({
      document: createDefaultDocument(),
      selectedLayerIds: new Set(),
      activeLayerId: null,
      editingTextLayerId: null,
      history: [],
      historyIndex: -1,
      savedVersions: [],
      zoom: 1,
      panOffset: { x: 0, y: 0 },
    })
  },

  loadFromFrame: (frame) => {
    const now = new Date().toISOString()
    set({
      document: {
        id: nanoid(),
        name: frame.name,
        format: frame.format,
        layers: normalizeGroupContainers(structuredClone(frame.layers)),
        autoLayouts: frame.autoLayouts ? structuredClone(frame.autoLayouts) : undefined,
        createdAt: now,
        updatedAt: now,
      },
      selectedLayerIds: new Set(),
      activeLayerId: null,
      editingTextLayerId: null,
      history: [],
      historyIndex: -1,
    })
  },

  syncToFrame: () => {
    const { document } = get()
    return {
      layers: structuredClone(document.layers),
      format: document.format,
    }
  },

  // --- Canvas ---

  setTool: (tool) => set({ tool }),

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(4, zoom)) }),

  setPanOffset: (offset) => set({ panOffset: offset }),

  // --- Text editing ---

  setEditingTextLayerId: (id) => set({ editingTextLayerId: id }),

  // --- History ---

  pushSnapshot: () => {
    set((s) => {
      // Discard any future states if we've undone some actions
      const history = s.history.slice(0, s.historyIndex + 1)
      history.push(structuredClone(s.document))

      // Cap history
      if (history.length > MAX_HISTORY) {
        history.shift()
      }

      return { history, historyIndex: history.length - 1 }
    })
  },

  undo: () => {
    set((s) => {
      if (s.historyIndex < 0) return s

      const doc = structuredClone(s.history[s.historyIndex])
      return {
        document: doc,
        historyIndex: s.historyIndex - 1,
        selectedLayerIds: new Set(),
        activeLayerId: null,
        editingTextLayerId: null,
      }
    })
    _syncBackToFrame()
  },

  redo: () => {
    set((s) => {
      if (s.historyIndex >= s.history.length - 1) return s

      const doc = structuredClone(s.history[s.historyIndex + 1])
      return {
        document: doc,
        historyIndex: s.historyIndex + 1,
        selectedLayerIds: new Set(),
        activeLayerId: null,
        editingTextLayerId: null,
      }
    })
    _syncBackToFrame()
  },

  // --- Versions ---

  saveVersion: (name) => {
    const doc = get().document
    const version: SavedVersion = {
      id: nanoid(),
      name: name ?? `Version ${get().savedVersions.length + 1}`,
      document: structuredClone(doc),
      createdAt: new Date().toISOString(),
    }
    set((s) => ({ savedVersions: [version, ...s.savedVersions] }))
  },

  restoreVersion: (versionId) => {
    const version = get().savedVersions.find((v) => v.id === versionId)
    if (!version) return
    get().pushSnapshot()
    set({
      document: structuredClone(version.document),
      selectedLayerIds: new Set(),
      activeLayerId: null,
      editingTextLayerId: null,
    })
    _syncBackToFrame()
  },

  deleteVersion: (versionId) => {
    set((s) => ({ savedVersions: s.savedVersions.filter((v) => v.id !== versionId) }))
  },

  // --- Helpers ---

  getLayer: (id) => get().document.layers.find((l) => l.id === id),

  getSelectedLayers: () => {
    const { document, selectedLayerIds } = get()
    return document.layers.filter((l) => selectedLayerIds.has(l.id))
  },

  getMaxZIndex: () => {
    const layers = get().document.layers
    return layers.length === 0 ? -1 : Math.max(...layers.map((l) => l.zIndex))
  },
    }),
    {
      name: 'canvas-studio-design',
      version: 3,
      partialize: (state) => ({
        document: state.document,
        zoom: state.zoom,
        savedVersions: state.savedVersions,
      }),
      migrate: (persisted: any) => {
        // If document is missing or corrupt, reset to defaults
        if (!persisted?.document?.format?.width || !persisted?.document?.layers) {
          return {
            document: createDefaultDocument(),
            zoom: 1,
            savedVersions: [],
          }
        }
        // v3: convert legacy GroupLayer containers into flat groupId tags.
        persisted.document.layers = normalizeGroupContainers(persisted.document.layers)
        return persisted
      },
    },
  ),
)

// --- Convenience factory functions ---

export function createTextLayer(
  overrides: Partial<TextLayer> = {}
): Omit<TextLayer, 'id' | 'zIndex'> {
  return {
    type: 'text',
    name: 'Text',
    visible: true,
    locked: false,
    opacity: 1,
    x: 100,
    y: 100,
    width: 400,
    height: 60,
    rotation: 0,
    content: 'Your text here',
    fontSize: 32,
    fontWeight: 600,
    textAlign: 'left',
    color: getBrandColor('charcoal'),
    letterSpacing: -0.02,
    lineHeight: 1.2,
    textTransform: 'none',
    textWrap: 'pretty',
    // Auto-width by default so a new text box hugs its content (addLayer fits it
    // on insert) instead of showing a wide fixed box. Figma's click-to-place default.
    textSizing: 'auto-width',
    textRole: 'none',
    verticalAlign: 'top',
    underline: false,
    strikethrough: false,
    ...overrides,
  }
}
