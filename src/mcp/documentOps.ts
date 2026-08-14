/**
 * Pure operations on a `TelaDocument`.
 *
 * Every function here takes a document and returns a *new* document; none of
 * them touch the filesystem, the browser, or module state. That is what makes
 * the mutation path testable without a browser and what lets the session layer
 * treat a failed mutation as a no-op: if one of these throws, the caller still
 * holds the document it started with, unmodified.
 *
 * The design decision behind this whole module: **authoring happens in Node,
 * against the canonical document.** The browser is a renderer, not the source of
 * truth. The architecture contract says canonical state lives on disk and the
 * browser holds an editing session only; doing mutations here rather than
 * round-tripping each one through `window.tela.dispatch` is what makes that
 * true in practice, and it removes a whole class of failure (stale active-frame
 * copies, microtask-debounced write-back, page-scoped frame lookup) from the
 * authoring path.
 */

import { randomUUID } from 'node:crypto'

import { telaDocumentSchema, layerSchema, type TelaDocument, type TelaFrame, type TelaLayer, type TelaPage } from '../tela/schema'
import { assertDocumentInvariants } from '../tela/invariants'
import { AD_FORMATS, DEFAULT_FORMAT } from '../brand/formats'
import { toolError } from './errors'
import { buildLayer, type LayerInput } from './layerInput'

export type AdFormatRecord = TelaFrame['format']

export function nowIso(): string {
  return new Date().toISOString().replace(/(\.\d{3})\d*Z$/, '$1Z')
}

export function newId(): string {
  return randomUUID()
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Re-validate after every mutation. A mutation that produces an invalid document is a bug, and this is where it surfaces. */
export function finalize(document: TelaDocument): TelaDocument {
  const next = { ...document, updatedAt: nowIso() }
  const parsed = telaDocumentSchema.safeParse(next)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    throw toolError(
      'invalid_input',
      `the requested change would produce an invalid document (${issues})`,
      'correct the offending field and retry; call tela_validate_design to see the document\'s current state',
    )
  }
  assertDocumentInvariants(parsed.data)
  return parsed.data
}

export function formatById(id: string): AdFormatRecord {
  const found = AD_FORMATS.find((format) => format.id === id)
  if (!found) {
    throw toolError(
      'invalid_input',
      `unknown format "${id}"`,
      `use one of: ${AD_FORMATS.map((format) => format.id).join(', ')}; the tela://formats resource lists them with dimensions`,
    )
  }
  return clone(found) as AdFormatRecord
}

// --- Lookups -----------------------------------------------------------------

export function requirePage(document: TelaDocument, pageId: string): TelaPage {
  const page = document.pages.find((candidate) => candidate.id === pageId)
  if (!page) {
    throw toolError(
      'not_found',
      `no page "${pageId}" in this design`,
      `call tela_get_design_summary to list page ids (${document.pages.map((p) => p.id).slice(0, 5).join(', ')})`,
    )
  }
  return page
}

export interface FrameLocation {
  page: TelaPage
  frame: TelaFrame
}

/**
 * Find a frame by id anywhere in the document.
 *
 * Deliberately *not* scoped to an active page. The in-app store's `getFrame`
 * searches the active page only, which is a reasonable UI affordance and a trap
 * for an agent: a frame that exists would appear not to. Addressing is global
 * here so a frame id always means the same frame.
 */
export function requireFrame(document: TelaDocument, frameId: string): FrameLocation {
  for (const page of document.pages) {
    const frame = page.frames.find((candidate) => candidate.id === frameId)
    if (frame) return { page, frame }
  }
  throw toolError('not_found', `no frame "${frameId}" in this design`, 'call tela_get_design_summary to list frame ids across every page')
}

export function requireLayer(frame: TelaFrame, layerId: string): TelaLayer {
  const layer = frame.layers.find((candidate) => candidate.id === layerId)
  if (!layer) {
    throw toolError('not_found', `no layer "${layerId}" in frame "${frame.id}"`, 'call tela_get_scene for this frame to list its layer ids')
  }
  return layer
}

/** Rewrite one frame in place, returning a new document. */
function withFrame(document: TelaDocument, frameId: string, update: (frame: TelaFrame) => TelaFrame): TelaDocument {
  let seen = false
  const pages = document.pages.map((page) => ({
    ...page,
    frames: page.frames.map((frame) => {
      if (frame.id !== frameId) return frame
      seen = true
      return update(clone(frame))
    }),
  }))
  if (!seen) requireFrame(document, frameId)
  return { ...document, pages }
}

function withPage(document: TelaDocument, pageId: string, update: (page: TelaPage) => TelaPage): TelaDocument {
  requirePage(document, pageId)
  return {
    ...document,
    pages: document.pages.map((page) => (page.id === pageId ? update(clone(page)) : page)),
  }
}

/** Normalize z-indices to a dense 0..n-1 sequence in current visual order. */
function renumber(layers: TelaLayer[]): TelaLayer[] {
  return [...layers]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((layer, index) => ({ ...layer, zIndex: index }))
}

// --- Document creation -------------------------------------------------------

export interface CreateDocumentOptions {
  name: string
  formatId?: string
  pageName?: string
  frameName?: string
  /** Omit to create a page with no frames (a scratchpad). */
  withFrame?: boolean
}

export function createDocument(options: CreateDocumentOptions): TelaDocument {
  const timestamp = nowIso()
  const format = options.formatId ? formatById(options.formatId) : (clone(DEFAULT_FORMAT) as AdFormatRecord)
  const pageId = newId()
  const frames: TelaFrame[] = []
  if (options.withFrame !== false) {
    frames.push(makeFrame(options.frameName ?? 'Frame 1', format, 0, 0))
  }
  const document: TelaDocument = {
    schemaVersion: 1,
    id: newId(),
    name: options.name,
    createdAt: timestamp,
    updatedAt: timestamp,
    pages: [{ id: pageId, name: options.pageName ?? 'Page 1', frames, looseElements: [] }],
    activePageId: pageId,
    activeFrameId: frames[0]?.id ?? null,
    settings: { showFrameLabels: true, snapFrames: true },
    versions: [],
    brand: {
      productName: '',
      socialHandle: '',
      displayName: '',
      website: '',
      ai: { productDescription: '', targetAudience: '', brandVoice: '', callToAction: '' },
      palette: {},
    },
    assets: [],
    fonts: [],
  }
  return finalize(document)
}

export function makeFrame(name: string, format: AdFormatRecord, x: number, y: number): TelaFrame {
  return {
    id: newId(),
    name,
    x,
    y,
    width: format.width,
    height: format.height,
    format: clone(format),
    backgroundColor: { token: 'white', hex: '#ffffff' },
    backgroundFill: { type: 'solid', color: { token: 'white', hex: '#ffffff' } },
    layers: [],
    locked: false,
    visible: true,
  }
}

// --- Pages -------------------------------------------------------------------

export function addPage(document: TelaDocument, name: string, index?: number): { document: TelaDocument; pageId: string } {
  const page: TelaPage = { id: newId(), name, frames: [], looseElements: [] }
  const pages = [...document.pages]
  pages.splice(index === undefined ? pages.length : clampIndex(index, pages.length), 0, page)
  return { document: finalize({ ...document, pages }), pageId: page.id }
}

export function updatePage(document: TelaDocument, pageId: string, changes: { name?: string; active?: boolean }): TelaDocument {
  let next = withPage(document, pageId, (page) => ({ ...page, ...(changes.name !== undefined ? { name: changes.name } : {}) }))
  if (changes.active === true) {
    const page = requirePage(next, pageId)
    // The active frame must belong to the active page, or the document fails its
    // own invariants. Clear it rather than guess at a replacement.
    const keepFrame = page.frames.some((frame) => frame.id === next.activeFrameId)
    next = { ...next, activePageId: pageId, activeFrameId: keepFrame ? next.activeFrameId : null }
  }
  return finalize(next)
}

export function reorderPages(document: TelaDocument, order: string[]): TelaDocument {
  const current = document.pages.map((page) => page.id)
  assertSamePermutation(current, order, 'page')
  const byId = new Map(document.pages.map((page) => [page.id, page]))
  return finalize({ ...document, pages: order.map((id) => byId.get(id)!) })
}

/**
 * Archive a page: remove it from the document and return it, so the caller can
 * park it in the managed trash. Deletion is never permanent at this layer.
 */
export function archivePage(document: TelaDocument, pageId: string): { document: TelaDocument; archived: TelaPage } {
  const page = requirePage(document, pageId)
  if (document.pages.length === 1) {
    throw toolError(
      'policy_refused',
      'a design must keep at least one page',
      'add a replacement page with tela_add_page before archiving this one, or archive the whole design with tela_archive_design',
    )
  }
  const pages = document.pages.filter((candidate) => candidate.id !== pageId)
  const activePageId = document.activePageId === pageId ? pages[0].id : document.activePageId
  const activeFrameStillThere = pages
    .find((candidate) => candidate.id === activePageId)!
    .frames.some((frame) => frame.id === document.activeFrameId)
  return {
    document: finalize({ ...document, pages, activePageId, activeFrameId: activeFrameStillThere ? document.activeFrameId : null }),
    archived: clone(page),
  }
}

// --- Frames ------------------------------------------------------------------

export function addFrame(
  document: TelaDocument,
  pageId: string,
  options: { name?: string; formatId?: string; x?: number; y?: number },
): { document: TelaDocument; frameId: string } {
  const page = requirePage(document, pageId)
  const format = options.formatId ? formatById(options.formatId) : (clone(DEFAULT_FORMAT) as AdFormatRecord)
  // Place to the right of the rightmost frame, matching what the editor does,
  // so a document authored here and one authored by hand look the same.
  const rightEdge = page.frames.reduce((max, frame) => Math.max(max, frame.x + frame.width), 0)
  const x = options.x ?? (page.frames.length === 0 ? 0 : rightEdge + 80)
  const y = options.y ?? 0
  const frame = makeFrame(options.name ?? `Frame ${page.frames.length + 1}`, format, x, y)
  const next = withPage(document, pageId, (target) => ({ ...target, frames: [...target.frames, frame] }))
  return { document: finalize(next), frameId: frame.id }
}

export interface FrameChanges {
  name?: string
  x?: number
  y?: number
  locked?: boolean
  visible?: boolean
  formatId?: string
  backgroundColor?: { hex: string; token: string }
  backgroundFill?: TelaFrame['backgroundFill']
  active?: boolean
}

export function updateFrame(document: TelaDocument, frameId: string, changes: FrameChanges): TelaDocument {
  let next = withFrame(document, frameId, (frame) => {
    const updated: TelaFrame = { ...frame }
    if (changes.name !== undefined) updated.name = changes.name
    if (changes.x !== undefined) updated.x = changes.x
    if (changes.y !== undefined) updated.y = changes.y
    if (changes.locked !== undefined) updated.locked = changes.locked
    if (changes.visible !== undefined) updated.visible = changes.visible
    if (changes.backgroundColor !== undefined) updated.backgroundColor = changes.backgroundColor
    if (changes.backgroundFill !== undefined) updated.backgroundFill = clone(changes.backgroundFill)
    if (changes.formatId !== undefined) {
      const format = formatById(changes.formatId)
      updated.layers = reflowLayers(updated.layers, updated.width, updated.height, format.width, format.height)
      updated.format = format
      updated.width = format.width
      updated.height = format.height
    }
    return updated
  })
  if (changes.active === true) {
    const { page } = requireFrame(next, frameId)
    next = { ...next, activePageId: page.id, activeFrameId: frameId }
  }
  return finalize(next)
}

export function duplicateFrame(document: TelaDocument, frameId: string, name?: string): { document: TelaDocument; frameId: string } {
  const { page, frame } = requireFrame(document, frameId)
  const copy = remapFrameIds(clone(frame))
  copy.name = name ?? `${frame.name} copy`
  copy.x = frame.x + frame.width + 80
  const next = withPage(document, page.id, (target) => {
    const at = target.frames.findIndex((candidate) => candidate.id === frameId)
    const frames = [...target.frames]
    frames.splice(at + 1, 0, copy)
    return { ...target, frames }
  })
  return { document: finalize(next), frameId: copy.id }
}

/** Fresh ids for the frame and every layer, with `groupId`/`childIds` rewritten to match. */
function remapFrameIds(frame: TelaFrame): TelaFrame {
  const map = new Map<string, string>()
  for (const layer of frame.layers) map.set(layer.id, newId())
  const layers = frame.layers.map((layer) => {
    const next: TelaLayer = { ...layer, id: map.get(layer.id)! }
    if (next.groupId) next.groupId = map.get(next.groupId) ?? next.groupId
    if (next.type === 'group') next.childIds = next.childIds.map((child) => map.get(child) ?? child)
    return next
  })
  const autoLayouts = frame.autoLayouts
    ? Object.fromEntries(
        Object.entries(frame.autoLayouts).map(([groupId, config]) => [
          map.get(groupId) ?? groupId,
          config.parentGroupId ? { ...config, parentGroupId: map.get(config.parentGroupId) ?? config.parentGroupId } : config,
        ]),
      )
    : undefined
  return { ...frame, id: newId(), layers, ...(autoLayouts ? { autoLayouts } : {}) }
}

export function reorderFrames(document: TelaDocument, pageId: string, order: string[]): TelaDocument {
  const page = requirePage(document, pageId)
  assertSamePermutation(
    page.frames.map((frame) => frame.id),
    order,
    'frame',
  )
  const byId = new Map(page.frames.map((frame) => [frame.id, frame]))
  return finalize(withPage(document, pageId, (target) => ({ ...target, frames: order.map((id) => byId.get(id)!) })))
}

export function archiveFrame(document: TelaDocument, frameId: string): { document: TelaDocument; archived: TelaFrame } {
  const { page, frame } = requireFrame(document, frameId)
  const next = withPage(document, page.id, (target) => ({ ...target, frames: target.frames.filter((candidate) => candidate.id !== frameId) }))
  return {
    document: finalize({ ...next, activeFrameId: next.activeFrameId === frameId ? null : next.activeFrameId }),
    archived: clone(frame),
  }
}

/**
 * Uniform-scale a frame's layers about their centres for a new size.
 *
 * This mirrors the editor's own variant generation rather than the constraint
 * reflow: a format variant is a *rescaled composition*, and scaling font size
 * with the geometry is what keeps it looking like the same design.
 */
function scaleLayers(layers: TelaLayer[], factorX: number, factorY: number): TelaLayer[] {
  const factor = Math.min(factorX, factorY)
  return layers.map((layer) => {
    const centreX = (layer.x + layer.width / 2) * factorX
    const centreY = (layer.y + layer.height / 2) * factorY
    const width = layer.width * factor
    const height = layer.height * factor
    const next: TelaLayer = {
      ...layer,
      x: centreX - width / 2,
      y: centreY - height / 2,
      width,
      height,
    }
    if (next.type === 'text') next.fontSize = next.fontSize * factor
    if (next.type === 'background') {
      // A background is the frame, not an element inside it: it must fill.
      next.x = 0
      next.y = 0
      next.width = layer.width * factorX
      next.height = layer.height * factorY
    }
    return next
  })
}

/** Constraint-aware reflow, used when a frame's own format changes in place. */
function reflowLayers(layers: TelaLayer[], fromWidth: number, fromHeight: number, toWidth: number, toHeight: number): TelaLayer[] {
  const scaleX = toWidth / fromWidth
  const scaleY = toHeight / fromHeight
  return layers.map((layer) => {
    if (layer.type === 'background') {
      return { ...layer, x: 0, y: 0, width: toWidth, height: toHeight }
    }
    const constraints = layer.constraints
    if (!constraints) return { ...layer, x: layer.x * scaleX, y: layer.y * scaleY }

    const uniform = Math.min(scaleX, scaleY)
    let width = layer.width
    let height = layer.height
    if (constraints.scale === 'proportional') {
      width = layer.width * uniform
      height = layer.height * uniform
    } else if (constraints.scale === 'stretch') {
      width = layer.width * scaleX
      height = layer.height * scaleY
    }

    let x: number
    switch (constraints.horizontal) {
      case 'left':
        x = layer.x
        break
      case 'right':
        x = toWidth - (fromWidth - layer.x - layer.width) - width
        break
      case 'stretch':
        x = layer.x * scaleX
        width = layer.width * scaleX
        break
      default:
        x = (layer.x + layer.width / 2) * scaleX - width / 2
    }

    let y: number
    switch (constraints.vertical) {
      case 'top':
        y = layer.y
        break
      case 'bottom':
        y = toHeight - (fromHeight - layer.y - layer.height) - height
        break
      case 'stretch':
        y = layer.y * scaleY
        height = layer.height * scaleY
        break
      default:
        y = (layer.y + layer.height / 2) * scaleY - height / 2
    }

    const next: TelaLayer = { ...layer, x, y, width, height }
    if (next.type === 'text' && constraints.scale === 'proportional') next.fontSize = next.fontSize * uniform
    return next
  })
}

export function generateFormatVariants(
  document: TelaDocument,
  frameId: string,
  formatIds: string[],
): { document: TelaDocument; created: Array<{ frameId: string; formatId: string }> } {
  const { page, frame } = requireFrame(document, frameId)
  const targets = formatIds.length > 0 ? formatIds.map(formatById) : AD_FORMATS.filter((format) => format.id !== frame.format.id).map((format) => formatById(format.id))
  if (targets.length === 0) {
    throw toolError('invalid_input', 'no target formats to generate', 'pass at least one format id, or omit format_ids to generate every format other than the source frame\'s')
  }

  const created: Array<{ frameId: string; formatId: string }> = []
  let cursorX = page.frames.reduce((max, candidate) => Math.max(max, candidate.x + candidate.width), 0)
  const variants: TelaFrame[] = []
  for (const format of targets) {
    const variant = remapFrameIds(clone(frame))
    variant.name = `${frame.name} — ${format.label}`
    variant.format = format
    variant.width = format.width
    variant.height = format.height
    variant.x = cursorX + 80
    variant.y = frame.y
    variant.layers = renumber(scaleLayers(variant.layers, format.width / frame.width, format.height / frame.height))
    cursorX = variant.x + variant.width
    variants.push(variant)
    created.push({ frameId: variant.id, formatId: format.id })
  }

  const next = withPage(document, page.id, (target) => ({ ...target, frames: [...target.frames, ...variants] }))
  return { document: finalize(next), created }
}

// --- Layers ------------------------------------------------------------------

export function addLayers(document: TelaDocument, frameId: string, inputs: LayerInput[]): { document: TelaDocument; layerIds: string[] } {
  const layerIds: string[] = []
  const next = withFrame(document, frameId, (frame) => {
    let top = frame.layers.reduce((max, layer) => Math.max(max, layer.zIndex), -1)
    const added = inputs.map((input) => {
      const id = input.id ?? newId()
      if (frame.layers.some((layer) => layer.id === id) || layerIds.includes(id)) {
        throw toolError('conflict', `layer id "${id}" already exists in frame "${frameId}"`, 'omit `id` to have a unique one generated, or pass an id that is not already in the frame')
      }
      layerIds.push(id)
      top += 1
      return buildLayer(input, id, input.zIndex ?? top)
    })
    return { ...frame, layers: renumber([...frame.layers, ...added]) }
  })
  return { document: finalize(next), layerIds }
}

/**
 * Merge a patch onto a layer and re-validate against the strict persisted union.
 *
 * `type` is refused: changing it would keep the old variant's fields, which the
 * strict schema would then reject with a confusing message about an unknown key.
 * Refusing up front produces an error the caller can act on.
 */
export function applyLayerPatch(layer: TelaLayer, patch: Record<string, unknown>): TelaLayer {
  if ('type' in patch && patch.type !== layer.type) {
    throw toolError(
      'invalid_input',
      `a layer's type cannot be changed (layer "${layer.id}" is "${layer.type}")`,
      'archive the layer with tela_archive_layers and add a replacement of the desired type with tela_add_layers',
    )
  }
  if ('id' in patch && patch.id !== layer.id) {
    throw toolError('invalid_input', `a layer's id cannot be changed`, 'omit "id" from the patch; use tela_duplicate_layers to make a copy with a new id')
  }
  const merged: Record<string, unknown> = { ...layer }
  for (const [key, value] of Object.entries(patch)) {
    // `null` is the explicit "unset this optional field" signal. Assigning
    // `undefined` would leave the key present-but-undefined, which the strict
    // schema treats differently from absent.
    if (value === null) delete merged[key]
    else merged[key] = value
  }
  const parsed = layerSchema.safeParse(merged)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`).join('; ')
    throw toolError('invalid_input', `the patch would make layer "${layer.id}" invalid (${issues})`, 'correct the named fields and retry; call tela_get_scene to see the layer\'s current values')
  }
  return parsed.data
}

export function updateLayers(
  document: TelaDocument,
  frameId: string,
  updates: Array<{ layer_id: string; patch: Record<string, unknown> }>,
): TelaDocument {
  return finalize(
    withFrame(document, frameId, (frame) => {
      let layers = frame.layers
      for (const update of updates) {
        const existing = requireLayer({ ...frame, layers }, update.layer_id)
        const patched = applyLayerPatch(existing, update.patch)
        layers = layers.map((layer) => (layer.id === update.layer_id ? patched : layer))
      }
      return { ...frame, layers }
    }),
  )
}

export function duplicateLayers(document: TelaDocument, frameId: string, layerIds: string[], offset: { x: number; y: number }): { document: TelaDocument; layerIds: string[] } {
  const created: string[] = []
  const next = withFrame(document, frameId, (frame) => {
    const map = new Map<string, string>()
    const sources = layerIds.map((id) => requireLayer(frame, id))
    for (const source of sources) map.set(source.id, newId())
    let top = frame.layers.reduce((max, layer) => Math.max(max, layer.zIndex), -1)
    const copies = sources.map((source) => {
      top += 1
      const copy: TelaLayer = { ...clone(source), id: map.get(source.id)!, x: source.x + offset.x, y: source.y + offset.y, zIndex: top }
      // Only rewrite a relationship when the *other end* was copied too. A copy
      // that keeps pointing at the original's group is correct when the group
      // was not part of the selection.
      if (copy.groupId && map.has(copy.groupId)) copy.groupId = map.get(copy.groupId)!
      if (copy.type === 'group') copy.childIds = copy.childIds.map((child) => map.get(child) ?? child)
      created.push(copy.id)
      return copy
    })
    return { ...frame, layers: renumber([...frame.layers, ...copies]) }
  })
  return { document: finalize(next), layerIds: created }
}

export function reorderLayers(document: TelaDocument, frameId: string, order: string[]): TelaDocument {
  return finalize(
    withFrame(document, frameId, (frame) => {
      assertSamePermutation(
        frame.layers.map((layer) => layer.id),
        order,
        'layer',
      )
      const byId = new Map(frame.layers.map((layer) => [layer.id, layer]))
      return { ...frame, layers: order.map((id, index) => ({ ...byId.get(id)!, zIndex: index })) }
    }),
  )
}

export function archiveLayers(document: TelaDocument, frameId: string, layerIds: string[]): { document: TelaDocument; archived: TelaLayer[] } {
  const archived: TelaLayer[] = []
  const next = withFrame(document, frameId, (frame) => {
    const removing = new Set(layerIds)
    for (const id of layerIds) archived.push(clone(requireLayer(frame, id)))
    const layers = frame.layers
      .filter((layer) => !removing.has(layer.id))
      .map((layer) => {
        const updated: TelaLayer = { ...layer }
        // A dangling `groupId` or `childIds` entry fails the document's own
        // invariants, so references to archived layers are cleaned up here
        // rather than left for the validator to reject.
        if (updated.groupId && removing.has(updated.groupId)) delete updated.groupId
        if (updated.type === 'group') updated.childIds = updated.childIds.filter((child) => !removing.has(child))
        return updated
      })
    const autoLayouts = frame.autoLayouts
      ? Object.fromEntries(Object.entries(frame.autoLayouts).filter(([groupId]) => !removing.has(groupId)))
      : undefined
    const result: TelaFrame = { ...frame, layers: renumber(layers) }
    if (autoLayouts && Object.keys(autoLayouts).length > 0) result.autoLayouts = autoLayouts
    else delete result.autoLayouts
    return result
  })
  return { document: finalize(next), archived }
}

export function groupLayers(document: TelaDocument, frameId: string, layerIds: string[], name?: string): { document: TelaDocument; groupId: string } {
  if (layerIds.length < 2) {
    throw toolError('invalid_input', 'a group needs at least two layers', 'pass two or more layer ids in layer_ids')
  }
  const groupId = newId()
  const next = withFrame(document, frameId, (frame) => {
    const members = layerIds.map((id) => requireLayer(frame, id))
    const minX = Math.min(...members.map((layer) => layer.x))
    const minY = Math.min(...members.map((layer) => layer.y))
    const maxX = Math.max(...members.map((layer) => layer.x + layer.width))
    const maxY = Math.max(...members.map((layer) => layer.y + layer.height))
    const top = frame.layers.reduce((max, layer) => Math.max(max, layer.zIndex), -1)
    const group: TelaLayer = {
      id: groupId,
      type: 'group',
      name: name ?? 'Group',
      visible: true,
      locked: false,
      opacity: 1,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      rotation: 0,
      zIndex: top + 1,
      childIds: [...layerIds],
    }
    const membership = new Set(layerIds)
    const layers = frame.layers.map((layer) => (membership.has(layer.id) ? { ...layer, groupId } : layer))
    return { ...frame, layers: renumber([...layers, group]) }
  })
  return { document: finalize(next), groupId }
}

export function ungroupLayers(document: TelaDocument, frameId: string, groupId: string): { document: TelaDocument; layerIds: string[] } {
  let released: string[] = []
  const next = withFrame(document, frameId, (frame) => {
    const group = requireLayer(frame, groupId)
    if (group.type !== 'group') {
      throw toolError('invalid_input', `layer "${groupId}" is a ${group.type} layer, not a group`, 'pass the id of a group layer; tela_get_scene reports each layer\'s type')
    }
    released = [...group.childIds]
    const layers = frame.layers
      .filter((layer) => layer.id !== groupId)
      .map((layer) => {
        if (layer.groupId !== groupId) return layer
        const updated: TelaLayer = { ...layer }
        delete updated.groupId
        return updated
      })
    const result: TelaFrame = { ...frame, layers: renumber(layers) }
    if (result.autoLayouts) {
      const autoLayouts = Object.fromEntries(Object.entries(result.autoLayouts).filter(([id]) => id !== groupId))
      if (Object.keys(autoLayouts).length > 0) result.autoLayouts = autoLayouts
      else delete result.autoLayouts
    }
    return result
  })
  return { document: finalize(next), layerIds: released }
}

export type AutoLayoutConfigInput = {
  direction?: 'horizontal' | 'vertical'
  gap?: number
  padding?: { top: number; right: number; bottom: number; left: number }
  primaryAlign?: 'start' | 'center' | 'end' | 'space-between'
  counterAlign?: 'start' | 'center' | 'end' | 'stretch'
  widthMode?: 'fixed' | 'hug'
  heightMode?: 'fixed' | 'hug'
}

/**
 * Attach (or detach) an auto-layout to a group and reflow its children.
 *
 * The reflow runs here rather than being deferred to the renderer because the
 * persisted document has to be self-consistent: a saved file whose layer
 * positions only become correct once a browser opens it is not a portable
 * source.
 */
export function setAutoLayout(document: TelaDocument, frameId: string, groupId: string, config: AutoLayoutConfigInput | null): TelaDocument {
  return finalize(
    withFrame(document, frameId, (frame) => {
      const group = requireLayer(frame, groupId)
      if (group.type !== 'group') {
        throw toolError('invalid_input', `layer "${groupId}" is a ${group.type} layer, not a group`, 'auto-layout applies to group layers; group the layers first with tela_group_layers')
      }
      const result: TelaFrame = { ...frame }
      if (config === null) {
        if (result.autoLayouts) {
          const remaining = Object.fromEntries(Object.entries(result.autoLayouts).filter(([id]) => id !== groupId))
          if (Object.keys(remaining).length > 0) result.autoLayouts = remaining
          else delete result.autoLayouts
        }
        return result
      }
      const existing = result.autoLayouts?.[groupId]
      const resolved = {
        direction: config.direction ?? existing?.direction ?? 'vertical',
        gap: config.gap ?? existing?.gap ?? 16,
        padding: config.padding ?? existing?.padding ?? { top: 0, right: 0, bottom: 0, left: 0 },
        primaryAlign: config.primaryAlign ?? existing?.primaryAlign ?? 'start',
        counterAlign: config.counterAlign ?? existing?.counterAlign ?? 'start',
        widthMode: config.widthMode ?? existing?.widthMode ?? 'hug',
        heightMode: config.heightMode ?? existing?.heightMode ?? 'hug',
        x: existing?.x ?? group.x,
        y: existing?.y ?? group.y,
        width: existing?.width ?? group.width,
        height: existing?.height ?? group.height,
        ...(existing?.parentGroupId ? { parentGroupId: existing.parentGroupId } : {}),
      }
      const laid = layOutGroup(result.layers, group, resolved)
      result.layers = laid.layers
      result.autoLayouts = { ...(result.autoLayouts ?? {}), [groupId]: { ...resolved, width: laid.width, height: laid.height } }
      return result
    }),
  )
}

interface ResolvedAutoLayout {
  direction: 'horizontal' | 'vertical'
  gap: number
  padding: { top: number; right: number; bottom: number; left: number }
  primaryAlign: 'start' | 'center' | 'end' | 'space-between'
  counterAlign: 'start' | 'center' | 'end' | 'stretch'
  widthMode: 'fixed' | 'hug'
  heightMode: 'fixed' | 'hug'
  x: number
  y: number
  width: number
  height: number
}

function layOutGroup(layers: TelaLayer[], group: Extract<TelaLayer, { type: 'group' }>, config: ResolvedAutoLayout): { layers: TelaLayer[]; width: number; height: number } {
  const children = group.childIds.map((id) => layers.find((layer) => layer.id === id)).filter((layer): layer is TelaLayer => Boolean(layer))
  const horizontal = config.direction === 'horizontal'
  const total = children.reduce((sum, child) => sum + (horizontal ? child.width : child.height), 0)
  const gaps = Math.max(0, children.length - 1) * config.gap
  const contentMain = total + gaps
  const contentCross = children.reduce((max, child) => Math.max(max, horizontal ? child.height : child.width), 0)

  const width = config.widthMode === 'hug' ? (horizontal ? contentMain : contentCross) + config.padding.left + config.padding.right : config.width
  const height = config.heightMode === 'hug' ? (horizontal ? contentCross : contentMain) + config.padding.top + config.padding.bottom : config.height

  const innerMain = (horizontal ? width - config.padding.left - config.padding.right : height - config.padding.top - config.padding.bottom)
  const innerCross = (horizontal ? height - config.padding.top - config.padding.bottom : width - config.padding.left - config.padding.right)

  let cursor = horizontal ? config.x + config.padding.left : config.y + config.padding.top
  let spacing = config.gap
  if (config.primaryAlign === 'center') cursor += (innerMain - contentMain) / 2
  else if (config.primaryAlign === 'end') cursor += innerMain - contentMain
  else if (config.primaryAlign === 'space-between' && children.length > 1) spacing = (innerMain - total) / (children.length - 1)

  const positioned = new Map<string, TelaLayer>()
  for (const child of children) {
    const next: TelaLayer = { ...child }
    const crossBase = horizontal ? config.y + config.padding.top : config.x + config.padding.left
    const childCross = horizontal ? child.height : child.width
    let cross = crossBase
    if (config.counterAlign === 'center') cross += (innerCross - childCross) / 2
    else if (config.counterAlign === 'end') cross += innerCross - childCross
    else if (config.counterAlign === 'stretch') {
      if (horizontal) next.height = innerCross
      else next.width = innerCross
    }

    if (horizontal) {
      next.x = cursor
      next.y = cross
      cursor += child.width + spacing
    } else {
      next.y = cursor
      next.x = cross
      cursor += child.height + spacing
    }
    positioned.set(next.id, next)
  }

  const updated = layers.map((layer) => {
    if (layer.id === group.id) return { ...layer, x: config.x, y: config.y, width, height }
    return positioned.get(layer.id) ?? layer
  })
  return { layers: updated, width, height }
}

// --- Versions ----------------------------------------------------------------

export function saveVersion(document: TelaDocument, frameId: string, name: string): { document: TelaDocument; versionId: string } {
  const { frame } = requireFrame(document, frameId)
  const versionId = newId()
  const timestamp = nowIso()
  const version = {
    id: versionId,
    name,
    createdAt: timestamp,
    document: {
      id: frame.id,
      name: frame.name,
      format: clone(frame.format),
      layers: clone(frame.layers),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(frame.autoLayouts ? { autoLayouts: clone(frame.autoLayouts) } : {}),
    },
  }
  return { document: finalize({ ...document, versions: [...document.versions, version] }), versionId }
}

export function restoreVersion(document: TelaDocument, versionId: string, frameId?: string): { document: TelaDocument; frameId: string } {
  const version = document.versions.find((candidate) => candidate.id === versionId)
  if (!version) {
    throw toolError('not_found', `no saved version "${versionId}"`, 'call tela_list_versions to see the ids this design holds')
  }
  // The version's own `document.id` is the frame it was captured from. Falling
  // back to it means "restore where it came from" without the caller having to
  // remember, while an explicit `frameId` allows restoring onto a different frame.
  const target = frameId ?? version.document.id
  const next = withFrame(document, target, (frame) => ({
    ...frame,
    format: clone(version.document.format),
    width: version.document.format.width,
    height: version.document.format.height,
    layers: renumber(clone(version.document.layers) as TelaLayer[]),
    ...(version.document.autoLayouts ? { autoLayouts: clone(version.document.autoLayouts) } : {}),
  }))
  return { document: finalize(next), frameId: target }
}

// --- Helpers -----------------------------------------------------------------

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length))
}

/**
 * Reordering takes a full permutation rather than a move-one-item operation.
 *
 * That is a deliberate interface choice: a full order is idempotent and
 * verifiable, and it cannot silently drop an item the caller forgot about —
 * which a `{ id, newIndex }` form does whenever two callers race.
 */
function assertSamePermutation(current: string[], proposed: string[], noun: string): void {
  const currentSet = new Set(current)
  const proposedSet = new Set(proposed)
  if (proposed.length !== proposedSet.size) {
    throw toolError('invalid_input', `the ${noun} order repeats an id`, `pass each ${noun} id exactly once`)
  }
  const missing = current.filter((id) => !proposedSet.has(id))
  const unknown = proposed.filter((id) => !currentSet.has(id))
  if (missing.length > 0 || unknown.length > 0) {
    throw toolError(
      'invalid_input',
      `the ${noun} order must list every existing ${noun} exactly once` +
        (missing.length > 0 ? `; missing: ${missing.slice(0, 5).join(', ')}` : '') +
        (unknown.length > 0 ? `; unknown: ${unknown.slice(0, 5).join(', ')}` : ''),
      `read the current order first and pass the complete list of ${noun} ids in the order you want`,
    )
  }
}
