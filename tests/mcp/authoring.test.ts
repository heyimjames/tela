/**
 * The authoring acceptance path.
 *
 * The headline test is the last one in this file: an ABES-representative
 * campaign taken through create → open → mutate → save → **reopen** → verify.
 * The reopen is what makes it meaningful. An in-memory assertion proves the
 * mutation reached the session; only reading the file back proves it reached the
 * format, survived canonicalization, and came out semantically identical.
 *
 * The revision gates get their own tests because they are the concurrency
 * contract, and a concurrency contract that is not tested is a concurrency hope.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { call, callExpectingError, connectInProcess, Editor, type Harness } from './harness'
import { abesLayers, ALL_LAYER_TYPES, CLEAN_SVG, TINY_PNG_BASE64 } from './abesFixture'
import { readBundleForEditing } from '../../src/tela/bundle'

let harness: Harness

beforeEach(async () => {
  harness = await connectInProcess()
})

afterEach(async () => {
  await harness.close()
})

interface Summary {
  session_revision: number
  disk_revision: string
  unsaved_changes: boolean
  active_page_id: string
  active_frame_id: string | null
  name: string
  pages: Array<{ page_id: string; name: string; frames: Array<{ frame_id: string; name: string; format_id: string; layer_count: number }> }>
  counts: { pages: number; frames: number; layers: number; assets: number; fonts: number; versions: number }
}

async function summary(design: string): Promise<Summary> {
  return (await call<Summary>(harness.client, 'tela_get_design_summary', { design })).structured
}

async function seedAsset(name: string, base64: string): Promise<string> {
  const path = join(harness.root, name)
  await mkdir(join(harness.root, 'incoming'), { recursive: true }).catch(() => {})
  await writeFile(path, Buffer.from(base64, 'base64'))
  return name
}

describe('design lifecycle', () => {
  it('creates, opens, saves, and reopens a design with a stable revision chain', async () => {
    const created = await call<{ session: { session_revision: number; disk_revision: string }; frame_id: string }>(
      harness.client,
      'tela_create_design',
      { design: 'campaigns/basic.tela', name: 'Basic' },
    )
    expect(created.structured.session.session_revision).toBe(0)
    expect(created.structured.frame_id).toBeTruthy()

    const listed = await call<{ designs: Array<{ design: string; open: boolean }> }>(harness.client, 'tela_list_designs')
    expect(listed.structured.designs.map((entry) => entry.design)).toContain('campaigns/basic.tela')

    const editor = await Editor.open(harness.client, 'campaigns/basic.tela')
    await editor.mutate('tela_add_page', { name: 'Second page' })
    expect(editor.sessionRevision).toBe(1)

    const saved = await editor.save()
    expect(saved.bytes_written).toBeGreaterThan(0)
    expect(saved.session.unsaved_changes).toBe(false)

    // Reopen in the same process but from a clean session, so the assertion is
    // against the bytes rather than the memory.
    await call(harness.client, 'tela_close_design', { design: 'campaigns/basic.tela' })
    const reopened = await Editor.open(harness.client, 'campaigns/basic.tela')
    expect(reopened.sessionRevision).toBe(0)
    expect((await summary('campaigns/basic.tela')).counts.pages).toBe(2)
  })

  it('refuses to overwrite an existing design', async () => {
    await call(harness.client, 'tela_create_design', { design: 'dup.tela', name: 'One' })
    const message = await callExpectingError(harness.client, 'tela_create_design', { design: 'dup.tela', name: 'Two' })
    expect(message).toMatch(/already exists/)
    expect(message).toMatch(/tela_archive_design|different path/)
  })

  it('refuses to close a design with unsaved changes unless told to discard them', async () => {
    await call(harness.client, 'tela_create_design', { design: 'dirty.tela', name: 'Dirty' })
    const editor = await Editor.open(harness.client, 'dirty.tela')
    await editor.mutate('tela_add_page', { name: 'Unsaved' })

    const message = await callExpectingError(harness.client, 'tela_close_design', { design: 'dirty.tela' })
    expect(message).toMatch(/unsaved changes/)
    expect(message).toMatch(/tela_save_design/)

    const forced = await call<{ discarded_changes: boolean }>(harness.client, 'tela_close_design', { design: 'dirty.tela', discard_changes: true })
    expect(forced.structured.discarded_changes).toBe(true)
  })

  it('duplicates from the saved file and archives to the managed trash rather than deleting', async () => {
    await call(harness.client, 'tela_create_design', { design: 'source.tela', name: 'Source' })
    await call(harness.client, 'tela_duplicate_design', { design: 'source.tela', target_design: 'copy.tela' })
    expect((await summary('source.tela')).name).toBe('Source')

    await call(harness.client, 'tela_close_design', { design: 'source.tela' })
    const archived = await call<{ archived_as: string }>(harness.client, 'tela_archive_design', { design: 'source.tela' })
    expect(archived.structured.archived_as).toMatch(/^\.trash\//)

    // Moved, not destroyed: the bytes are still readable from the trash.
    const trashed = await readFile(join(harness.root, archived.structured.archived_as))
    expect(readBundleForEditing(new Uint8Array(trashed)).document.name).toBe('Source')
  })

  it('imports a bundle from inside the approved root, validating it first', async () => {
    await call(harness.client, 'tela_create_design', { design: 'origin.tela', name: 'Origin' })
    const imported = await call<{ design: string; bytes: number }>(harness.client, 'tela_import_design', {
      source: 'origin.tela',
      design: 'library/imported.tela',
    })
    expect(imported.structured.design).toBe('library/imported.tela')
    const editor = await Editor.open(harness.client, 'library/imported.tela')
    expect(editor.sessionRevision).toBe(0)
  })
})

describe('revision gates', () => {
  it('refuses a mutation carrying a stale session revision', async () => {
    await call(harness.client, 'tela_create_design', { design: 'race.tela', name: 'Race' })
    const editor = await Editor.open(harness.client, 'race.tela')
    await editor.mutate('tela_add_page', { name: 'A' })

    const message = await callExpectingError(harness.client, 'tela_add_page', {
      design: 'race.tela',
      name: 'B',
      expected_session_revision: 0,
    })
    expect(message).toMatch(/^\[revision_mismatch\]/)
    expect(message).toMatch(/tela_get_design_summary/)
  })

  it('refuses a save whose expected disk revision does not match the file', async () => {
    await call(harness.client, 'tela_create_design', { design: 'disk.tela', name: 'Disk' })
    const editor = await Editor.open(harness.client, 'disk.tela')
    await editor.mutate('tela_add_page', { name: 'A' })

    const message = await callExpectingError(harness.client, 'tela_save_design', {
      design: 'disk.tela',
      expected_session_revision: editor.sessionRevision,
      expected_disk_revision: 'f'.repeat(64),
    })
    expect(message).toMatch(/^\[revision_mismatch\]/)
    expect(message).toMatch(/changed outside this session/)
  })

  it('accepts the revision each mutation hands back, so a chain of edits never stalls', async () => {
    await call(harness.client, 'tela_create_design', { design: 'chain.tela', name: 'Chain' })
    const editor = await Editor.open(harness.client, 'chain.tela')
    for (let index = 0; index < 5; index += 1) {
      await editor.mutate('tela_add_page', { name: `Page ${index}` })
    }
    expect(editor.sessionRevision).toBe(5)
    expect((await summary('chain.tela')).counts.pages).toBe(6)
  })

  it('serializes concurrent mutations so exactly one of a racing pair wins', async () => {
    await call(harness.client, 'tela_create_design', { design: 'concurrent.tela', name: 'Concurrent' })
    const editor = await Editor.open(harness.client, 'concurrent.tela')

    // Both calls claim revision 0. The lock serializes them and the revision
    // gate rejects whichever arrives second — the lost-update case.
    const results = await Promise.all([
      harness.client.callTool({ name: 'tela_add_page', arguments: { design: 'concurrent.tela', name: 'First', expected_session_revision: 0 } }),
      harness.client.callTool({ name: 'tela_add_page', arguments: { design: 'concurrent.tela', name: 'Second', expected_session_revision: 0 } }),
    ])
    const failures = results.filter((result) => result.isError)
    expect(failures).toHaveLength(1)
    expect((failures[0].content as Array<{ text: string }>)[0].text).toMatch(/revision_mismatch/)
    expect((await summary('concurrent.tela')).counts.pages).toBe(2)
    expect(editor.sessionRevision).toBe(0)
  })
})

describe('every persisted layer type', () => {
  it('adds, reads back, saves, and reopens all eight types without loss', async () => {
    await seedAsset('photo.png', TINY_PNG_BASE64)
    await call(harness.client, 'tela_create_design', { design: 'layers.tela', name: 'Layer coverage' })
    const editor = await Editor.open(harness.client, 'layers.tela')
    const frameId = (await summary('layers.tela')).pages[0].frames[0].frame_id

    const asset = await editor.mutate<{ ref: string; session: never }>('tela_import_asset', { source: 'photo.png', name: 'Photo' })

    const added = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_add_layers', {
      frame_id: frameId,
      layers: abesLayers(asset.ref),
    })
    expect(added.layer_ids).toHaveLength(10)

    // The group type cannot be declared directly — its childIds must name layers
    // that already exist — so it is created the way the surface intends.
    const grouped = await editor.mutate<{ group_id: string; session: never }>('tela_group_layers', {
      frame_id: frameId,
      layer_ids: added.layer_ids.slice(-2),
      name: 'Brand lockup',
    })

    const scene = await call<{ layers: Array<{ type: string; id: string }> }>(harness.client, 'tela_get_scene', {
      design: 'layers.tela',
      frame_id: frameId,
    })
    const present = new Set(scene.structured.layers.map((layer) => layer.type))
    for (const type of ALL_LAYER_TYPES) {
      expect(present.has(type), `layer type "${type}" is missing from the scene`).toBe(true)
    }

    await editor.save()
    await call(harness.client, 'tela_close_design', { design: 'layers.tela' })
    await Editor.open(harness.client, 'layers.tela')

    const reopened = await call<{ layers: Array<{ type: string; id: string }> }>(harness.client, 'tela_get_scene', {
      design: 'layers.tela',
      frame_id: frameId,
    })
    const afterReopen = new Set(reopened.structured.layers.map((layer) => layer.type))
    for (const type of ALL_LAYER_TYPES) {
      expect(afterReopen.has(type), `layer type "${type}" was lost across save/reopen`).toBe(true)
    }
    expect(reopened.structured.layers).toHaveLength(scene.structured.layers.length)
    expect(reopened.structured.layers.map((layer) => layer.id)).toEqual(scene.structured.layers.map((layer) => layer.id))
    expect(grouped.group_id).toBeTruthy()
  })

  it('preserves type-specific detail exactly across a save and reopen', async () => {
    await seedAsset('photo.png', TINY_PNG_BASE64)
    await call(harness.client, 'tela_create_design', { design: 'detail.tela', name: 'Detail' })
    const editor = await Editor.open(harness.client, 'detail.tela')
    const frameId = (await summary('detail.tela')).pages[0].frames[0].frame_id
    const asset = await editor.mutate<{ ref: string; session: never }>('tela_import_asset', { source: 'photo.png', name: 'Photo' })
    await editor.mutate('tela_add_layers', { frame_id: frameId, layers: abesLayers(asset.ref) })

    const before = await call<{ layers: Array<Record<string, unknown>> }>(harness.client, 'tela_get_scene', { design: 'detail.tela', frame_id: frameId })
    await editor.save()
    await call(harness.client, 'tela_close_design', { design: 'detail.tela' })
    await Editor.open(harness.client, 'detail.tela')
    const after = await call<{ layers: Array<Record<string, unknown>> }>(harness.client, 'tela_get_scene', { design: 'detail.tela', frame_id: frameId })

    // Compared whole. A field-by-field list here would only ever test the fields
    // someone remembered to list, which is the exact failure mode the format
    // exists to prevent.
    expect(after.structured.layers).toEqual(before.structured.layers)
  })
})

describe('layer authoring', () => {
  let frameId: string
  let editor: Editor

  beforeEach(async () => {
    await call(harness.client, 'tela_create_design', { design: 'edit.tela', name: 'Edit' })
    editor = await Editor.open(harness.client, 'edit.tela')
    frameId = (await summary('edit.tela')).pages[0].frames[0].frame_id
  })

  it('addresses layers by id, never by a current selection', async () => {
    const added = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_add_layers', {
      frame_id: frameId,
      layers: [
        { type: 'text', content: 'One', x: 0, y: 0 },
        { type: 'text', content: 'Two', x: 0, y: 100 },
      ],
    })
    // The second layer is updated without ever selecting or activating anything.
    await editor.mutate('tela_update_layers', {
      frame_id: frameId,
      updates: [{ layer_id: added.layer_ids[1], patch: { content: 'Two, updated', fontSize: 48 } }],
    })
    const scene = await call<{ layers: Array<{ id: string; content?: string; fontSize?: number }> }>(harness.client, 'tela_get_scene', {
      design: 'edit.tela',
      frame_id: frameId,
    })
    const updated = scene.structured.layers.find((layer) => layer.id === added.layer_ids[1])
    expect(updated?.content).toBe('Two, updated')
    expect(updated?.fontSize).toBe(48)
    expect(scene.structured.layers.find((layer) => layer.id === added.layer_ids[0])?.content).toBe('One')
  })

  it('refuses a patch that would make a layer invalid, leaving the layer untouched', async () => {
    const added = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_add_layers', {
      frame_id: frameId,
      layers: [{ type: 'text', content: 'Keep me' }],
    })
    const revisionBefore = editor.sessionRevision

    const message = await callExpectingError(harness.client, 'tela_update_layers', {
      design: 'edit.tela',
      frame_id: frameId,
      expected_session_revision: revisionBefore,
      updates: [{ layer_id: added.layer_ids[0], patch: { fontSize: 'enormous' } }],
    })
    expect(message).toMatch(/invalid/)

    const scene = await call<{ layers: Array<{ content?: string }> }>(harness.client, 'tela_get_scene', { design: 'edit.tela', frame_id: frameId })
    expect(scene.structured.layers[0].content).toBe('Keep me')
    expect((await summary('edit.tela')).session_revision).toBe(revisionBefore)
  })

  it('refuses to change a layer\'s type and says what to do instead', async () => {
    const added = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_add_layers', {
      frame_id: frameId,
      layers: [{ type: 'text', content: 'Text' }],
    })
    const message = await callExpectingError(harness.client, 'tela_update_layers', {
      design: 'edit.tela',
      frame_id: frameId,
      expected_session_revision: editor.sessionRevision,
      updates: [{ layer_id: added.layer_ids[0], patch: { type: 'shape' } }],
    })
    expect(message).toMatch(/tela_archive_layers/)
    expect(message).toMatch(/tela_add_layers/)
  })

  it('requires a complete permutation to reorder, refusing a partial list', async () => {
    const added = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_add_layers', {
      frame_id: frameId,
      layers: [{ type: 'text', content: 'A' }, { type: 'text', content: 'B' }, { type: 'text', content: 'C' }],
    })
    const message = await callExpectingError(harness.client, 'tela_reorder_layers', {
      design: 'edit.tela',
      frame_id: frameId,
      expected_session_revision: editor.sessionRevision,
      layer_ids: added.layer_ids.slice(0, 2),
    })
    expect(message).toMatch(/every existing layer exactly once/)
    expect(message).toMatch(/missing/)

    const reversed = [...added.layer_ids].reverse()
    await editor.mutate('tela_reorder_layers', { frame_id: frameId, layer_ids: reversed })
    const scene = await call<{ layers: Array<{ id: string }> }>(harness.client, 'tela_get_scene', { design: 'edit.tela', frame_id: frameId })
    expect(scene.structured.layers.map((layer) => layer.id)).toEqual(reversed)
  })

  it('groups, auto-lays-out, and ungroups, writing positions into the document', async () => {
    const added = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_add_layers', {
      frame_id: frameId,
      layers: [
        { type: 'shape', x: 0, y: 0, width: 100, height: 40 },
        { type: 'shape', x: 400, y: 300, width: 100, height: 40 },
      ],
    })
    const grouped = await editor.mutate<{ group_id: string; session: never }>('tela_group_layers', { frame_id: frameId, layer_ids: added.layer_ids })

    await editor.mutate('tela_set_auto_layout', {
      frame_id: frameId,
      group_id: grouped.group_id,
      direction: 'vertical',
      gap: 20,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
    })

    const scene = await call<{ layers: Array<{ id: string; x: number; y: number }>; frame: { auto_layouts: Record<string, unknown> } }>(
      harness.client,
      'tela_get_scene',
      { design: 'edit.tela', frame_id: frameId },
    )
    expect(Object.keys(scene.structured.frame.auto_layouts)).toContain(grouped.group_id)
    const [first, second] = added.layer_ids.map((id) => scene.structured.layers.find((layer) => layer.id === id)!)
    // Stacked vertically with a 20px gap: the second child sits one height plus
    // one gap below the first, and both share the padded left edge.
    expect(second.y - first.y).toBe(60)
    expect(first.x).toBe(second.x)

    const ungrouped = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_ungroup_layers', { frame_id: frameId, group_id: grouped.group_id })
    expect(ungrouped.layer_ids.sort()).toEqual([...added.layer_ids].sort())
    const afterUngroup = await call<{ frame: { auto_layouts: Record<string, unknown> } }>(harness.client, 'tela_get_scene', {
      design: 'edit.tela',
      frame_id: frameId,
    })
    expect(afterUngroup.structured.frame.auto_layouts).toEqual({})
  })

  it('archives layers to the trash and cleans up references to them', async () => {
    const added = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_add_layers', {
      frame_id: frameId,
      layers: [{ type: 'shape', width: 10, height: 10 }, { type: 'shape', width: 10, height: 10 }],
    })
    const grouped = await editor.mutate<{ group_id: string; session: never }>('tela_group_layers', { frame_id: frameId, layer_ids: added.layer_ids })

    // Archiving a group member must leave the group valid rather than dangling.
    const archived = await editor.mutate<{ archived_to: string; session: never }>('tela_archive_layers', {
      frame_id: frameId,
      layer_ids: [added.layer_ids[0]],
    })
    expect(archived.archived_to).toMatch(/^\.trash\//)

    const validation = await call<{ valid: boolean; schema_issues: string[] }>(harness.client, 'tela_validate_design', { design: 'edit.tela' })
    expect(validation.structured.valid).toBe(true)

    const scene = await call<{ layers: Array<{ id: string; type: string; childIds?: string[] }> }>(harness.client, 'tela_get_scene', {
      design: 'edit.tela',
      frame_id: frameId,
    })
    const group = scene.structured.layers.find((layer) => layer.id === grouped.group_id)
    expect(group?.childIds).not.toContain(added.layer_ids[0])

    const recovered = JSON.parse(await readFile(join(harness.root, archived.archived_to), 'utf8')) as Array<{ id: string }>
    expect(recovered[0].id).toBe(added.layer_ids[0])
  })

  it('duplicates layers with fresh ids at an offset', async () => {
    const added = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_add_layers', {
      frame_id: frameId,
      layers: [{ type: 'shape', x: 10, y: 10, width: 50, height: 50 }],
    })
    const copies = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_duplicate_layers', {
      frame_id: frameId,
      layer_ids: added.layer_ids,
      offset_x: 30,
      offset_y: 40,
    })
    expect(copies.layer_ids[0]).not.toBe(added.layer_ids[0])
    const scene = await call<{ layers: Array<{ id: string; x: number; y: number }> }>(harness.client, 'tela_get_scene', {
      design: 'edit.tela',
      frame_id: frameId,
    })
    const copy = scene.structured.layers.find((layer) => layer.id === copies.layer_ids[0])!
    expect(copy.x).toBe(40)
    expect(copy.y).toBe(50)
  })

  it('applies a built-in layout scaled to the frame', async () => {
    const applied = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_apply_layout', {
      frame_id: frameId,
      layout_id: (await call<{ layouts: Array<{ layout_id: string }> }>(harness.client, 'tela_list_layouts')).structured.layouts[0].layout_id,
    })
    expect(applied.layer_ids.length).toBeGreaterThan(0)
    const validation = await call<{ valid: boolean }>(harness.client, 'tela_validate_design', { design: 'edit.tela' })
    expect(validation.structured.valid).toBe(true)
  })
})

describe('frames, pages, versions, and brand', () => {
  it('generates format variants that keep the source frame intact', async () => {
    await call(harness.client, 'tela_create_design', { design: 'variants.tela', name: 'Variants' })
    const editor = await Editor.open(harness.client, 'variants.tela')
    const frameId = (await summary('variants.tela')).pages[0].frames[0].frame_id
    await editor.mutate('tela_add_layers', { frame_id: frameId, layers: [{ type: 'text', content: 'Headline', fontSize: 64, x: 80, y: 100, width: 600, height: 80 }] })

    const generated = await editor.mutate<{ created: Array<{ frame_id: string; format_id: string }>; session: never }>(
      'tela_generate_format_variants',
      { frame_id: frameId, format_ids: ['instagram-story'] },
    )
    expect(generated.created).toHaveLength(1)
    expect(generated.created[0].format_id).toBe('instagram-story')

    const after = await summary('variants.tela')
    expect(after.counts.frames).toBe(2)
    const source = after.pages[0].frames.find((frame) => frame.frame_id === frameId)!
    expect(source.format_id).toBe('linkedin-feed')

    const variant = await call<{ frame: { width: number; height: number }; layers: Array<{ fontSize?: number }> }>(harness.client, 'tela_get_scene', {
      design: 'variants.tela',
      frame_id: generated.created[0].frame_id,
    })
    expect(variant.structured.frame.width).toBe(1080)
    expect(variant.structured.frame.height).toBe(1920)
    // Rescaled, not merely repositioned.
    expect(variant.structured.layers[0].fontSize).not.toBe(64)
  })

  it('reflows a frame in place when its format changes', async () => {
    await call(harness.client, 'tela_create_design', { design: 'reflow.tela', name: 'Reflow' })
    const editor = await Editor.open(harness.client, 'reflow.tela')
    const frameId = (await summary('reflow.tela')).pages[0].frames[0].frame_id
    await editor.mutate('tela_add_layers', {
      frame_id: frameId,
      layers: [{ type: 'shape', x: 100, y: 100, width: 200, height: 200, constraints: { horizontal: 'center', vertical: 'center', scale: 'proportional' } }],
    })
    await editor.mutate('tela_update_frame', { frame_id: frameId, format_id: 'instagram-story' })
    const scene = await call<{ frame: { width: number; height: number } }>(harness.client, 'tela_get_scene', { design: 'reflow.tela', frame_id: frameId })
    expect(scene.structured.frame.width).toBe(1080)
    expect(scene.structured.frame.height).toBe(1920)
  })

  it('refuses to archive the only page', async () => {
    await call(harness.client, 'tela_create_design', { design: 'onepage.tela', name: 'One page' })
    const editor = await Editor.open(harness.client, 'onepage.tela')
    const pageId = (await summary('onepage.tela')).pages[0].page_id
    const message = await callExpectingError(harness.client, 'tela_archive_page', {
      design: 'onepage.tela',
      page_id: pageId,
      expected_session_revision: editor.sessionRevision,
    })
    expect(message).toMatch(/at least one page/)
    expect(message).toMatch(/tela_add_page|tela_archive_design/)
  })

  it('saves and restores a version', async () => {
    await call(harness.client, 'tela_create_design', { design: 'versions.tela', name: 'Versions' })
    const editor = await Editor.open(harness.client, 'versions.tela')
    const frameId = (await summary('versions.tela')).pages[0].frames[0].frame_id
    await editor.mutate('tela_add_layers', { frame_id: frameId, layers: [{ type: 'text', content: 'Original' }] })

    const version = await editor.mutate<{ version_id: string; session: never }>('tela_save_version', { frame_id: frameId, name: 'before rewrite' })
    const scene = await call<{ layers: Array<{ id: string }> }>(harness.client, 'tela_get_scene', { design: 'versions.tela', frame_id: frameId })
    await editor.mutate('tela_update_layers', { frame_id: frameId, updates: [{ layer_id: scene.structured.layers[0].id, patch: { content: 'Rewritten' } }] })

    const listed = await call<{ versions: Array<{ version_id: string; name: string }> }>(harness.client, 'tela_list_versions', { design: 'versions.tela' })
    expect(listed.structured.versions.map((entry) => entry.version_id)).toContain(version.version_id)

    await editor.mutate('tela_restore_version', { version_id: version.version_id })
    const restored = await call<{ layers: Array<{ content?: string }> }>(harness.client, 'tela_get_scene', { design: 'versions.tela', frame_id: frameId })
    expect(restored.structured.layers[0].content).toBe('Original')
  })

  it('merges brand context field by field and survives a round trip', async () => {
    await call(harness.client, 'tela_create_design', { design: 'brand.tela', name: 'Brand' })
    const editor = await Editor.open(harness.client, 'brand.tela')
    await editor.mutate('tela_set_brand_context', { product_name: 'ABES', brand_voice: 'direct, warm', palette: { 'brand-primary': '#ff5a1f' } })
    await editor.mutate('tela_set_brand_context', { website: 'abes.example' })

    await editor.save()
    await call(harness.client, 'tela_close_design', { design: 'brand.tela' })
    await Editor.open(harness.client, 'brand.tela')

    const brand = await call<{ brand: { product_name: string; website: string; ai: { brand_voice: string }; palette: Record<string, string> } }>(
      harness.client,
      'tela_get_brand_context',
      { design: 'brand.tela' },
    )
    expect(brand.structured.brand.product_name).toBe('ABES')
    expect(brand.structured.brand.website).toBe('abes.example')
    expect(brand.structured.brand.ai.brand_voice).toBe('direct, warm')
    expect(brand.structured.brand.palette['brand-primary']).toBe('#ff5a1f')
  })
})

describe('assets and fonts', () => {
  it('imports an image once and deduplicates identical bytes', async () => {
    await seedAsset('logo.png', TINY_PNG_BASE64)
    await seedAsset('logo-copy.png', TINY_PNG_BASE64)
    await call(harness.client, 'tela_create_design', { design: 'assets.tela', name: 'Assets' })
    const editor = await Editor.open(harness.client, 'assets.tela')

    const first = await editor.mutate<{ ref: string; deduplicated: boolean; session: never }>('tela_import_asset', { source: 'logo.png', name: 'Logo' })
    expect(first.ref).toMatch(/^asset:\/\/[0-9a-f]{64}$/)
    expect(first.deduplicated).toBe(false)

    const second = await editor.mutate<{ ref: string; deduplicated: boolean; session: never }>('tela_import_asset', { source: 'logo-copy.png', name: 'Logo copy' })
    expect(second.ref).toBe(first.ref)
    expect(second.deduplicated).toBe(true)
  })

  it('refuses to archive an asset a layer still uses, then allows it once freed', async () => {
    await seedAsset('used.png', TINY_PNG_BASE64)
    await call(harness.client, 'tela_create_design', { design: 'inuse.tela', name: 'In use' })
    const editor = await Editor.open(harness.client, 'inuse.tela')
    const frameId = (await summary('inuse.tela')).pages[0].frames[0].frame_id
    const asset = await editor.mutate<{ asset_id: string; ref: string; session: never }>('tela_import_asset', { source: 'used.png', name: 'Used' })
    const added = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_add_layers', {
      frame_id: frameId,
      layers: [{ type: 'image', imageUrl: asset.ref, width: 100, height: 100, cropW: 1, cropH: 1 }],
    })

    const message = await callExpectingError(harness.client, 'tela_archive_asset', {
      design: 'inuse.tela',
      asset_id: asset.asset_id,
      expected_session_revision: editor.sessionRevision,
    })
    expect(message).toMatch(/still used by 1 layer/)
    expect(message).toMatch(/tela_update_layers|tela_archive_layers/)

    await editor.mutate('tela_archive_layers', { frame_id: frameId, layer_ids: added.layer_ids })
    const archived = await editor.mutate<{ archived_to: string; session: never }>('tela_archive_asset', { asset_id: asset.asset_id })
    expect(archived.archived_to).toMatch(/^\.trash\//)
  })

  it('rejects a font that is not WOFF2, and requires a licence for one that is', async () => {
    await seedAsset('notafont.png', TINY_PNG_BASE64)
    await call(harness.client, 'tela_create_design', { design: 'fonts.tela', name: 'Fonts' })
    const editor = await Editor.open(harness.client, 'fonts.tela')

    const message = await callExpectingError(harness.client, 'tela_import_font', {
      design: 'fonts.tela',
      source: 'notafont.png',
      family: 'Fake',
      license: 'OFL-1.1',
      expected_session_revision: editor.sessionRevision,
    })
    expect(message).toMatch(/not WOFF2/)

    // A real WOFF2 header, so sniffing identifies it as a font.
    const woff2 = Buffer.concat([Buffer.from('wOF2', 'ascii'), Buffer.alloc(64)])
    await writeFile(join(harness.root, 'face.woff2'), woff2)
    const imported = await editor.mutate<{ font_id: string; ref: string; session: never }>('tela_import_font', {
      source: 'face.woff2',
      family: 'ABES Sans',
      weight: 600,
      license: 'SIL Open Font License 1.1',
    })
    expect(imported.ref).toMatch(/^asset:\/\/[0-9a-f]{64}$/)

    const listed = await call<{ assets: Array<{ kind: string; license?: string }> }>(harness.client, 'tela_list_assets', { design: 'fonts.tela', kind: 'font' })
    expect(listed.structured.assets[0].license).toBe('SIL Open Font License 1.1')
  })

  it('relinks every layer when an asset is replaced', async () => {
    await seedAsset('v1.png', TINY_PNG_BASE64)
    await call(harness.client, 'tela_create_design', { design: 'replace.tela', name: 'Replace' })
    const editor = await Editor.open(harness.client, 'replace.tela')
    const frameId = (await summary('replace.tela')).pages[0].frames[0].frame_id
    const asset = await editor.mutate<{ asset_id: string; ref: string; session: never }>('tela_import_asset', { source: 'v1.png', name: 'V1' })
    await editor.mutate('tela_add_layers', {
      frame_id: frameId,
      layers: [
        { type: 'image', imageUrl: asset.ref, width: 100, height: 100, cropW: 1, cropH: 1 },
        { type: 'image', imageUrl: asset.ref, width: 100, height: 100, cropW: 1, cropH: 1 },
      ],
    })

    // Different bytes so the content hash — and therefore the reference — changes.
    const other = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
      'base64',
    )
    await writeFile(join(harness.root, 'v2.png'), other)
    const replaced = await editor.mutate<{ relinked_layer_count: number; ref: string; previous_ref: string; session: never }>('tela_replace_asset', {
      asset_id: asset.asset_id,
      source: 'v2.png',
    })
    expect(replaced.relinked_layer_count).toBe(2)
    expect(replaced.ref).not.toBe(replaced.previous_ref)

    await editor.save()
    const validation = await call<{ valid: boolean }>(harness.client, 'tela_validate_design', { design: 'replace.tela' })
    expect(validation.structured.valid).toBe(true)
  })
})

describe('ABES campaign acceptance path', () => {
  it('takes an ABES-representative campaign through create, open, mutate, save, and reopen', async () => {
    await seedAsset('abes-team.png', TINY_PNG_BASE64)

    // 1. create
    const created = await call<{ session: { session_revision: number }; frame_id: string; page_id: string }>(harness.client, 'tela_create_design', {
      design: 'abes/recruitment-q3.tela',
      name: 'ABES — Q3 recruitment',
    })
    const feedFrame = created.structured.frame_id

    // 2. open
    const editor = await Editor.open(harness.client, 'abes/recruitment-q3.tela')

    // 3. mutate — brand, asset, the full artwork, a grouped auto-laid-out lockup
    await editor.mutate('tela_set_brand_context', {
      product_name: 'ABES',
      display_name: 'ABES Engineering',
      website: 'abes.example',
      brand_voice: 'direct, warm, no hype',
      call_to_action: 'Apply now',
    })
    const asset = await editor.mutate<{ ref: string; session: never }>('tela_import_asset', { source: 'abes-team.png', name: 'Team photo', category: 'photos' })
    const layers = await editor.mutate<{ layer_ids: string[]; session: never }>('tela_add_layers', {
      frame_id: feedFrame,
      layers: abesLayers(asset.ref),
    })
    const lockup = await editor.mutate<{ group_id: string; session: never }>('tela_group_layers', {
      frame_id: feedFrame,
      layer_ids: layers.layer_ids.slice(-2),
      name: 'Brand lockup',
    })
    await editor.mutate('tela_set_auto_layout', {
      frame_id: feedFrame,
      group_id: lockup.group_id,
      direction: 'horizontal',
      gap: 12,
      counter_align: 'center',
    })
    await editor.mutate('tela_save_version', { frame_id: feedFrame, name: 'approved feed artwork' })
    const variants = await editor.mutate<{ created: Array<{ frame_id: string; format_id: string }>; session: never }>(
      'tela_generate_format_variants',
      { frame_id: feedFrame, format_ids: ['instagram-story'] },
    )

    const validation = await call<{ valid: boolean; schema_issues: string[]; invariant_issue: string | null }>(harness.client, 'tela_validate_design', {
      design: 'abes/recruitment-q3.tela',
    })
    expect(validation.structured.schema_issues).toEqual([])
    expect(validation.structured.invariant_issue).toBeNull()
    expect(validation.structured.valid).toBe(true)

    // 4. save
    const saved = await editor.save()
    expect(saved.bytes_written).toBeGreaterThan(0)
    expect(saved.document_sha256).toMatch(/^[0-9a-f]{64}$/)

    const before = await call<{ layers: Array<Record<string, unknown>> }>(harness.client, 'tela_get_scene', {
      design: 'abes/recruitment-q3.tela',
      frame_id: feedFrame,
    })
    const beforeSummary = await summary('abes/recruitment-q3.tela')

    // 5. reopen from disk
    await call(harness.client, 'tela_close_design', { design: 'abes/recruitment-q3.tela' })
    await Editor.open(harness.client, 'abes/recruitment-q3.tela')

    const afterSummary = await summary('abes/recruitment-q3.tela')
    expect(afterSummary.counts).toEqual(beforeSummary.counts)
    expect(afterSummary.counts.frames).toBe(2)
    expect(afterSummary.counts.assets).toBe(1)
    expect(afterSummary.counts.versions).toBe(1)

    const after = await call<{ layers: Array<Record<string, unknown>>; frame: { auto_layouts: Record<string, unknown> } }>(harness.client, 'tela_get_scene', {
      design: 'abes/recruitment-q3.tela',
      frame_id: feedFrame,
    })
    expect(after.structured.layers).toEqual(before.structured.layers)
    expect(Object.keys(after.structured.frame.auto_layouts)).toContain(lockup.group_id)

    const storyFrame = variants.created[0].frame_id
    const story = await call<{ frame: { width: number; height: number } }>(harness.client, 'tela_get_scene', {
      design: 'abes/recruitment-q3.tela',
      frame_id: storyFrame,
    })
    expect(story.structured.frame.width).toBe(1080)
    expect(story.structured.frame.height).toBe(1920)

    // A second no-op save must be recognized as semantically unchanged.
    const editorAgain = await Editor.open(harness.client, 'abes/recruitment-q3.tela')
    const resaved = await editorAgain.save()
    expect(resaved.content_unchanged).toBe(true)
    expect(resaved.document_sha256).toBe(saved.document_sha256)
  })

  it('exposes the SVG layer content it was given, sanitized, in the reopened design', async () => {
    await call(harness.client, 'tela_create_design', { design: 'svg.tela', name: 'SVG' })
    const editor = await Editor.open(harness.client, 'svg.tela')
    const frameId = (await summary('svg.tela')).pages[0].frames[0].frame_id
    await editor.mutate('tela_add_layers', { frame_id: frameId, layers: [{ type: 'svg', svgContent: CLEAN_SVG, width: 44, height: 44 }] })
    await editor.save()
    await call(harness.client, 'tela_close_design', { design: 'svg.tela' })
    await Editor.open(harness.client, 'svg.tela')
    const scene = await call<{ layers: Array<{ svgContent?: string }> }>(harness.client, 'tela_get_scene', { design: 'svg.tela', frame_id: frameId })
    expect(scene.structured.layers[0].svgContent).toContain('<path')
  })
})
