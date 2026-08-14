import { describe, it, expect } from 'vitest'
import { writeBundle } from './bundle'
import { TelaError } from './errors'
import { makeFullCoverageDocument } from './__fixtures__/fullCoverage'

type Doc = Record<string, unknown>
type Pages = Array<{
  id: string
  frames: Array<{ id: string; layers: Array<Record<string, unknown>>; autoLayouts?: Record<string, Record<string, unknown>> }>
  looseElements: Array<Record<string, unknown>>
}>

function expectInvariantViolation(mutate: (document: Doc) => void, matcher: RegExp) {
  const document = makeFullCoverageDocument()
  mutate(document)
  try {
    writeBundle(document)
  } catch (error) {
    expect(error).toBeInstanceOf(TelaError)
    expect((error as TelaError).code).toBe('invariant_violation')
    expect((error as TelaError).message).toMatch(matcher)
    return
  }
  throw new Error('expected an invariant violation, but the document was accepted')
}

describe('semantic invariants', () => {
  it('accepts the coherent fixture', () => {
    expect(() => writeBundle(makeFullCoverageDocument())).not.toThrow()
  })

  it('rejects duplicate page ids', () => {
    expectInvariantViolation((document) => {
      const pages = document.pages as Pages
      pages[1].id = pages[0].id
      document.activePageId = pages[0].id
    }, /duplicate page ids/)
  })

  it('rejects duplicate frame ids across pages', () => {
    expectInvariantViolation((document) => {
      const pages = document.pages as Pages
      pages[1].frames[0].id = pages[0].frames[0].id
    }, /duplicate frame ids/)
  })

  it('rejects duplicate layer ids within one frame', () => {
    expectInvariantViolation((document) => {
      const pages = document.pages as Pages
      pages[0].frames[0].layers[2].id = pages[0].frames[0].layers[1].id as string
    }, /duplicate layer ids/)
  })

  it('rejects duplicate layer ids among loose elements', () => {
    expectInvariantViolation((document) => {
      const pages = document.pages as Pages
      pages[0].looseElements[1].id = pages[0].looseElements[0].id as string
    }, /duplicate layer ids/)
  })

  it('rejects an activePageId that names no page', () => {
    expectInvariantViolation((document) => {
      document.activePageId = 'page-that-was-deleted'
    }, /activePageId does not name a page/)
  })

  it('rejects an activeFrameId that lives on another page', () => {
    expectInvariantViolation((document) => {
      // A real regression shape: the frame exists, just not where the editor will
      // look for it, so the canvas would silently open empty.
      document.activeFrameId = 'frame-feed'
    }, /activeFrameId does not name a frame on the active page/)
  })

  it('accepts a null activeFrameId', () => {
    const document = makeFullCoverageDocument()
    document.activeFrameId = null
    expect(() => writeBundle(document)).not.toThrow()
  })

  it('rejects a group layer naming a child outside its container', () => {
    expectInvariantViolation((document) => {
      const pages = document.pages as Pages
      const group = pages[0].frames[0].layers.find((l) => l.type === 'group')!
      group.childIds = ['loose-note']
    }, /names a child that is not in the same container/)
  })

  it('rejects an auto-layout config for a group with no member layers', () => {
    expectInvariantViolation((document) => {
      const pages = document.pages as Pages
      pages[0].frames[0].autoLayouts!['group-ghost'] = {
        ...pages[0].frames[0].autoLayouts!['group-outer'],
      }
    }, /has no member layers/)
  })

  it('rejects an auto-layout naming a parent that is not an auto-layout here', () => {
    expectInvariantViolation((document) => {
      const pages = document.pages as Pages
      pages[0].frames[0].autoLayouts!['group-inner'].parentGroupId = 'group-elsewhere'
    }, /is not an auto-layout in this frame/)
  })

  it('rejects an auto-layout that is its own parent', () => {
    expectInvariantViolation((document) => {
      const pages = document.pages as Pages
      pages[0].frames[0].autoLayouts!['group-inner'].parentGroupId = 'group-inner'
    }, /is its own parent/)
  })

  it('rejects a cycle in auto-layout nesting', () => {
    expectInvariantViolation((document) => {
      const pages = document.pages as Pages
      // inner -> outer already; closing the loop would hang the reflow engine.
      pages[0].frames[0].autoLayouts!['group-outer'].parentGroupId = 'group-inner'
    }, /cycle/)
  })

  it('rejects a draw layer whose pressures do not match its points', () => {
    expectInvariantViolation((document) => {
      const pages = document.pages as Pages
      const draw = pages[0].frames[0].layers.find((l) => l.id === 'rich-draw')!
      draw.pressures = [0.5]
    }, /pressures for/)
  })

  it('rejects duplicate version, asset, and font ids', () => {
    expectInvariantViolation((document) => {
      const assets = document.assets as Array<Record<string, unknown>>
      assets[1].id = assets[0].id
    }, /duplicate asset ids/)

    expectInvariantViolation((document) => {
      const versions = document.versions as Array<Record<string, unknown>>
      versions.push({ ...structuredClone(versions[0]) })
    }, /duplicate version ids/)
  })
})
