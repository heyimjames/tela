/**
 * What the shipped chrome actually renders (CLI-561).
 *
 * `src/brand/brand.test.ts` reads the sources and proves they *say* the right
 * thing. This suite boots the default-mode production build and asks the browser
 * what it *did*, because the two can disagree in ways no source scan sees: a
 * token can be declared and then shadowed, a `color-mix()` the parser rejects
 * degrades to nothing rather than to an error, and an `<img>`-hosted SVG can
 * decline to use the font embedded inside it and fall back in silence.
 *
 * Every assertion below is over a computed value or a rendered bitmap. Where an
 * assertion could pass vacuously — an element that never appeared, a comparison
 * between two things that are equal for the wrong reason — it is paired with the
 * control that makes the vacuous case fail.
 */

import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

/** The kit's colours as 8-bit channels — the form every assertion compares in. */
const KIT = {
  ink: [11, 15, 14],
  abyss: [7, 38, 43],
  teal: [31, 122, 130],
  teal300: [91, 168, 154],
  teal100: [151, 196, 189],
  offWhite: [244, 246, 245],
  ember: [248, 107, 60],
} as const

const EDGE_CYAN = [70, 229, 218] as const

const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 16)

type Rgba = [number, number, number, number]

/**
 * Resolve a `:root` custom property to 8-bit channels, the way a component
 * consuming it would.
 *
 * Two things here are load-bearing. Resolving *through* a style property rather
 * than reading the raw declaration forces the browser to parse the value, so a
 * malformed `color-mix()` surfaces as transparent here instead of rendering as
 * nothing in the app. And the result is rasterised through a canvas rather than
 * string-matched, because Chromium reports a `color-mix()` in the syntax it was
 * computed in — `color(srgb 0.034 0.18 0.2)`, not `rgb(9, 46, 52)` — so a
 * comparison against an `rgb(...)` literal would fail on exactly the derived
 * steps this suite exists to check, and a naive digit-scrape would silently
 * read "0", "0343529" as channel values.
 */
async function channels(page: import('@playwright/test').Page, name: string): Promise<Rgba> {
  return page.evaluate((property) => {
    const probe = document.createElement('div')
    probe.style.color = `var(${property})`
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    probe.remove()

    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = computed
    context.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
    return [r, g, b, a] as [number, number, number, number]
  }, name)
}

/** Compare only the colour, and only once it is known to be opaque. */
function expectColour(actual: Rgba, expected: readonly number[], what: string) {
  expect(actual[3], `${what} must be opaque, not an unparsed value`).toBe(255)
  expect([actual[0], actual[1], actual[2]], what).toEqual([...expected])
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('[data-brand-lockup]')
})

test('the app is Pyrito Design', async ({ page }) => {
  await expect(page).toHaveTitle(/^Pyrito Design\b/)
  // The retired identity must be absent from what the user can read, not merely
  // absent from the sources — a persisted store or a stale bundle would show up
  // here and nowhere else.
  const text = await page.locator('body').innerText()
  expect(text.toLowerCase()).not.toContain('hivemind')
  expect(text).toContain('Pyrito Design')
})

test('the canvas is Ink and the panels are Abyss', async ({ page }) => {
  // `color.ink-surface` (must) and `color.abyss-depth` (should), measured off
  // the rendered document rather than off the stylesheet.
  const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(body).toBe('rgb(11, 15, 14)')

  expectColour(await channels(page, '--background'), KIT.ink, '--background is Ink')
  expectColour(await channels(page, '--foreground'), KIT.offWhite, '--foreground is Off-white')
  expectColour(await channels(page, '--card'), KIT.abyss, '--card is Abyss')
})

test('the derived surface ramp parses and lifts monotonically', async ({ page }) => {
  // The `color-mix()` steps are the one part of the ramp that is computed rather
  // than declared. If a browser or a build step ever rejects them, the tokens
  // resolve to nothing and every panel silently flattens onto the ground — which
  // an equality assertion against a hex would not catch, because there is no hex
  // to compare. So this measures the property that matters: each step is a real
  // colour, and each is lighter than the one below it.
  const steps = ['--ground', '--surface', '--surface-float', '--surface-hover', '--hairline']
  const luminance: number[] = []

  for (const step of steps) {
    const [r, g, b, a] = await channels(page, step)
    // An unparsed custom property computes to transparent, and a transparent
    // panel is invisible rather than wrong — so opacity is checked before the
    // colour is used for anything.
    expect(a, `${step} must resolve to a real, opaque colour`).toBe(255)
    luminance.push(0.2126 * r + 0.7152 * g + 0.0722 * b)
  }

  for (let i = 1; i < luminance.length; i += 1) {
    expect(luminance[i], `${steps[i]} must sit above ${steps[i - 1]}`).toBeGreaterThan(luminance[i - 1])
  }
})

test('Teal leads interaction and Ember stays off the fields', async ({ page }) => {
  // `color.teal-leads` (must): actions, focus and links all come off the teal
  // ramp. They are three different steps of it because a fill, a focus ring and
  // body text need different contrast on the same ground.
  expectColour(await channels(page, '--primary'), KIT.teal, '--primary is Teal')
  expectColour(await channels(page, '--ring'), KIT.teal300, '--ring is Teal 300')
  expectColour(await channels(page, '--link'), KIT.teal100, '--link is Teal 100')

  // `color.ember-sparse` / `color.ember-no-fields`: Ember is the destructive
  // affordance and nothing larger.
  expectColour(await channels(page, '--destructive'), KIT.ember, '--destructive is Ember')
  for (const field of ['--background', '--card', '--popover', '--sidebar']) {
    const [r, g, b] = await channels(page, field)
    expect([r, g, b], `${field} must not be Ember`).not.toEqual([...KIT.ember])
  }
})

test('Edge Cyan appears nowhere in the chrome', async ({ page }) => {
  // `color.edge-cyan-restricted` (must_not) — it is D20 linework only. The mark
  // is an <img>, so its cyan lives inside the asset and never reaches a computed
  // style here. Anything this finds is a real leak into the interface.
  const leaks = await page.evaluate((cyan) => {
    const properties = ['color', 'backgroundColor', 'borderTopColor', 'outlineColor', 'fill', 'stroke'] as const
    return [...document.querySelectorAll('*')]
      .filter((element) => {
        const computed = getComputedStyle(element)
        return properties.some((property) => computed[property] === cyan)
      })
      .map((element) => element.tagName + (element.className ? `.${String(element.className).slice(0, 40)}` : ''))
  }, `rgb(${EDGE_CYAN.join(', ')})`)
  expect(leaks).toEqual([])

  // The control: the same sweep must be able to see that colour when it is
  // really there, or the empty result above is a fact about the sweep.
  const planted = await page.evaluate((cyan) => {
    const element = document.createElement('div')
    element.style.color = cyan
    element.id = 'planted-cyan'
    document.body.appendChild(element)
    const found = [...document.querySelectorAll('*')].filter((node) => getComputedStyle(node).color === cyan).length
    element.remove()
    return found
  }, `rgb(${EDGE_CYAN.join(', ')})`)
  expect(planted).toBe(1)
})

test('the chrome asks for the brand faces and fetches none of them', async ({ page }) => {
  // `type.interface` and `type.fallbacks` (must). The named faces are not
  // installed on CI, so what this pins is the *stack*: the brand face is asked
  // for first, and the documented fallbacks are behind it to carry the render.
  const stacks = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    mono: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim(),
  }))
  expect(stacks.body).toContain('Cal Sans UI')
  expect(stacks.body).toContain('system-ui')
  expect(stacks.mono).toContain('Paper Mono')
  expect(stacks.mono).toContain('ui-monospace')

  // And nothing went to the network for them. A webfont fetch would also trip
  // the zero-network probe; this states it where the type is the subject.
  const fontRequests = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((entry) => /\.(woff2?|ttf|otf)(\?|$)/.test(entry.name))
      .filter((entry) => !entry.name.startsWith(location.origin))
      .map((entry) => entry.name),
  )
  expect(fontRequests).toEqual([])
})

test('the Design Register lockup renders, in the variant the theme calls for', async ({ page }, testInfo) => {
  const lockup = page.locator('[data-brand-lockup]').first()
  await expect(lockup).toBeVisible()

  // The dark variant, because the chrome is Ink — `surface_lockups.variants`.
  await expect(lockup).toHaveAttribute('data-brand-lockup', 'dark')
  expect(await lockup.getAttribute('src')).toMatch(/pyrito-design-register-dark[\w.-]*\.svg$/)
  await expect(lockup).toHaveAttribute('alt', 'Pyrito Design')

  // Decoded, not merely present: a 404'd <img> is still visible and still
  // carries every attribute asserted above.
  const decoded = await lockup.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)
  expect(decoded).toBe(true)

  const mark = page.locator('[data-brand-mark="pyrito-d20"]').first()
  if (await mark.count()) {
    expect(await mark.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  }

  await testInfo.attach('library-dark.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  })
})

test('the lockup renders its own embedded typefaces', async ({ page }) => {
  // The check the brand depends on and the one most able to fail silently: if
  // Chromium ignored the `data:` woff2 inside the SVG, the wordmark would render
  // in a fallback sans and look almost right.
  //
  // So it is a contrast, never an assertion that something was drawn. The same
  // asset is rendered twice — as shipped, and with its `@font-face` rules
  // stripped so the fallback stack must carry it. Identical bitmaps mean the
  // embedded faces did nothing.
  const source = await page.evaluate(async () => {
    const img = document.querySelector('[data-brand-lockup]') as HTMLImageElement
    return (await fetch(img.src)).text()
  })
  expect(source).toContain('@font-face')

  const stripped = source.replace(/@font-face\s*\{[^}]*\}/g, '')
  const broken = source.replace(
    /src: url\("data:font\/woff2;base64,[A-Za-z0-9+/=]+"\)/g,
    'src: url("data:font/woff2;base64,AAAA")',
  )

  async function render(svg: string): Promise<string> {
    const uri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
    await page.setContent(
      `<body style="margin:0;background:#0B0F0E"><img id="subject" src="${uri}" width="680" height="216"></body>`,
    )
    await page.waitForFunction(() => {
      const img = document.getElementById('subject') as HTMLImageElement
      return img.complete && img.naturalWidth > 0
    })
    return sha(await page.locator('#subject').screenshot())
  }

  const shipped = await render(source)
  const fallback = await render(stripped)
  const unusable = await render(broken)

  // The subject: the embedded faces changed what was drawn.
  expect(shipped, 'the lockup fell back to a system font — its embedded faces did not render').not.toBe(fallback)
  // The control: the comparison can actually recognise a fallback render. Without
  // it, `shipped !== fallback` could be satisfied by any incidental difference.
  expect(unusable, 'a font that cannot be parsed must render as the fallback does').toBe(fallback)
})
