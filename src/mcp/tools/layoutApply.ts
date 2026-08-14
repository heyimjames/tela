/**
 * `tela_apply_layout`'s implementation, split out so the lifecycle module stays
 * readable.
 *
 * A layout is a *function of the frame's dimensions*, so it is built against the
 * frame's current size rather than a stored one — applying the same layout to a
 * story and to a banner produces two correctly-proportioned compositions rather
 * than one of them clipped.
 */

import { DESIGN_LAYOUTS } from '../../brand/layouts'
import { toolError } from '../errors'
import { addLayers, archiveLayers, requireFrame } from '../documentOps'
import { archiveFragment, mutateSession } from '../sessions'
import { sessionState, type SessionState } from './common'

export interface ApplyLayoutArgs {
  design: string
  frame_id: string
  layout_id: string
  replace_existing: boolean
  expected_session_revision: number
  response_format: 'json' | 'markdown'
}

export interface ApplyLayoutResult {
  data: {
    session: SessionState
    frame_id: string
    layer_ids: string[]
    archived_layer_count: number
    archived_to: string | null
  }
  text: string
}

export async function applyLayoutToFrame(args: ApplyLayoutArgs): Promise<ApplyLayoutResult> {
  const layout = DESIGN_LAYOUTS.find((candidate) => candidate.id === args.layout_id)
  if (!layout) {
    throw toolError(
      'not_found',
      `no layout "${args.layout_id}"`,
      `call tela_list_layouts for the available ids (${DESIGN_LAYOUTS.slice(0, 4).map((candidate) => candidate.id).join(', ')}, …)`,
    )
  }

  const result = await mutateSession(args.design, args.expected_session_revision, (document) => {
    const { frame } = requireFrame(document, args.frame_id)

    let working = document
    let archived: unknown[] = []
    if (args.replace_existing && frame.layers.length > 0) {
      const removal = archiveLayers(
        working,
        args.frame_id,
        frame.layers.map((layer) => layer.id),
      )
      working = removal.document
      archived = removal.archived
    }

    const built = layout.build(frame.width, frame.height)
    const inputs = built.map((layer) => {
      const { id: _id, zIndex: _zIndex, ...rest } = layer as unknown as Record<string, unknown>
      return rest
    })
    const added = addLayers(working, args.frame_id, inputs as never)
    return { document: added.document, value: { layerIds: added.layerIds, archived } }
  })

  const archivedTo =
    result.value.archived.length > 0 ? await archiveFragment(args.design, `layout-replaced-${args.frame_id}`, result.value.archived) : null

  return {
    data: {
      session: sessionState(result.session),
      frame_id: args.frame_id,
      layer_ids: result.value.layerIds,
      archived_layer_count: result.value.archived.length,
      archived_to: archivedTo,
    },
    text:
      `Applied layout "${layout.name}" to frame ${args.frame_id}: ${result.value.layerIds.length} placeholder layer(s)` +
      (archivedTo ? `, ${result.value.archived.length} previous layer(s) archived to ${archivedTo}` : '') +
      `. Session revision is now ${result.session.sessionRevision}.`,
  }
}
