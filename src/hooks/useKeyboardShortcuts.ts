import { useEffect, useRef } from 'react'
import { nanoid } from 'nanoid'
import { useDesignStore, createTextLayer } from '@/store/useDesignStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { getBrandColor } from '@/brand/palette'
import type { Layer, ShapeLayer } from '@/types/design'

// Clipboard for copy/paste (in-memory, same session)
let clipboard: Layer[] = []
// Separate clipboard for a copied frame (id), pasted as a whole new frame.
let frameClipboard: string | null = null
// Style-only clipboard (⌘⌥C / ⌘⌥V) — visual props, no geometry or content.
let styleClipboard: Record<string, unknown> | null = null

// Which fields count as "style" per layer type. Deliberately excludes geometry
// (x/y/w/h/rotation), identity, and content so pasting style never moves or
// retypes a layer. `common` applies to every layer type.
const STYLE_KEYS: Record<string, readonly string[]> = {
  common: ['opacity', 'shadow', 'blur', 'flipH', 'flipV'],
  shape: ['fill', 'stroke', 'borderRadius'],
  text: ['color', 'fontSize', 'fontWeight', 'textAlign', 'letterSpacing', 'lineHeight', 'textTransform', 'underline', 'strikethrough', 'verticalAlign'],
  image: ['fit', 'borderRadius'],
  svg: ['tintColor', 'colorOverrides', 'strokeWidth'],
  gradient: ['gradientType', 'angle', 'stops', 'grain', 'borderRadius'],
}

function pickStyle(layer: Layer): Record<string, unknown> {
  const keys = [...STYLE_KEYS.common, ...(STYLE_KEYS[layer.type] ?? [])]
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    const v = (layer as unknown as Record<string, unknown>)[k]
    if (v !== undefined) out[k] = structuredClone(v)
  }
  return out
}

// Only the style keys valid for the target's own type (so a text colour never
// lands on a shape, etc.); `common` keys always apply.
function styleFor(target: Layer, style: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set([...STYLE_KEYS.common, ...(STYLE_KEYS[target.type] ?? [])])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(style)) if (allowed.has(k)) out[k] = structuredClone(v)
  return out
}

// Build layer specs (sans id/zIndex) for pasting or duplicating a set of source
// layers. Copies are offset +20/+20 and get FRESH group ids so they never merge
// back into the source's group: a multi-layer set that shared a groupId becomes
// its own new group; a single copy is left ungrouped.
function buildCopies(
  sources: Layer[],
  nameSuffix = '',
): Array<Record<string, unknown>> {
  const single = sources.length === 1
  const groupIdMap = new Map<string, string>()
  return sources.map((layer) => {
    const { id: _id, zIndex: _z, groupId: srcGroupId, ...rest } = layer
    let groupId: string | undefined
    if (!single && srcGroupId) {
      groupId = groupIdMap.get(srcGroupId)
      if (!groupId) {
        groupId = nanoid()
        groupIdMap.set(srcGroupId, groupId)
      }
    }
    return {
      ...rest,
      x: rest.x + 20,
      y: rest.y + 20,
      name: `${rest.name}${nameSuffix}`,
      groupId,
    }
  })
}

export function useKeyboardShortcuts() {
  const spaceHeld = useRef(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const state = useDesignStore.getState()

      // Don't handle any canvas shortcut while typing into a field or editing a
      // text layer — this must come before the spacebar handler, otherwise space
      // gets swallowed and can't be typed into inputs like the document name.
      const target = e.target as HTMLElement
      if (
        state.editingTextLayerId ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      // Spacebar hold for pan mode
      if (e.key === ' ' && !e.repeat) {
        spaceHeld.current = true
        useDesignStore.getState().setTool('pan')
        e.preventDefault()
        return
      }

      const isMeta = e.metaKey || e.ctrlKey

      // Zoom — routed to PreviewPanel via a CustomEvent so the viewport math
      // (container size, pan) stays where the container ref lives. ⌘±/0 zoom
      // in/out/100%; ⇧1 fit; ⇧2 zoom to selection (Digit codes so Shift's
      // shifted glyph doesn't matter).
      const emitZoom = (action: string) => window.dispatchEvent(new CustomEvent('canvas-zoom', { detail: { action } }))
      if (isMeta && (e.key === '=' || e.key === '+')) { e.preventDefault(); emitZoom('in'); return }
      if (isMeta && e.key === '-') { e.preventDefault(); emitZoom('out'); return }
      if (isMeta && e.key === '0') { e.preventDefault(); emitZoom('reset'); return }
      if (e.shiftKey && !isMeta && e.code === 'Digit1') { e.preventDefault(); emitZoom('fit'); return }
      if (e.shiftKey && !isMeta && e.code === 'Digit2') { e.preventDefault(); emitZoom('selection'); return }

      // Delete / Backspace — layers take priority; fall back to selected frames.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const deletableLayers = [...state.selectedLayerIds]
          .map((id) => state.getLayer(id))
          .filter((l): l is Layer => !!l && l.type !== 'background')

        if (deletableLayers.length > 0) {
          // Single snapshot for the whole delete, so one undo restores them all.
          state.removeLayers(deletableLayers.map((l) => l.id))
          e.preventDefault()
          return
        }

        // No layer selected — delete any selected frames on the active page.
        const ws = useWorkspaceStore.getState()
        const selectedFrames = [...ws.selectedFrameIds]
        if (selectedFrames.length > 0) {
          for (const id of selectedFrames) ws.removeFrame(id)
          e.preventDefault()
        }
        return
      }

      // Cmd+Z — undo
      if (isMeta && e.key === 'z' && !e.shiftKey) {
        state.undo()
        e.preventDefault()
        return
      }

      // Cmd+Shift+Z — redo
      if (isMeta && e.key === 'z' && e.shiftKey) {
        state.redo()
        e.preventDefault()
        return
      }

      // Cmd+Opt+C — copy style from the active layer. (Uses e.code because
      // Option rewrites the character on macOS, e.g. Option+C → "ç".)
      if (isMeta && e.altKey && e.code === 'KeyC') {
        const src = state.activeLayerId ? state.getLayer(state.activeLayerId) : null
        if (src && src.type !== 'background') styleClipboard = pickStyle(src)
        e.preventDefault()
        return
      }

      // Cmd+Opt+V — paste style onto every selected layer.
      if (isMeta && e.altKey && e.code === 'KeyV') {
        if (styleClipboard) {
          const targets = state.getSelectedLayers().filter((l) => l.type !== 'background')
          if (targets.length) {
            state.pushSnapshot()
            for (const t of targets) state.updateLayer(t.id, styleFor(t, styleClipboard) as Partial<Layer>)
          }
        }
        e.preventDefault()
        return
      }

      // Cmd+C — copy (layers if any selected, else the selected frame)
      if (isMeta && e.key === 'c') {
        const selected = state.getSelectedLayers().filter((l) => l.type !== 'background')
        if (selected.length > 0) {
          clipboard = structuredClone(selected)
          frameClipboard = null
        } else {
          const ws = useWorkspaceStore.getState()
          const fid = [...ws.selectedFrameIds][0] ?? ws.activeFrameId
          if (fid) { frameClipboard = fid; clipboard = [] }
        }
        e.preventDefault()
        return
      }

      // Cmd+X — cut
      if (isMeta && e.key === 'x') {
        const selected = state.getSelectedLayers().filter((l) => l.type !== 'background')
        if (selected.length > 0) {
          clipboard = structuredClone(selected)
          // Single snapshot for the whole cut.
          state.removeLayers(selected.map((l) => l.id))
        }
        e.preventDefault()
        return
      }

      // Cmd+V — paste
      if (isMeta && e.key === 'v') {
        if (clipboard.length > 0) {
          // One snapshot; copies get fresh group ids and end up selected.
          state.addLayers(buildCopies(clipboard))
        } else if (frameClipboard) {
          // No layer clipboard — paste the copied frame as a new frame.
          useWorkspaceStore.getState().duplicateFrame(frameClipboard)
        }
        e.preventDefault()
        return
      }

      // Cmd+D — duplicate
      if (isMeta && e.key === 'd') {
        const selected = state.getSelectedLayers().filter((l) => l.type !== 'background')
        if (selected.length > 0) {
          // One snapshot; copies get fresh group ids and end up selected.
          state.addLayers(buildCopies(selected, ' copy'))
        } else {
          // No layers selected — duplicate the selected/active frame instead.
          const ws = useWorkspaceStore.getState()
          const fid = [...ws.selectedFrameIds][0] ?? ws.activeFrameId
          if (fid) ws.duplicateFrame(fid)
        }
        e.preventDefault()
        return
      }

      // Cmd+A — select all
      if (isMeta && e.key === 'a') {
        const nonBg = state.document.layers.filter((l) => l.type !== 'background')
        useDesignStore.setState({
          selectedLayerIds: new Set(nonBg.map((l) => l.id)),
          activeLayerId: nonBg[nonBg.length - 1]?.id ?? null,
        })
        e.preventDefault()
        return
      }

      // Cmd+G — group selected layers
      if (isMeta && e.key === 'g' && !e.shiftKey) {
        state.groupSelectedLayers()
        e.preventDefault()
        return
      }

      // Cmd+Shift+G — ungroup the selected group(s)
      if (isMeta && e.key === 'g' && e.shiftKey) {
        state.ungroupSelectedLayers()
        e.preventDefault()
        return
      }

      // Cmd+] — bring forward · Cmd+Shift+] — bring to front.
      // Use e.code so Shift's shifted glyph ("}") doesn't hide the binding.
      // Operates on the whole selection in one snapshot.
      if (isMeta && e.code === 'BracketRight') {
        state.reorderSelection([...state.selectedLayerIds], e.shiftKey ? 'front' : 'forward')
        e.preventDefault()
        return
      }

      // Cmd+[ — send backward · Cmd+Shift+[ — send to back.
      if (isMeta && e.code === 'BracketLeft') {
        state.reorderSelection([...state.selectedLayerIds], e.shiftKey ? 'back' : 'backward')
        e.preventDefault()
        return
      }

      // Shift+H / Shift+V — flip the selection (before the plain h/v tool keys).
      if (!isMeta && !e.altKey && e.shiftKey && (e.code === 'KeyH' || e.code === 'KeyV')) {
        const selected = state.getSelectedLayers().filter((l) => l.type !== 'background')
        if (selected.length) {
          state.pushSnapshot()
          for (const l of selected) {
            const patch = e.code === 'KeyH' ? { flipH: !l.flipH } : { flipV: !l.flipV }
            state.updateLayer(l.id, patch)
          }
        }
        e.preventDefault()
        return
      }

      // Tab / Shift+Tab — cycle the selection through layers by stacking order.
      if (e.key === 'Tab') {
        const layers = state.document.layers
          .filter((l) => l.type !== 'background' && l.visible && !l.locked)
          .sort((a, b) => a.zIndex - b.zIndex)
        if (layers.length) {
          const idx = layers.findIndex((l) => l.id === state.activeLayerId)
          const next = idx === -1 ? 0 : (idx + (e.shiftKey ? -1 : 1) + layers.length) % layers.length
          state.selectLayer(layers[next].id)
        }
        e.preventDefault()
        return
      }

      // Single-key tool shortcuts (match the toolbar hints; non-meta only).
      if (!isMeta && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'v') { state.setTool('select'); e.preventDefault(); return }
        if (k === 'h') { state.setTool('pan'); e.preventDefault(); return }
        if (k === 'c') { state.setTool(state.tool === 'comment' ? 'select' : 'comment'); e.preventDefault(); return }
        if (k === 't') { state.addLayer(createTextLayer()); e.preventDefault(); return }
        if (k === 'r') {
          state.addLayer({
            type: 'shape', name: 'Rectangle', visible: true, locked: false, opacity: 1,
            x: 100, y: 100, width: 200, height: 200, rotation: 0,
            shape: 'rectangle', fill: getBrandColor('brand-dark'), borderRadius: 7,
          } satisfies Omit<ShapeLayer, 'id' | 'zIndex'>)
          e.preventDefault(); return
        }
      }

      // Arrow keys — nudge
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const amount = e.shiftKey ? 8 : 1
        const selected = [...state.selectedLayerIds]
        if (selected.length === 0) return

        state.pushSnapshot()
        for (const id of selected) {
          const layer = state.getLayer(id)
          if (!layer || layer.type === 'background') continue

          const updates: { x?: number; y?: number } = {}
          if (e.key === 'ArrowUp') updates.y = layer.y - amount
          if (e.key === 'ArrowDown') updates.y = layer.y + amount
          if (e.key === 'ArrowLeft') updates.x = layer.x - amount
          if (e.key === 'ArrowRight') updates.x = layer.x + amount
          state.updateLayer(id, updates)
        }
        e.preventDefault()
        return
      }

      // Escape — deselect
      if (e.key === 'Escape') {
        state.deselectAll()
        e.preventDefault()
        return
      }

      // V — select tool
      if (e.key === 'v' && !isMeta) {
        state.setTool('select')
        e.preventDefault()
        return
      }

      // H — pan tool
      if (e.key === 'h' && !isMeta) {
        state.setTool('pan')
        e.preventDefault()
        return
      }

      // P — pen / freehand draw (toggle)
      if (e.key === 'p' && !isMeta) {
        state.setTool(state.tool === 'draw' ? 'select' : 'draw')
        e.preventDefault()
        return
      }

      // T — add text
      if (e.key === 't' && !isMeta) {
        state.addLayer(createTextLayer())
        e.preventDefault()
        return
      }

      // R — add rectangle
      if (e.key === 'r' && !isMeta) {
        state.addLayer({
          type: 'shape',
          name: 'Rectangle',
          visible: true,
          locked: false,
          opacity: 1,
          x: 100,
          y: 100,
          width: 200,
          height: 120,
          rotation: 0,
          shape: 'rectangle',
          fill: getBrandColor('brand-dark'),
          borderRadius: 7,
        } satisfies Omit<ShapeLayer, 'id' | 'zIndex'>)
        e.preventDefault()
        return
      }

      // O — add ellipse
      if (e.key === 'o' && !isMeta) {
        state.addLayer({
          type: 'shape',
          name: 'Ellipse',
          visible: true,
          locked: false,
          opacity: 1,
          x: 100,
          y: 100,
          width: 200,
          height: 200,
          rotation: 0,
          shape: 'ellipse',
          fill: getBrandColor('brand-accent'),
          borderRadius: 0,
        } satisfies Omit<ShapeLayer, 'id' | 'zIndex'>)
        e.preventDefault()
        return
      }
    }

    // Spacebar release — back to select
    const upHandler = (e: KeyboardEvent) => {
      if (e.key === ' ' && spaceHeld.current) {
        spaceHeld.current = false
        useDesignStore.getState().setTool('select')
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', handler)
    window.addEventListener('keyup', upHandler)
    return () => {
      window.removeEventListener('keydown', handler)
      window.removeEventListener('keyup', upHandler)
    }
  }, [])
}
