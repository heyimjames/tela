/**
 * Semantic invariants — the rules a document must satisfy that a type checker and a
 * shape validator cannot express.
 *
 * Shape validation proves a document is *well-formed*. These checks prove it is
 * *coherent*: that ids are unique, that every reference resolves, and that opening
 * the file will not leave the editor pointing at something that does not exist. A
 * bundle that violates any of them is rejected rather than repaired, because
 * silently repairing a document is indistinguishable, from the user's side, from
 * losing part of it.
 */

import { telaError } from './errors'
import type { TelaDocument, TelaFrame, TelaLayer } from './schema'

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const value of ids) {
    if (seen.has(value)) dupes.add(value)
    seen.add(value)
  }
  return [...dupes]
}

function checkLayerSet(layers: TelaLayer[], where: string): void {
  const dupes = duplicates(layers.map((l) => l.id))
  if (dupes.length > 0) {
    throw telaError('invariant_violation', `${where} has duplicate layer ids`, dupes.join(', '))
  }

  const present = new Set(layers.map((l) => l.id))
  for (const layer of layers) {
    if (layer.type === 'group') {
      for (const childId of layer.childIds) {
        if (!present.has(childId)) {
          throw telaError(
            'invariant_violation',
            `${where}: group layer "${layer.id}" names a child that is not in the same container`,
            childId,
          )
        }
      }
    }
    if (layer.type === 'draw' && layer.pressures && layer.pressures.length !== layer.points.length) {
      throw telaError(
        'invariant_violation',
        `${where}: draw layer "${layer.id}" has ${layer.pressures.length} pressures for ${layer.points.length} points`,
      )
    }
  }
}

function checkFrame(frame: TelaFrame, where: string): void {
  checkLayerSet(frame.layers, `${where} frame "${frame.id}"`)

  if (!frame.autoLayouts) return
  const groupIds = new Set<string>()
  for (const layer of frame.layers) if (layer.groupId) groupIds.add(layer.groupId)

  const keys = Object.keys(frame.autoLayouts)
  // An outer auto-layout that wraps only other auto-layout groups has no layer of
  // its own carrying its id — its membership is expressed by the inner configs'
  // `parentGroupId`. The editor produces exactly that when auto-layout is applied to
  // a selection of existing groups, so a config named as someone's parent counts as
  // having members.
  for (const config of Object.values(frame.autoLayouts)) {
    if (config.parentGroupId !== undefined) groupIds.add(config.parentGroupId)
  }
  for (const groupId of keys) {
    if (!groupIds.has(groupId)) {
      throw telaError(
        'invariant_violation',
        `${where} frame "${frame.id}": auto-layout config for group "${groupId}" has no member layers`,
      )
    }
  }
  const known = new Set(keys)
  for (const [groupId, config] of Object.entries(frame.autoLayouts)) {
    if (config.parentGroupId !== undefined) {
      if (!known.has(config.parentGroupId)) {
        throw telaError(
          'invariant_violation',
          `${where} frame "${frame.id}": auto-layout "${groupId}" names parent "${config.parentGroupId}", which is not an auto-layout in this frame`,
        )
      }
      if (config.parentGroupId === groupId) {
        throw telaError(
          'invariant_violation',
          `${where} frame "${frame.id}": auto-layout "${groupId}" is its own parent`,
        )
      }
    }
  }

  // Walk parent links to a root; a cycle would hang the reflow engine at open time.
  for (const start of keys) {
    let cursor: string | undefined = start
    const path = new Set<string>()
    while (cursor !== undefined) {
      if (path.has(cursor)) {
        throw telaError(
          'invariant_violation',
          `${where} frame "${frame.id}": auto-layout nesting contains a cycle`,
          [...path, cursor].join(' -> '),
        )
      }
      path.add(cursor)
      cursor = frame.autoLayouts[cursor]?.parentGroupId
    }
  }
}

export function assertDocumentInvariants(document: TelaDocument): void {
  const pageDupes = duplicates(document.pages.map((p) => p.id))
  if (pageDupes.length > 0) {
    throw telaError('invariant_violation', 'document has duplicate page ids', pageDupes.join(', '))
  }

  const frameDupes = duplicates(document.pages.flatMap((p) => p.frames.map((f) => f.id)))
  if (frameDupes.length > 0) {
    throw telaError('invariant_violation', 'document has duplicate frame ids', frameDupes.join(', '))
  }

  const activePage = document.pages.find((p) => p.id === document.activePageId)
  if (!activePage) {
    throw telaError(
      'invariant_violation',
      'activePageId does not name a page in this document',
      document.activePageId,
    )
  }

  if (document.activeFrameId !== null) {
    // Scoped to the active page on purpose: the editor resolves the active frame
    // within the active page, so a frame id from another page would silently
    // resolve to nothing after open.
    const found = activePage.frames.some((f) => f.id === document.activeFrameId)
    if (!found) {
      throw telaError(
        'invariant_violation',
        'activeFrameId does not name a frame on the active page',
        document.activeFrameId,
      )
    }
  }

  for (const page of document.pages) {
    for (const frame of page.frames) checkFrame(frame, `page "${page.id}"`)
    checkLayerSet(page.looseElements, `page "${page.id}" loose elements`)
  }

  const versionDupes = duplicates(document.versions.map((v) => v.id))
  if (versionDupes.length > 0) {
    throw telaError('invariant_violation', 'document has duplicate version ids', versionDupes.join(', '))
  }
  for (const version of document.versions) {
    checkLayerSet(version.document.layers, `version "${version.id}"`)
  }

  const assetDupes = duplicates(document.assets.map((a) => a.id))
  if (assetDupes.length > 0) {
    throw telaError('invariant_violation', 'document has duplicate asset ids', assetDupes.join(', '))
  }

  const fontDupes = duplicates(document.fonts.map((f) => f.id))
  if (fontDupes.length > 0) {
    throw telaError('invariant_violation', 'document has duplicate font ids', fontDupes.join(', '))
  }
}
