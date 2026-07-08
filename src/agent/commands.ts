import { useDesignStore, createTextLayer } from '@/store/useDesignStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { relayoutActiveFrame } from '@/store/useAIStore'
import { getTextBounds, createMeasureContext } from '@/engine/textMeasure'
import { AD_FORMATS } from '@/brand/formats'
import { getBrandColor } from '@/brand/palette'
import type { FontWeight, LayerConstraints, TextLayer } from '@/types/design'

/**
 * The canvas command bus — one typed, introspectable surface for driving the
 * editor. The UI and any agent are both just clients of this: every op maps to
 * a store action or composite, so "can an agent do what a human can?" is true
 * by construction. Commands are plain serializable objects ({ op, ...args }) so
 * they cross the postMessage boundary (see rpc.ts) unchanged.
 *
 * Introspection: `getSchema` returns the full command list with params, so an
 * agent reads its own toolset rather than guessing.
 */

export interface CommandResult {
  ok: boolean
  result?: unknown
  error?: string
}

interface CommandDef {
  description: string
  /** param name → short description (type + meaning). Drives getSchema. */
  params: Record<string, string>
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

const formatById = (id: unknown) => {
  const fmt = AD_FORMATS.find((f) => f.id === id)
  if (!fmt) throw new Error(`Unknown formatId "${String(id)}". Options: ${AD_FORMATS.map((f) => f.id).join(', ')}`)
  return fmt
}

/** Serializable snapshot an agent reads to understand current state. The active
    frame's layers come from the design store (the live copy). */
function snapshot() {
  const ws = useWorkspaceStore.getState()
  const d = useDesignStore.getState()
  const page = ws.getActivePage()
  const frames = (page?.frames ?? []).map((f) => {
    const active = f.id === ws.activeFrameId
    const layers = (active ? d.document.layers : f.layers).map((l) => ({
      id: l.id,
      type: l.type,
      name: l.name,
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
      ...(l.type === 'text' ? { content: (l as { content: string }).content } : {}),
    }))
    return { id: f.id, name: f.name, formatId: f.format.id, width: f.width, height: f.height, active, layers }
  })
  return { activeFrameId: ws.activeFrameId, selection: [...d.selectedLayerIds], frames }
}

const COMMANDS: Record<string, CommandDef> = {
  // ── Introspection & query ─────────────────────────────────────────────
  getSchema: {
    description: 'List every available command with its parameters. Call this first.',
    params: {},
    handler: () => ({
      commands: Object.entries(COMMANDS).map(([op, d]) => ({ op, description: d.description, params: d.params })),
    }),
  },
  getState: {
    description: 'Snapshot of the workspace: frames, their formats/sizes, and each layer (id, type, name, box, text content).',
    params: {},
    handler: () => snapshot(),
  },
  listFormats: {
    description: 'All ad formats you can assign to a frame.',
    params: {},
    handler: () => AD_FORMATS.map((f) => ({ id: f.id, label: f.label, width: f.width, height: f.height, aspectRatio: f.aspectRatio })),
  },

  // ── Frames ────────────────────────────────────────────────────────────
  addFrame: {
    description: 'Create a new frame and return its id.',
    params: { formatId: 'string? — format to use (default LinkedIn Feed)', name: 'string? — frame name' },
    handler: (a) => {
      const fmt = a.formatId ? formatById(a.formatId) : undefined
      return { frameId: useWorkspaceStore.getState().addFrame(fmt, undefined, a.name as string | undefined) }
    },
  },
  removeFrame: {
    description: 'Delete a frame.',
    params: { frameId: 'string — frame to delete' },
    handler: (a) => {
      useWorkspaceStore.getState().removeFrame(a.frameId as string)
      return { ok: true }
    },
  },
  duplicateFrame: {
    description: 'Duplicate a frame and return the new frame id.',
    params: { frameId: 'string' },
    handler: (a) => ({ frameId: useWorkspaceStore.getState().duplicateFrame(a.frameId as string) }),
  },
  renameFrame: {
    description: 'Rename a frame.',
    params: { frameId: 'string', name: 'string' },
    handler: (a) => {
      useWorkspaceStore.getState().renameFrame(a.frameId as string, a.name as string)
      return { ok: true }
    },
  },
  setFrameFormat: {
    description: 'Change a frame\'s format in place; layers reflow to fit the new size (per their constraints).',
    params: { frameId: 'string', formatId: 'string — see listFormats' },
    handler: (a) => {
      useWorkspaceStore.getState().setFrameFormat(a.frameId as string, formatById(a.formatId))
      return { ok: true }
    },
  },
  selectFrame: {
    description: 'Make a frame the active editing frame (layer commands target the active frame).',
    params: { frameId: 'string' },
    handler: (a) => {
      useWorkspaceStore.getState().setActiveFrame(a.frameId as string)
      return { ok: true }
    },
  },
  generateFormatVariants: {
    description: 'Spawn a copy of the frame in every other ad format (scaled), next to it.',
    params: { frameId: 'string' },
    handler: (a) => {
      useWorkspaceStore.getState().generateFormatVariants(a.frameId as string)
      return { ok: true }
    },
  },

  // ── Layers (operate on the active frame) ──────────────────────────────
  addText: {
    description: 'Add a text layer to the active frame. Returns its layer id.',
    params: {
      text: 'string — the content',
      x: 'number? (default 100)', y: 'number? (default 100)', width: 'number? (default 400)',
      fontSize: 'number? (default 32)', fontWeight: '300|400|500|600|700?',
      textAlign: 'left|center|right?', colorToken: 'charcoal|white|brand-primary|ember-500|... (see palette)?',
    },
    handler: (a) => {
      const fontWeight = a.fontWeight as FontWeight | undefined
      const layer = createTextLayer({
        content: (a.text as string) ?? 'Text',
        x: (a.x as number) ?? 100,
        y: (a.y as number) ?? 100,
        ...(a.width != null ? { width: a.width as number } : {}),
        ...(a.fontSize != null ? { fontSize: a.fontSize as number } : {}),
        ...(fontWeight != null ? { fontWeight } : {}),
        ...(a.textAlign != null ? { textAlign: a.textAlign as 'left' | 'center' | 'right' } : {}),
        ...(a.colorToken ? { color: getBrandColor(a.colorToken as string) } : {}),
      })
      const id = useDesignStore.getState().addLayer(layer)
      // Hug the box to the text (cap trim) so agent-added text isn't loose.
      const created = useDesignStore.getState().getLayer(id) as TextLayer | undefined
      if (created) {
        const b = getTextBounds(createMeasureContext(), created)
        useDesignStore.getState().updateLayer<TextLayer>(id, { height: Math.round(b.height + 2) })
      }
      return { layerId: id }
    },
  },
  addShape: {
    description: 'Add a shape layer to the active frame. Returns its layer id.',
    params: {
      shape: 'rectangle|ellipse|pill? (default rectangle)',
      x: 'number? (default 100)', y: 'number? (default 100)', width: 'number? (default 200)', height: 'number? (default 200)',
      colorToken: 'brand-dark|ember-500|brand-accent|... (default brand-dark)?', borderRadius: 'number? (default 7)',
    },
    handler: (a) => {
      const layerId = useDesignStore.getState().addLayer({
        type: 'shape',
        name: 'Shape',
        visible: true,
        locked: false,
        opacity: 1,
        x: (a.x as number) ?? 100,
        y: (a.y as number) ?? 100,
        width: (a.width as number) ?? 200,
        height: (a.height as number) ?? 200,
        rotation: 0,
        shape: (a.shape as string) ?? 'rectangle',
        fill: getBrandColor((a.colorToken as string) ?? 'brand-dark'),
        borderRadius: (a.borderRadius as number) ?? 7,
      })
      return { layerId }
    },
  },
  updateLayer: {
    description: 'Patch fields on a layer in the active frame (e.g. { x, y, width, height, opacity, content, fontSize, fill }).',
    params: { layerId: 'string', patch: 'object — fields to merge onto the layer' },
    handler: (a) => {
      useDesignStore.getState().updateLayer(a.layerId as string, (a.patch as object) ?? {})
      return { ok: true }
    },
  },
  removeLayer: {
    description: 'Delete a layer from the active frame.',
    params: { layerId: 'string' },
    handler: (a) => {
      useDesignStore.getState().removeLayer(a.layerId as string)
      return { ok: true }
    },
  },
  duplicateLayer: {
    description: 'Duplicate a layer in the active frame.',
    params: { layerId: 'string' },
    handler: (a) => {
      useDesignStore.getState().duplicateLayer(a.layerId as string)
      return { ok: true }
    },
  },
  reorderLayer: {
    description: 'Move a layer to a new z-index (higher = in front).',
    params: { layerId: 'string', zIndex: 'number' },
    handler: (a) => {
      useDesignStore.getState().reorderLayer(a.layerId as string, a.zIndex as number)
      return { ok: true }
    },
  },
  setLayerConstraints: {
    description: 'Set how a layer reflows on format change. horizontal: left|center|right|stretch, vertical: top|center|bottom|stretch, scale: proportional|fixed|stretch.',
    params: { layerId: 'string', constraints: '{ horizontal, vertical, scale }' },
    handler: (a) => {
      useDesignStore.getState().updateLayer(a.layerId as string, { constraints: a.constraints as LayerConstraints })
      return { ok: true }
    },
  },
  selectLayer: {
    description: 'Select a layer in the active frame.',
    params: { layerId: 'string' },
    handler: (a) => {
      useDesignStore.getState().selectLayer(a.layerId as string)
      return { ok: true }
    },
  },

  // ── AI ────────────────────────────────────────────────────────────────
  relayoutFrame: {
    description: 'AI re-layout: re-compose a frame\'s existing content to fit its current format (call setFrameFormat first to change size). Preserves copy/colours, recomposes positions. Async, uses the LLM.',
    params: { frameId: 'string? — frame to re-layout (default: active frame)' },
    handler: async (a) => {
      if (a.frameId && a.frameId !== useWorkspaceStore.getState().activeFrameId) {
        useWorkspaceStore.getState().setActiveFrame(a.frameId as string)
      }
      return { ok: await relayoutActiveFrame() }
    },
  },
}

/** Run one command. Never throws — failures come back as { ok:false, error }.
    Async because some ops (AI re-layout) await the LLM. */
export async function dispatch(command: { op: string; [k: string]: unknown }): Promise<CommandResult> {
  const def = command && COMMANDS[command.op]
  if (!def) return { ok: false, error: `Unknown command "${command?.op}". Call { op: "getSchema" } for the list.` }
  try {
    return { ok: true, result: await def.handler(command) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function getSchema() {
  return COMMANDS.getSchema.handler({})
}
