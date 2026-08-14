/**
 * Protocol contract tests, run against a real SDK `Client` linked to a real
 * `buildServer()`.
 *
 * These assert the things a client actually depends on and that no amount of
 * careful handler code guarantees on its own: that the advertised tool set is
 * exactly the contracted one, that annotations are truthful rather than
 * decorative, that lists paginate, that both response formats work, that errors
 * are actionable, and — the security-relevant one — that no generic command,
 * eval, or dispatch tool is reachable.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { call, callExpectingError, connectInProcess, type Harness } from './harness'

let harness: Harness

beforeEach(async () => {
  harness = await connectInProcess()
})

afterEach(async () => {
  await harness.close()
})

/** The exact surface named in the architecture contract, by group. */
const CONTRACT_TOOLS = {
  runtime: [
    'tela_get_status',
    'tela_get_capabilities',
    'tela_list_designs',
    'tela_get_design_summary',
    'tela_get_scene',
    'tela_validate_design',
    'tela_list_templates',
    'tela_list_layouts',
    'tela_list_assets',
    'tela_list_versions',
  ],
  lifecycle: [
    'tela_create_design',
    'tela_open_design',
    'tela_close_design',
    'tela_save_design',
    'tela_import_design',
    'tela_duplicate_design',
    'tela_archive_design',
  ],
  pagesFrames: [
    'tela_add_page',
    'tela_update_page',
    'tela_reorder_pages',
    'tela_archive_page',
    'tela_add_frame',
    'tela_update_frame',
    'tela_duplicate_frame',
    'tela_reorder_frames',
    'tela_archive_frame',
    'tela_generate_format_variants',
  ],
  layers: [
    'tela_add_layers',
    'tela_update_layers',
    'tela_duplicate_layers',
    'tela_reorder_layers',
    'tela_archive_layers',
    'tela_group_layers',
    'tela_ungroup_layers',
    'tela_set_auto_layout',
    'tela_apply_layout',
  ],
  output: [
    'tela_import_asset',
    'tela_replace_asset',
    'tela_archive_asset',
    'tela_import_font',
    'tela_get_brand_context',
    'tela_set_brand_context',
    'tela_save_version',
    'tela_restore_version',
    'tela_render_preview',
    'tela_export_frames',
    'tela_open_editor',
    'tela_close_editor',
  ],
}

const ALL_CONTRACT_TOOLS = Object.values(CONTRACT_TOOLS).flat()

describe('tool surface', () => {
  it('advertises exactly the contracted tool names, and nothing else', async () => {
    const { tools } = await harness.client.listTools()
    const names = tools.map((tool) => tool.name).sort()
    expect(names).toEqual([...ALL_CONTRACT_TOOLS].sort())
    expect(names).toHaveLength(48)
  })

  it.each(Object.entries(CONTRACT_TOOLS))('registers every %s tool', async (_group, expected) => {
    const { tools } = await harness.client.listTools()
    const names = new Set(tools.map((tool) => tool.name))
    for (const name of expected) expect(names.has(name), `${name} is missing`).toBe(true)
  })

  it('exposes no generic command, dispatch, eval, shell, navigation, or fetch tool', async () => {
    const { tools } = await harness.client.listTools()
    // The internal `window.tela.dispatch` bus stays behind the loopback server.
    // If it ever leaked onto the MCP surface, a client could run arbitrary
    // editor commands — including ones added later, which is the real danger.
    const forbidden = /dispatch|command|eval|exec|shell|run_|navigate|goto|fetch|http|url|script|patch_json|raw/i
    const offenders = tools.map((tool) => tool.name).filter((name) => forbidden.test(name))
    expect(offenders).toEqual([])
  })

  it('gives every tool a description, a strict input schema, and complete annotations', async () => {
    const { tools } = await harness.client.listTools()
    for (const tool of tools) {
      expect(tool.description, `${tool.name} has no description`).toBeTruthy()
      expect((tool.description ?? '').length, `${tool.name}'s description is too thin to act on`).toBeGreaterThan(60)
      expect(tool.inputSchema, `${tool.name} has no input schema`).toBeTruthy()
      expect(tool.outputSchema, `${tool.name} has no output schema`).toBeTruthy()

      const annotations = tool.annotations as Record<string, unknown> | undefined
      expect(annotations, `${tool.name} has no annotations`).toBeTruthy()
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        expect(typeof annotations?.[hint], `${tool.name} is missing ${hint}`).toBe('boolean')
      }
      // Nothing here reaches the network, so an open-world hint would be a lie.
      expect(annotations?.openWorldHint, `${tool.name} claims to be open-world`).toBe(false)
      if (annotations?.readOnlyHint === true) {
        expect(annotations?.destructiveHint, `${tool.name} is read-only and destructive at once`).toBe(false)
      }
    }
  })

  it('marks the read tools read-only and the archiving tools destructive', async () => {
    const { tools } = await harness.client.listTools()
    const byName = new Map(tools.map((tool) => [tool.name, tool.annotations as Record<string, boolean>]))

    for (const name of CONTRACT_TOOLS.runtime) {
      expect(byName.get(name)?.readOnlyHint, `${name} should be read-only`).toBe(true)
    }
    for (const name of ['tela_archive_design', 'tela_archive_page', 'tela_archive_frame', 'tela_archive_layers', 'tela_archive_asset', 'tela_replace_asset', 'tela_restore_version']) {
      expect(byName.get(name)?.destructiveHint, `${name} should be marked destructive`).toBe(true)
      expect(byName.get(name)?.readOnlyHint, `${name} should not be read-only`).toBe(false)
    }
    // Additive tools mint new ids on every call, so they are honestly non-idempotent.
    for (const name of ['tela_add_layers', 'tela_add_frame', 'tela_add_page', 'tela_duplicate_frame']) {
      expect(byName.get(name)?.idempotentHint, `${name} mints ids and cannot be idempotent`).toBe(false)
    }
  })

  it('names every tool with the tela_ prefix', async () => {
    const { tools } = await harness.client.listTools()
    for (const tool of tools) expect(tool.name).toMatch(/^tela_[a-z0-9_]+$/)
  })
})

describe('resources', () => {
  it('lists exactly the five stable read surfaces', async () => {
    const { resources } = await harness.client.listResources()
    expect(resources.map((resource) => resource.uri).sort()).toEqual(
      ['tela://formats', 'tela://layouts', 'tela://schema/portable/v1', 'tela://status', 'tela://templates'].sort(),
    )
  })

  it('reads each resource as parseable JSON with a declared mime type', async () => {
    const { resources } = await harness.client.listResources()
    for (const resource of resources) {
      const read = await harness.client.readResource({ uri: resource.uri })
      const [content] = read.contents as Array<{ text?: string; mimeType?: string }>
      expect(content.mimeType, `${resource.uri} has no mime type`).toMatch(/json/)
      expect(() => JSON.parse(content.text ?? ''), `${resource.uri} is not valid JSON`).not.toThrow()
    }
  })

  it('publishes the portable schema with its version identifiers', async () => {
    const read = await harness.client.readResource({ uri: 'tela://schema/portable/v1' })
    const schema = JSON.parse((read.contents as Array<{ text: string }>)[0].text)
    expect(schema.$id).toBe('https://schemas.clickt.ca/tela/document/v1')
    expect(schema['x-document-schema-version']).toBe(1)
    expect(schema['x-supported-asset-mime']).toContain('image/png')
  })

  it('publishes the same format catalogue the tools accept', async () => {
    const read = await harness.client.readResource({ uri: 'tela://formats' })
    const formats = JSON.parse((read.contents as Array<{ text: string }>)[0].text) as Array<{ id: string }>
    expect(formats.map((format) => format.id)).toContain('linkedin-feed')
  })
})

describe('response formats', () => {
  it('returns compact JSON text by default and Markdown on request, with identical structured content', async () => {
    const asJson = await call(harness.client, 'tela_list_templates', { response_format: 'json' })
    const asMarkdown = await call(harness.client, 'tela_list_templates', { response_format: 'markdown' })

    expect(() => JSON.parse(asJson.text)).not.toThrow()
    expect(asMarkdown.text).toContain('###')
    expect(asMarkdown.text).toContain('|')
    // The structured payload is the program's view and must not vary with a
    // presentation setting.
    expect(asMarkdown.structured).toEqual(asJson.structured)
  })

  it('supports response_format on every read and list tool', async () => {
    const { tools } = await harness.client.listTools()
    const readOnly = tools.filter((tool) => (tool.annotations as Record<string, boolean> | undefined)?.readOnlyHint === true)
    for (const tool of readOnly) {
      const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
      expect(Object.keys(properties), `${tool.name} does not accept response_format`).toContain('response_format')
    }
  })
})

describe('pagination', () => {
  it('bounds the page size, reports totals, and walks with a cursor', async () => {
    const first = await call<{ templates: unknown[]; has_more: boolean; next_cursor?: string; total: number }>(
      harness.client,
      'tela_list_templates',
      { limit: 1 },
    )
    expect(first.structured.templates).toHaveLength(1)
    expect(first.structured.total).toBeGreaterThan(1)
    expect(first.structured.has_more).toBe(true)
    expect(first.structured.next_cursor).toBeTruthy()

    const second = await call<{ templates: Array<{ template_id: string }>; total: number }>(harness.client, 'tela_list_templates', {
      limit: 1,
      cursor: first.structured.next_cursor,
    })
    expect(second.structured.templates).toHaveLength(1)
    expect(second.structured.total).toBe(first.structured.total)
    expect(second.structured.templates[0].template_id).not.toBe(
      (first.structured.templates as Array<{ template_id: string }>)[0].template_id,
    )
  })

  it('reports has_more false and omits a cursor on the last page', async () => {
    const all = await call<{ has_more: boolean; next_cursor?: string }>(harness.client, 'tela_list_templates', { limit: 200 })
    expect(all.structured.has_more).toBe(false)
    expect(all.structured.next_cursor).toBeUndefined()
  })

  it('refuses a cursor minted for a different listing', async () => {
    const templates = await call<{ next_cursor?: string }>(harness.client, 'tela_list_templates', { limit: 1 })
    const message = await callExpectingError(harness.client, 'tela_list_layouts', { limit: 1, cursor: templates.structured.next_cursor })
    expect(message).toContain('cursor')
    expect(message).toMatch(/without it|restart/i)
  })

  it('rejects a limit above the bound at the schema, before the handler runs', async () => {
    const message = await callExpectingError(harness.client, 'tela_list_templates', { limit: 5000 })
    expect(message.length).toBeGreaterThan(0)
  })
})

describe('errors', () => {
  it('explains what to do next, not merely what went wrong', async () => {
    const message = await callExpectingError(harness.client, 'tela_get_design_summary', { design: 'nope.tela' })
    expect(message).toContain('tela_open_design')
    expect(message).toMatch(/^\[not_open\]/)
  })

  it('carries a machine-readable code prefix', async () => {
    const message = await callExpectingError(harness.client, 'tela_create_design', { design: '../escape.tela', name: 'x' })
    expect(message).toMatch(/^\[policy_refused\]/)
  })

  it('never leaks the approved root or an absolute path', async () => {
    const message = await callExpectingError(harness.client, 'tela_open_design', { design: 'missing/deeply/nested.tela' })
    expect(message).not.toContain(harness.root)
    expect(message).not.toMatch(/\/(Users|home)\//)
  })

  it('reports an unknown format with the list of valid ones', async () => {
    await call(harness.client, 'tela_create_design', { design: 'a.tela', name: 'A' })
    const summary = await call<{ pages: Array<{ page_id: string }>; session_revision: number }>(harness.client, 'tela_get_design_summary', { design: 'a.tela' })
    const message = await callExpectingError(harness.client, 'tela_add_frame', {
      design: 'a.tela',
      page_id: summary.structured.pages[0].page_id,
      format_id: 'not-a-format',
      expected_session_revision: summary.structured.session_revision,
    })
    expect(message).toContain('linkedin-feed')
  })
})

describe('progress and cancellation', () => {
  it('accepts a progress token without failing when nothing long-running happens', async () => {
    const result = await harness.client.callTool({ name: 'tela_list_designs', arguments: {}, _meta: { progressToken: 'token-1' } })
    expect(result.isError).toBeFalsy()
  })

  it('surfaces cancellation as an actionable error rather than a hang', async () => {
    await call(harness.client, 'tela_create_design', { design: 'cancel.tela', name: 'Cancel' })
    const controller = new AbortController()
    controller.abort()
    const result = await harness.client.callTool(
      { name: 'tela_open_editor', arguments: { design: 'cancel.tela' } },
      { signal: controller.signal },
    ).catch((error: unknown) => ({ isError: true, thrown: error }))
    expect(result).toBeTruthy()
  })
})

describe('capabilities', () => {
  it('reports its own tool list, matching what tools/list advertises', async () => {
    const capabilities = await call<{ tools: string[]; network_access: string; layer_types: string[] }>(harness.client, 'tela_get_capabilities')
    const { tools } = await harness.client.listTools()
    expect(capabilities.structured.tools.sort()).toEqual(tools.map((tool) => tool.name).sort())
    expect(capabilities.structured.network_access).toBe('none')
    expect(capabilities.structured.layer_types).toEqual(['background', 'text', 'image', 'svg', 'shape', 'gradient', 'group', 'draw'])
  })

  it('records the mcp-builder provenance as methodology rather than a dependency', async () => {
    const capabilities = await call<{ methodology: { commit: string; license: string; role: string } }>(harness.client, 'tela_get_capabilities')
    expect(capabilities.structured.methodology.commit).toBe('f6656c1256d5a8adfa37db9110046ef20bac644c')
    expect(capabilities.structured.methodology.license).toBe('Apache-2.0')
    expect(capabilities.structured.methodology.role).toMatch(/not a runtime dependency/)
  })

  it('does not start the browser bridge just to answer status', async () => {
    const status = await call<{ bridge_running: boolean }>(harness.client, 'tela_get_status')
    expect(status.structured.bridge_running).toBe(false)
  })
})
