/**
 * The bridge between the live editing session (the zustand stores) and the portable
 * `.tela` document.
 *
 * This is where "lossless" is actually won or lost. The rule followed here is that
 * capture copies *whole objects*, never a hand-written field list. The old
 * `useFileStore.updateFilePages` path did the opposite — it rebuilt each frame from
 * an explicit list of ten fields — which is exactly why `backgroundColor`, `locked`,
 * `visible`, and every loose element silently disappeared on save. Structural
 * copying plus a strict schema means a new field is either carried automatically or
 * fails validation loudly; it can never be dropped quietly.
 */

import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useDesignStore } from '@/store/useDesignStore'
import { useAssetStore } from '@/store/useAssetStore'
import { BRAND } from '@/brand/brand.config'
import { BRAND_PALETTE } from '@/brand/palette'
import { telaDocumentSchema, CURRENT_DOCUMENT_SCHEMA_VERSION, type TelaDocument } from './schema'
import { telaError } from './errors'

/** Only the app's own font registry may contribute fonts; see `schema.fontRecord`. */
export interface ImportedFont {
  id: string
  family: string
  weight: number
  style: 'normal' | 'italic'
  license: string
  /** `asset://<sha256>` once packed, or a `data:` URL while in session. */
  ref: string
  createdAt: string
}

let importedFonts: ImportedFont[] = []

/** Replace the session's imported-font registry (used by open, and by font import). */
export function setImportedFonts(fonts: ImportedFont[]): void {
  importedFonts = fonts.map((font) => ({ ...font }))
}

export function getImportedFonts(): ImportedFont[] {
  return importedFonts.map((font) => ({ ...font }))
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/**
 * Snapshot the whole editing session as a portable document, with payloads still
 * inline. `writeBundle` does the content-addressing.
 */
export function captureSession(): unknown {
  const workspaceState = useWorkspaceStore.getState()
  const designState = useDesignStore.getState()
  const assetState = useAssetStore.getState()
  const workspace = workspaceState.workspace

  // The active frame's layers live in the design store while it is being edited and
  // are only flushed back to the workspace on a debounced microtask. Capturing
  // without folding them in would lose every edit since the last flush.
  const activeFrameId = workspaceState.activeFrameId
  const liveDocument = designState.document

  const pages = workspace.pages.map((page) => ({
    id: page.id,
    name: page.name,
    frames: page.frames.map((frame) => {
      const base = clone(frame)
      if (activeFrameId && frame.id === activeFrameId) {
        base.layers = clone(liveDocument.layers)
        base.format = clone(liveDocument.format)
        base.width = liveDocument.format.width
        base.height = liveDocument.format.height
        base.autoLayouts = liveDocument.autoLayouts ? clone(liveDocument.autoLayouts) : undefined
      }
      if (base.autoLayouts === undefined) delete (base as { autoLayouts?: unknown }).autoLayouts
      return base
    }),
    looseElements: clone(page.looseElements ?? []),
  }))

  const activePage = pages.find((page) => page.id === workspace.activePageId) ?? pages[0]
  const activeFrameOnPage =
    activeFrameId && activePage?.frames.some((frame) => frame.id === activeFrameId) ? activeFrameId : null

  const palette: Record<string, string> = {}
  for (const [token, value] of Object.entries(BRAND_PALETTE)) palette[token] = value.hex

  const document = {
    schemaVersion: CURRENT_DOCUMENT_SCHEMA_VERSION,
    id: liveDocument.id,
    name: liveDocument.name,
    createdAt: liveDocument.createdAt,
    updatedAt: liveDocument.updatedAt,
    pages,
    activePageId: activePage?.id ?? workspace.activePageId,
    activeFrameId: activeFrameOnPage,
    settings: {
      showFrameLabels: workspace.showFrameLabels,
      snapFrames: workspace.snapFrames,
    },
    versions: clone(designState.savedVersions),
    brand: {
      productName: BRAND.productName,
      socialHandle: BRAND.socialHandle,
      displayName: BRAND.displayName,
      website: BRAND.website,
      ai: { ...BRAND.ai },
      palette,
    },
    assets: assetState.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      category: asset.category,
      // The store keeps the payload inline; packing turns it into asset://<sha>.
      ref: asset.dataUrl,
      ...(asset.width !== undefined ? { width: asset.width } : {}),
      ...(asset.height !== undefined ? { height: asset.height } : {}),
      createdAt: asset.createdAt,
    })),
    fonts: getImportedFonts(),
  }

  return document
}

/**
 * Apply an opened document to the stores, replacing the session wholesale.
 *
 * The document is validated first and applied second. A half-applied open would
 * leave the editor in a state that is neither the old design nor the new one, so
 * validation failure must happen before the first `setState`.
 */
export function applySession(input: unknown): TelaDocument {
  const parsed = telaDocumentSchema.safeParse(input)
  if (!parsed.success) {
    throw telaError(
      'document_invalid',
      'refusing to open a document that fails validation',
      parsed.error.issues.slice(0, 4).map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; '),
    )
  }
  const document = parsed.data

  const activePage = document.pages.find((page) => page.id === document.activePageId) ?? document.pages[0]
  const activeFrame = document.activeFrameId
    ? activePage.frames.find((frame) => frame.id === document.activeFrameId)
    : undefined

  useWorkspaceStore.setState({
    workspace: {
      id: document.id,
      name: document.name,
      pages: clone(document.pages) as never,
      activePageId: activePage.id,
      showFrameLabels: document.settings.showFrameLabels,
      snapFrames: document.settings.snapFrames,
    },
    activeFrameId: activeFrame?.id ?? null,
    selectedFrameIds: new Set<string>(),
  })

  useDesignStore.setState({
    document: {
      id: document.id,
      name: document.name,
      format: activeFrame ? clone(activeFrame.format) : clone(activePage.frames[0]?.format ?? document.pages[0].frames[0]?.format),
      layers: activeFrame ? (clone(activeFrame.layers) as never) : [],
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      autoLayouts: activeFrame?.autoLayouts ? (clone(activeFrame.autoLayouts) as never) : undefined,
    } as never,
    savedVersions: clone(document.versions) as never,
    // History belongs to a session, not to a file. Starting fresh avoids an undo
    // that would take the user back into the *previous* file's state.
    history: [],
    historyIndex: -1,
    selectedLayerIds: new Set<string>(),
    activeLayerId: null,
  })

  useAssetStore.setState({
    assets: document.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      dataUrl: asset.ref,
      width: asset.width,
      height: asset.height,
      category: asset.category,
      createdAt: asset.createdAt,
    })),
  })

  setImportedFonts(document.fonts.map((font) => ({ ...font })))

  return document
}
