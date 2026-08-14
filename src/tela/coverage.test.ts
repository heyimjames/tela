/**
 * Fixture coverage.
 *
 * The round-trip suite is only as strong as the fixture it round-trips. This test
 * closes that gap: it derives the complete set of property names the schema can
 * describe and asserts the fixture actually carries each one. Add a field to the
 * schema and forget to exercise it, and this fails — which is the difference
 * between "the round trip passes" and "the round trip passes for everything".
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { telaDocumentSchema, layerSchema } from './schema'
import { makeFullCoverageDocument } from './__fixtures__/fullCoverage'

/** Every property name reachable anywhere in a JSON Schema. */
function schemaPropertyNames(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const child of node) schemaPropertyNames(child, out)
    return out
  }
  if (!node || typeof node !== 'object') return out
  const record = node as Record<string, unknown>

  if (record.properties && typeof record.properties === 'object') {
    for (const key of Object.keys(record.properties)) out.add(key)
    for (const value of Object.values(record.properties)) schemaPropertyNames(value, out)
  }
  for (const key of ['items', 'anyOf', 'oneOf', 'allOf', '$defs', 'definitions', 'additionalProperties', 'prefixItems', 'propertyNames', 'patternProperties']) {
    if (record[key]) schemaPropertyNames(record[key], out)
  }
  return out
}

/** Every property name that actually appears in a value. */
function valuePropertyNames(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const child of node) valuePropertyNames(child, out)
    return out
  }
  if (!node || typeof node !== 'object') return out
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out.add(key)
    valuePropertyNames(value, out)
  }
  return out
}

describe('the fixture exercises the whole schema', () => {
  const declared = schemaPropertyNames(z.toJSONSchema(telaDocumentSchema, { io: 'output' }))
  const present = valuePropertyNames(makeFullCoverageDocument())

  it('names every property the schema declares', () => {
    const missing = [...declared].filter((name) => !present.has(name)).sort()
    expect(missing, `fixture is missing: ${missing.join(', ')}`).toEqual([])
  })

  it('covers every layer type twice: once fully populated, once bare', () => {
    const layerTypes = layerSchema.options.map((option) => option.shape.type.value)
    expect(layerTypes.sort()).toEqual(
      ['background', 'draw', 'gradient', 'group', 'image', 'shape', 'svg', 'text'].sort(),
    )

    const document = makeFullCoverageDocument()
    const frames = (document.pages as Array<{ frames: Array<{ layers: Array<{ type: string; id: string }> }> }>)[0].frames
    const rich = frames[0].layers
    const plain = frames[1].layers

    for (const type of layerTypes) {
      expect(rich.some((l) => l.type === type), `rich variant missing ${type}`).toBe(true)
      expect(plain.some((l) => l.type === type), `plain variant missing ${type}`).toBe(true)
    }

    // The "bare" variant must genuinely omit the optional base properties —
    // otherwise it is not testing the absent-field path at all.
    for (const layer of plain) {
      for (const optional of ['shadow', 'blur', 'constraints', 'flipH', 'flipV', 'groupId', 'layoutGrow', 'aspectRatioLocked']) {
        expect(optional in layer, `plain ${layer.type} should omit ${optional}`).toBe(false)
      }
    }
  })

  it('covers every accepted asset MIME type', () => {
    const document = makeFullCoverageDocument()
    const text = JSON.stringify(document)
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'font/woff2']) {
      expect(text, `fixture never uses ${mime}`).toContain(`data:${mime};base64,`)
    }
  })

  it('covers every background fill variant', () => {
    const text = JSON.stringify(makeFullCoverageDocument())
    for (const type of ['"type":"solid"', '"type":"gradient"', '"type":"image"', '"type":"shader"']) {
      expect(text).toContain(type)
    }
  })

  it('covers more than one page, a frame with no layers, and loose elements', () => {
    const document = makeFullCoverageDocument()
    const pages = document.pages as Array<{ frames: Array<{ layers: unknown[] }>; looseElements: unknown[] }>
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.some((p) => p.frames.some((f) => f.layers.length === 0))).toBe(true)
    expect(pages.some((p) => p.looseElements.length > 0)).toBe(true)
    expect(pages.some((p) => p.looseElements.length === 0)).toBe(true)
  })
})
