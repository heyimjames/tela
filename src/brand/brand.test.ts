/**
 * The Pyrito brand invariants, as checks rather than as claims (CLI-561).
 *
 * The rebrand's acceptance criteria are mostly greppable statements — "no hex
 * outside the documented token set", "edge-cyan only inside the supplied mark",
 * "no user-visible HiveMind string". A wrap-up comment asserting those is a
 * claim that decays the first time someone adds a colour. This file is the same
 * statements, executed.
 *
 * Every detector here is paired with a negative control that plants an offender
 * and requires the detector to find exactly it. A scan that reports "clean" is
 * otherwise a fact about the regex, not about the repo (the Lessons Log's
 * `data_type = 'character'` lesson), and an assertion that cannot fail is worse
 * than none because it mints a false record.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { BRAND } from '@/brand/brand.config'
import { BRAND_GROUPS, BRAND_PALETTE, AI_BRAND_COLOR_LIST } from '@/brand/palette'
import { CHROME_ACCENT, CHROME_SIGNAL } from '@/brand/chrome'
import { ANCHOR_HUES, BRAND_HUE_BAND, MAX_HUE_EXCURSION, cardGradient } from '@/lib/cardGradient'
import { ACTIVE_BRAND_THEME } from '@/brand/theme'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

/**
 * The kit's colour tokens (pyrito-brand.compact.json → colors.tokens), lower
 * cased for comparison. This list is the *definition* of "documented"; nothing
 * in the app may introduce a value outside it.
 */
const KIT_TOKENS = {
  ink: '#0b0f0e',
  abyss: '#07262b',
  'teal-50': '#dae9e6',
  'teal-100': '#97c4bd',
  'teal-300': '#5ba89a',
  teal: '#1f7a82',
  'teal-700': '#0f4a52',
  ember: '#f86b3c',
  'edge-cyan': '#46e5da',
  'facet-mid': '#0b333a',
  'off-white': '#f4f6f5',
  white: '#ffffff',
} as const

/** Reserved to the D20 by `color.edge-cyan-restricted` (must_not). */
const MARK_ONLY = [KIT_TOKENS['edge-cyan'], KIT_TOKENS['facet-mid']]

const HEX = /#[0-9a-fA-F]{3,8}\b/g

/** Every hex literal in a source string, lower-cased and 8-digit alpha stripped. */
function hexesIn(source: string): string[] {
  return (source.match(HEX) ?? []).map((hex) => hex.toLowerCase().slice(0, 7))
}

describe('the chrome paints only documented colours', () => {
  const css = read('../index.css')

  it('introduces no hex outside the kit token set', () => {
    const documented = new Set(Object.values(KIT_TOKENS))
    const found = hexesIn(css)

    // Non-vacuity first: a stylesheet we failed to read reports clean.
    expect(found.length).toBeGreaterThan(5)
    expect([...new Set(found)].filter((hex) => !documented.has(hex))).toEqual([])
  })

  it('detects an undocumented hex when one is present', () => {
    // The negative control. Without it, the assertion above is a fact about
    // `HEX` and about the token list, not about the stylesheet.
    const documented = new Set(Object.values(KIT_TOKENS))
    const planted = `${css}\n.planted { color: #ff00ff; }`

    expect([...new Set(hexesIn(planted))].filter((hex) => !documented.has(hex))).toEqual(['#ff00ff'])
  })

  it('keeps the D20-only colours out of the stylesheet entirely', () => {
    // Including out of the comments: the criterion is grep-verifiable, and a
    // grep cannot tell a comment from a declaration.
    for (const reserved of MARK_ONLY) expect(css.toLowerCase()).not.toContain(reserved)
  })

  it('names Ink as the application ground and Abyss as the lifted surface', () => {
    // The two `must` colour rules, read off the tokens rather than off a
    // screenshot: `color.ink-surface` and `color.abyss-depth`.
    expect(css).toMatch(/--ground:\s*var\(--pyrito-ink\)/)
    expect(css).toMatch(/--surface:\s*var\(--pyrito-abyss\)/)
    expect(css).toMatch(/--background:\s*var\(--ground\)/)
  })

  it('leads every interaction token with the teal ramp', () => {
    // `color.teal-leads` (must). Each of these is an interaction surface the
    // rule names: actions, focus, links, selection.
    for (const token of ['--primary', '--ring', '--link', '--sidebar-primary', '--sidebar-ring']) {
      const declaration = new RegExp(`${token}:\\s*var\\(--pyrito-(teal[\\w-]*)\\)`)
      expect(css, `${token} must be a teal-ramp token`).toMatch(declaration)
    }
  })

  it('keeps Ember off every background field', () => {
    // `color.ember-no-fields` (must_not). Ember may be a destructive control or
    // a chart series; it may not be a canvas, panel, popover, or card.
    for (const field of ['--background', '--card', '--popover', '--surface', '--ground', '--sidebar']) {
      const declaration = new RegExp(`${field}:\\s*var\\(--pyrito-ember\\)`)
      expect(css, `${field} must not be Ember`).not.toMatch(declaration)
    }
    expect(css).toMatch(/--destructive:\s*var\(--pyrito-ember\)/)
  })

  it('declares the documented type stacks and fetches no font for them', () => {
    // `type.interface` / `type.fallbacks` (must). The brand faces are named
    // first and the documented fallbacks carry everyone else; an @font-face or
    // an @import added to make them resolve would be a network fetch inside a
    // payload contractually forbidden from making one.
    expect(css).toMatch(/--font-sans:\s*'Cal Sans UI', ui-sans-serif, system-ui, sans-serif;/)
    expect(css).toMatch(/--font-heading:\s*'Cal Sans Heading', var\(--font-sans\);/)
    expect(css).toMatch(
      /--font-mono:\s*'Paper Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;/,
    )
    // A *declaration*, not the word: this file talks about @font-face in prose
    // precisely to warn the next person off adding one, and a detector that
    // cannot tell the warning from the thing it warns about would fail on its
    // own documentation.
    const declarations = (source: string) => source.match(/@font-face\s*\{/g) ?? []
    expect(declarations(css)).toEqual([])
    expect(declarations(`${css}\n@font-face { font-family: "Cal Sans UI"; src: url(x.woff2); }`)).toHaveLength(1)

    // `@import "@fontsource-variable/inter"` is a bare-specifier import Vite
    // resolves at build time out of node_modules — a bundled file, not a
    // request. `@import url(…)` is the form that would reach the network.
    expect(css).not.toMatch(/@import\s+url\(/)
    expect(css).not.toMatch(/@import\s+["']https?:/)
  })
})

describe('the supplied brand assets are used verbatim', () => {
  const mark = read('../assets/brand/pyrito-d20.svg')
  const lockups = {
    dark: read('../assets/brand/pyrito-design-register-dark.svg'),
    light: read('../assets/brand/pyrito-design-register-light.svg'),
  }

  /** The mark's drawing instructions, ignoring whitespace and attribute order. */
  const geometryOf = (svg: string) =>
    [...svg.matchAll(/<(polygon|path)\b[^>]*>/g)]
      .map(([tag]) => tag.replace(/\s+/g, ' ').toLowerCase())
      .sort()

  it('embeds the same D20 in the mark and in both lockups', () => {
    // The lockups carry their own copy of the mark. If the kit ever ships a
    // revised D20 and only some assets are refreshed, this is what notices.
    const master = geometryOf(mark)
    expect(master.length).toBe(12)
    for (const [variant, svg] of Object.entries(lockups)) {
      const inner = geometryOf(svg).filter((tag) => master.includes(tag))
      expect(inner, `${variant} lockup must contain the master D20`).toEqual(master)
    }
  })

  it('still ships the mark as the favicon art', () => {
    // `public/d20-flat.svg` predates the kit but draws the identical mark, which
    // is why index.html can point at it and the rebrand needs no new raster.
    // Expressed as <line> elements rather than the master's two <path>s, so the
    // comparison is over the geometry both forms agree on: the facet polygons.
    const favicon = read('../../public/d20-flat.svg')
    const polygons = (svg: string) =>
      [...svg.matchAll(/<polygon\b[^>]*>/g)].map(([tag]) => tag.replace(/\s+/g, ' ').toLowerCase()).sort()

    expect(polygons(favicon).length).toBe(10)
    expect(polygons(favicon)).toEqual(polygons(mark))
  })

  it('leaves the fixed colours of the mark untouched', () => {
    // `identity.fixed-mark-colors` (must_not): no recolouring. The mark is the
    // one place edge-cyan and facet-mid are allowed — and it must actually
    // still contain them, or "recoloured" would pass as "clean".
    for (const reserved of MARK_ONLY) expect(mark.toLowerCase()).toContain(reserved)
  })

  it('keeps the light and dark lockups identical apart from their ink', () => {
    // `surface.fixed-details` (must): the Teal rule and Ember square are fixed
    // across variants; only the wordmark and identifier colour changes.
    for (const svg of Object.values(lockups)) {
      expect(svg).toContain(`fill="${'#1F7A82'}"`) // the Teal rule
      expect(svg).toContain(`fill="${'#F86B3C'}"`) // the Ember terminal square
      expect(svg).toContain('>Pyrito<')
      expect(svg).toContain('>DESIGN<') // `surface.identifier-uppercase` (must)
    }
    expect(lockups.dark).toContain(`fill: ${KIT_TOKENS['off-white'].toUpperCase()}`)
    expect(lockups.light).toContain(`fill: ${KIT_TOKENS.ink.toUpperCase()}`)
  })

  it('embeds its own typefaces rather than fetching them', () => {
    // The lockups are the one place the brand faces actually render. They do it
    // from `data:` URIs, so the zero-network contract holds; a `src: url("http…`
    // would be a request from inside an <img>, which no test in tests/network
    // would see because the probe drives the app, not the asset.
    for (const [variant, svg] of Object.entries(lockups)) {
      expect(svg, `${variant} must embed its faces`).toContain('src: url("data:font/woff2;base64,')
      expect(svg, `${variant} must fetch nothing`).not.toMatch(/url\(\s*"?https?:/)
    }
  })
})

describe('the app presents Pyrito and only Pyrito', () => {
  it('carries no retired brand name in anything the user reads', () => {
    const surfaces = {
      'index.html': read('../../index.html'),
      'brand.config.ts': read('./brand.config.ts'),
      'palette.ts': read('./palette.ts'),
      'index.css': read('../index.css'),
    }

    for (const [name, source] of Object.entries(surfaces)) {
      expect(source.toLowerCase(), `${name} still names the retired brand`).not.toContain('hivemind')
    }
  })

  it('names the product Pyrito Design with no endorsement subline', () => {
    // `identity.no-endorsement` / `identity.no-subline` (must_not). The pipe is
    // the specific shape the retired identity used, and the lockup component no
    // longer splits on one — a name containing it would render as plain text
    // while the asset kept saying something else.
    expect(BRAND.productName).toBe('Pyrito Design')
    expect(BRAND.productName).not.toContain('|')
    expect(BRAND.displayName).not.toContain('|')
    for (const value of Object.values(BRAND.ai)) expect(value.toLowerCase()).not.toContain('hivemind')
  })

  it('brands the sign-in and repository entry surfaces as Pyrito Design', () => {
    const login = read('../workspace/components/LoginScreen.tsx')
    const readme = read('../../README.md')
    const packageJson = JSON.parse(read('../../package.json')) as {
      description: string
      homepage: string
      repository: { url: string }
    }

    expect(login).toContain('Pyrito Design workspaces.')
    expect(readme).toMatch(/^# Pyrito Design$/m)
    expect(packageJson.description).toContain('Pyrito Design')
    expect(packageJson.homepage).toBe('https://github.com/Pyrito-ai/pyrito-design')
    expect(packageJson.repository.url).toBe('https://github.com/Pyrito-ai/pyrito-design.git')
  })

  it('resolves the editor chrome accents to documented brand values', () => {
    expect(CHROME_ACCENT.toLowerCase()).toBe(KIT_TOKENS.teal)
    expect(CHROME_SIGNAL.toLowerCase()).toBe(KIT_TOKENS.ember)
  })

  it('offers no retired division colour in the picker or to the model', () => {
    // The retired sibling-division accents stay resolvable for documents that
    // already reference them, and unreachable for everything else.
    const offered = new Set(BRAND_GROUPS.map((group) => group.id as string))
    expect(offered.has('legacy')).toBe(false)

    for (const key of ['accent-1', 'accent-2']) {
      expect(BRAND_PALETTE[key], `${key} must stay resolvable`).toBeDefined()
      expect(BRAND_PALETTE[key].group).toBe('legacy')
      expect(AI_BRAND_COLOR_LIST).not.toContain(BRAND_PALETTE[key].hex)
    }
    // The control: a group that IS offered does reach the model, so the
    // absences above are absences from a roster that exists.
    expect(AI_BRAND_COLOR_LIST).toContain(BRAND_PALETTE['brand-primary'].hex)
  })

  it('pins the brand ramp to the kit values', () => {
    const ramp = {
      'brand-wash': KIT_TOKENS['teal-50'],
      'brand-accent': KIT_TOKENS['teal-100'],
      'brand-mid': KIT_TOKENS['teal-300'],
      'brand-primary': KIT_TOKENS.teal,
      'brand-dark': KIT_TOKENS['teal-700'],
      'brand-ink': KIT_TOKENS.abyss,
    }
    for (const [key, hex] of Object.entries(ramp)) {
      expect(BRAND_PALETTE[key].hex.toLowerCase(), `${key} must be a kit ramp value`).toBe(hex)
    }
  })
})

describe('generated colour stays inside the brand band', () => {
  /**
   * The hex scan above cannot see this file, and that is the point.
   * `cardGradient` emits `oklch()` with the hue as a *number of degrees*, so a
   * library card washed in violet contains no hex at all and every hex-shaped
   * check in this suite reports clean while the card is plainly off-brand. That
   * is exactly what happened: the anchor list carried perf lime (128°), studio
   * violet (300°), indigo (255°) and rose (350°) over from the retired division
   * system, and the rebrand's grep-based criteria could not have found them.
   *
   * So this asserts the property directly, on the generator's real output rather
   * than on its constants — a renamed or inlined constant cannot dodge it.
   */
  const hues = (css: string) =>
    [...css.matchAll(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/g)].map(([, degrees]) => Number(degrees))

  const SEEDS = Array.from({ length: 400 }, (_, index) => `card-${index}`)

  it('emits no hue outside the ramp band, across many seeds', () => {
    const seen = SEEDS.flatMap((seed) => hues(cardGradient(seed)))

    // Non-vacuity: a generator that emitted nothing, or a regex that matched
    // nothing, would otherwise pass this with an empty set.
    expect(seen.length).toBeGreaterThan(SEEDS.length * 4)

    const low = BRAND_HUE_BAND.min - MAX_HUE_EXCURSION
    const high = BRAND_HUE_BAND.max + MAX_HUE_EXCURSION
    const strays = [...new Set(seen.filter((hue) => hue < low || hue > high))].sort((a, b) => a - b)
    expect(strays, `hues outside ${low}–${high}°`).toEqual([])
  })

  it('anchors every band on the documented ramp itself', () => {
    // The excursion bound above tolerates ±13°, so it alone would accept an
    // anchor that sits just off the ramp. This pins the anchors themselves.
    for (const anchor of ANCHOR_HUES) {
      expect(anchor, `anchor ${anchor}° must sit on the ramp`).toBeGreaterThanOrEqual(BRAND_HUE_BAND.min)
      expect(anchor, `anchor ${anchor}° must sit on the ramp`).toBeLessThanOrEqual(BRAND_HUE_BAND.max)
    }
  })

  it('detects an off-band hue when one is present', () => {
    // The control. Without it, the empty `strays` above is a fact about the
    // regex — and the regex is the part that a change of colour syntax breaks.
    const planted = 'radial-gradient(70% 70% at 1% 2%, oklch(0.670 0.145 300.0) 0%, transparent 48%)'
    const low = BRAND_HUE_BAND.min - MAX_HUE_EXCURSION
    const high = BRAND_HUE_BAND.max + MAX_HUE_EXCURSION

    expect(hues(planted)).toEqual([300])
    expect(hues(planted).filter((hue) => hue < low || hue > high)).toEqual([300])
  })

  it('still varies the wash, so the band is a constraint and not a flattening', () => {
    // A generator hard-wired to one colour would satisfy every assertion above.
    const distinct = new Set(SEEDS.map((seed) => cardGradient(seed)))
    expect(distinct.size).toBeGreaterThan(SEEDS.length / 2)
    expect(new Set(SEEDS.flatMap((seed) => hues(cardGradient(seed)))).size).toBeGreaterThan(10)
  })
})

describe('the theme seam', () => {
  it('agrees with the ramp the stylesheet actually declares', () => {
    // One theme ships. `ACTIVE_BRAND_THEME` is what picks the lockup variant, so
    // if it ever disagrees with the stylesheet the lockup goes light on an Ink
    // panel. When a light mode lands, both sides move together or this fails.
    const css = read('../index.css')
    expect(ACTIVE_BRAND_THEME).toBe('dark')
    expect(css).toMatch(/color-scheme:\s*dark/)
  })
})
