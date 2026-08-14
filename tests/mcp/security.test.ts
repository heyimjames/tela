/**
 * Confinement and content-safety tests.
 *
 * These assert the *policy*, not the annotations. Every case here would succeed
 * against a server that merely declared itself safe, which is the point: an
 * `openWorldHint: false` is a statement of intent, and these are the checks that
 * make it a fact.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { call, callExpectingError, connectInProcess, type Harness } from './harness'
import { sanitizeSvg } from '../../src/mcp/sanitizeSvg'
import { TINY_PNG_BASE64 } from './abesFixture'

let harness: Harness

beforeEach(async () => {
  harness = await connectInProcess()
})

afterEach(async () => {
  await harness.close()
})

describe('approved-root confinement', () => {
  const escapes = [
    ['a parent traversal', '../outside.tela'],
    ['a nested traversal', 'campaigns/../../outside.tela'],
    ['an absolute POSIX path', '/tmp/outside.tela'],
    ['a drive-qualified path', 'C:\\Windows\\outside.tela'],
    ['a UNC path', '\\\\server\\share\\outside.tela'],
    ['a backslash traversal', '..\\outside.tela'],
  ] as const

  it.each(escapes)('refuses %s', async (_label, path) => {
    const message = await callExpectingError(harness.client, 'tela_create_design', { design: path, name: 'Escape' })
    expect(message).toMatch(/^\[policy_refused\]/)
    expect(message).toMatch(/approved root/)
  })

  it('refuses a path with a NUL byte', async () => {
    const message = await callExpectingError(harness.client, 'tela_create_design', { design: 'evil\0.tela', name: 'NUL' })
    expect(message).toMatch(/NUL|control characters/)
  })

  it('refuses a reserved Windows device name in any segment', async () => {
    const message = await callExpectingError(harness.client, 'tela_create_design', { design: 'con/design.tela', name: 'Reserved' })
    expect(message).toMatch(/reserved/)
  })

  it('refuses to read an asset through a symlink pointing outside the root', async () => {
    const outside = join(tmpdir(), `tela-outside-${Date.now()}.png`)
    await writeFile(outside, Buffer.from(TINY_PNG_BASE64, 'base64'))
    await symlink(outside, join(harness.root, 'linked.png'))

    await call(harness.client, 'tela_create_design', { design: 'link.tela', name: 'Link' })
    const message = await callExpectingError(harness.client, 'tela_import_asset', {
      design: 'link.tela',
      source: 'linked.png',
      name: 'Linked',
      expected_session_revision: 0,
    })
    expect(message).toMatch(/symlink|reparse/)
  })

  it('refuses a symlinked directory component even when its target is inside the root', async () => {
    // The target being inside is not enough: a link can be repointed between the
    // check and the open, so links are refused on sight rather than resolved.
    await mkdir(join(harness.root, 'real'), { recursive: true })
    await symlink(join(harness.root, 'real'), join(harness.root, 'aliased'))
    const message = await callExpectingError(harness.client, 'tela_create_design', { design: 'aliased/inner.tela', name: 'Aliased' })
    expect(message).toMatch(/symlink|reparse/)
  })

  it('refuses a design path that is not a .tela file', async () => {
    const message = await callExpectingError(harness.client, 'tela_create_design', { design: 'notes.txt', name: 'Wrong' })
    expect(message).toMatch(/\.tela/)
  })

  it('confines exports to the approved root', async () => {
    await call(harness.client, 'tela_create_design', { design: 'export.tela', name: 'Export' })
    const summary = await call<{ pages: Array<{ frames: Array<{ frame_id: string }> }> }>(harness.client, 'tela_get_design_summary', { design: 'export.tela' })
    const message = await callExpectingError(harness.client, 'tela_export_frames', {
      design: 'export.tela',
      frame_ids: [summary.structured.pages[0].frames[0].frame_id],
      destination: '../../escaped',
    })
    // Refused for the path, before any browser is launched.
    expect(message).toMatch(/^\[policy_refused\]/)
  })
})

describe('SVG sanitization', () => {
  const hostile: Array<[string, string]> = [
    ['a script element', '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("http://x")</script></svg>'],
    ['an inline event handler', '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" width="1" height="1"/></svg>'],
    ['a foreignObject', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>hi</div></foreignObject></svg>'],
    ['an external image reference', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png"/></svg>'],
    ['a legacy xlink reference', '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="https://example.com/x.svg#a"/></svg>'],
    ['a javascript: URL', '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>'],
    ['a DOCTYPE entity declaration', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['a CSS @import', '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("https://example.com/x.css");</style></svg>'],
    ['a CSS url() pointing out', '<svg xmlns="http://www.w3.org/2000/svg"><style>rect{fill:url("https://example.com/x.png")}</style></svg>'],
    ['an iframe', '<svg xmlns="http://www.w3.org/2000/svg"><iframe src="https://example.com"/></svg>'],
  ]

  it.each(hostile)('refuses %s at the sanitizer', (_label, markup) => {
    expect(() => sanitizeSvg(markup)).toThrow()
  })

  it('accepts clean artwork, internal fragment references, and inline data images', () => {
    expect(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z" fill="#fff"/></svg>')).not.toThrow()
    expect(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><use href="#glyph"/><g id="glyph"><rect width="1" height="1"/></g></svg>')).not.toThrow()
    expect(() =>
      sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,${TINY_PNG_BASE64}"/></svg>`),
    ).not.toThrow()
  })

  it('refuses an oversized SVG', () => {
    const huge = `<svg xmlns="http://www.w3.org/2000/svg">${'<rect width="1" height="1"/>'.repeat(1)}</svg>`
    expect(() => sanitizeSvg(huge, { maxBytes: 10, maxElements: 100 })).toThrow(/over the/)
  })

  it('refuses an SVG with too many elements', () => {
    const many = `<svg xmlns="http://www.w3.org/2000/svg">${'<rect width="1" height="1"/>'.repeat(50)}</svg>`
    expect(() => sanitizeSvg(many, { maxBytes: 1_000_000, maxElements: 10 })).toThrow(/element limit|over the/)
  })

  it('refuses hostile SVG at the authoring tool, not only at the sanitizer', async () => {
    await call(harness.client, 'tela_create_design', { design: 'svgsec.tela', name: 'SVG security' })
    const summary = await call<{ pages: Array<{ frames: Array<{ frame_id: string }> }>; session_revision: number }>(
      harness.client,
      'tela_get_design_summary',
      { design: 'svgsec.tela' },
    )
    const message = await callExpectingError(harness.client, 'tela_add_layers', {
      design: 'svgsec.tela',
      frame_id: summary.structured.pages[0].frames[0].frame_id,
      expected_session_revision: summary.structured.session_revision,
      layers: [{ type: 'svg', svgContent: '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>', width: 10, height: 10 }],
    })
    expect(message).toMatch(/^\[policy_refused\]/)
    expect(message).toMatch(/script/)
  })
})

describe('asset content policy', () => {
  it('identifies a file by its content, not its extension', async () => {
    await call(harness.client, 'tela_create_design', { design: 'sniff.tela', name: 'Sniff' })
    // A PNG named .woff2 must still be seen as an image.
    await writeFile(join(harness.root, 'lying.woff2'), Buffer.from(TINY_PNG_BASE64, 'base64'))
    const imported = await call<{ mime: string }>(harness.client, 'tela_import_asset', {
      design: 'sniff.tela',
      source: 'lying.woff2',
      name: 'Lying',
      expected_session_revision: 0,
    })
    expect(imported.structured.mime).toBe('image/png')
  })

  it('refuses content that matches no accepted type', async () => {
    await call(harness.client, 'tela_create_design', { design: 'junk.tela', name: 'Junk' })
    await writeFile(join(harness.root, 'junk.png'), Buffer.from('not an image at all', 'utf8'))
    const message = await callExpectingError(harness.client, 'tela_import_asset', {
      design: 'junk.tela',
      source: 'junk.png',
      name: 'Junk',
      expected_session_revision: 0,
    })
    expect(message).toMatch(/accepted type|mime/i)
  })

  it('refuses a font import that is not WOFF2 even when the extension says otherwise', async () => {
    await call(harness.client, 'tela_create_design', { design: 'fontsec.tela', name: 'Font security' })
    await writeFile(join(harness.root, 'fake.woff2'), Buffer.from(TINY_PNG_BASE64, 'base64'))
    const message = await callExpectingError(harness.client, 'tela_import_font', {
      design: 'fontsec.tela',
      source: 'fake.woff2',
      family: 'Fake',
      license: 'OFL-1.1',
      expected_session_revision: 0,
    })
    expect(message).toMatch(/not WOFF2/)
  })
})

describe('no generic execution surface', () => {
  it('offers no tool that takes free-form code, a command, or a URL', async () => {
    const { tools } = await harness.client.listTools()
    for (const tool of tools) {
      const schema = tool.inputSchema as { properties?: Record<string, { description?: string }> }
      for (const [property, definition] of Object.entries(schema.properties ?? {})) {
        // A parameter named for code or a remote address would be a generic
        // execution or fetch surface no matter what the tool is called.
        expect(property, `${tool.name} accepts a suspicious parameter "${property}"`).not.toMatch(
          /^(code|script|js|javascript|eval|command|cmd|shell|exec|sql|url|uri|endpoint|host|port)$/i,
        )
        expect(definition.description ?? '', `${tool.name}.${property} advertises remote access`).not.toMatch(/https?:\/\/(?!schemas\.clickt\.ca|json-schema\.org|www\.w3\.org|github\.com)/)
      }
    }
  })

  it('keeps the internal editor command bus off the MCP surface', async () => {
    const { tools } = await harness.client.listTools()
    const names = tools.map((tool) => tool.name)
    // The internal bus ops that the browser bridge uses. None may be reachable.
    for (const internal of ['renderDocument', 'applyDocument', 'getSchema', 'getState', 'dispatch', 'relayoutFrame']) {
      expect(names, `internal bus op "${internal}" is exposed`).not.toContain(internal)
      expect(names, `internal bus op "${internal}" is exposed with a tela_ prefix`).not.toContain(`tela_${internal}`)
    }
    // And calling one by name is a protocol-level miss, not a silent dispatch.
    const result = await harness.client.callTool({ name: 'renderDocument', arguments: {} }).catch(() => ({ isError: true }))
    expect(result.isError).toBeTruthy()
  })

  it('declares no network access and advertises none', async () => {
    const capabilities = await call<{ network_access: string }>(harness.client, 'tela_get_capabilities')
    expect(capabilities.structured.network_access).toBe('none')
  })
})

describe('error scrubbing', () => {
  it('replaces the approved root with a placeholder rather than echoing it', async () => {
    const message = await callExpectingError(harness.client, 'tela_import_design', { source: 'nope.tela', design: 'target.tela' })
    expect(message).not.toContain(harness.root)
  })

  it('collapses any remaining absolute path to its basename', async () => {
    await call(harness.client, 'tela_create_design', { design: 'scrub.tela', name: 'Scrub' })
    const message = await callExpectingError(harness.client, 'tela_import_asset', {
      design: 'scrub.tela',
      source: 'no/such/file.png',
      name: 'Missing',
      expected_session_revision: 0,
    })
    expect(message).not.toMatch(/\/Users\/|\/home\/|\/private\/var/)
  })
})
