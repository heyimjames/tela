/**
 * Deterministic, on-brand OKLCH wash for library cards.
 *
 * Seeded off the card's id, so the gradient is varied but LOCKED to that
 * file/folder — same id → same gradient on every load.
 *
 * Design: each card is a *single hue band*, not a mix of clashing colours. We
 * pick one anchor hue, then build a light→deep ramp of that same hue (a "light
 * and a darker blue" + a soft near-white neutral), with a few degrees of hue
 * torsion for richness and a consistent, gamut-safe chroma. Interpolating in
 * OKLCH keeps the transitions clean — no muddy grey/brown midpoints — and the
 * layered radial blobs give a soft, premium mesh look with one richer focal
 * glow. Emitted as `oklch()` for the P3 gamut on capable displays.
 *
 * Why single-band: OKLCH hue arcs read best under ~30–90°; pulling colours from
 * opposite sides of the wheel (complementary / triad) is what made the old
 * random-harmony version look muddy.
 */

// --- seeded PRNG (FNV-1a → mulberry32) ---
function makeRng(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Anchor hues (OKLCH degrees) — every one of them measured off a Pyrito ramp
 * token, not chosen by eye.
 *
 * Converting the kit's core ramp to OKLCH puts the whole brand inside a single
 * narrow band: `teal-300` sits at 180.6°, `teal` at 203.8°, `teal-700` at
 * 208.5°, `abyss` at 210.1°. These five anchors span that band and nothing else.
 *
 * The list this replaces reached well outside it — perf lime at 128°, studio
 * violet at 300°, indigo at 255°, rose at 350° — carried over from the retired
 * division system, whose sibling brands were the reason those hues "belonged".
 * A standalone Pyrito allows exactly two general accents, Teal and Ember
 * (`color.no-invented-accents`, must_not), so a card washed in violet was the
 * most visible off-brand surface left in the app.
 *
 * Ember is deliberately absent even though it IS an allowed accent: a card's
 * wash is a dominant background field, and `color.ember-no-fields` (must_not)
 * rules Ember out of exactly that job. Ember stays where it is sparse — the
 * destructive control and the smart-guide signal.
 *
 * Variety now comes from lightness, chroma depth, blob layout and hue torsion
 * rather than from hue range, which is the more cohesive look anyway.
 *
 * Note these are *not* hex values, which is why the repo's hex-based brand scan
 * cannot police them: `src/brand/brand.test.ts` asserts this band by calling the
 * generator and reading the hues it actually emits.
 */
export const ANCHOR_HUES = [
  182, // teal-300 / teal-100 end of the ramp
  189,
  196,
  203, // teal itself
  209, // teal-700 / abyss end of the ramp
]

/** The ramp's own hue span, in OKLCH degrees — the bound the anchors respect. */
export const BRAND_HUE_BAND = { min: 180.6, max: 210.1 } as const

/**
 * The most an individual gradient stop may sit off its anchor: ±5° of per-card
 * jitter plus the ±8° of hue torsion applied across the light→deep ramp below.
 * Exported so the brand test bounds the *total* excursion rather than trusting
 * that the torsion constants never widen.
 */
export const MAX_HUE_EXCURSION = 13

const okl = (l: number, c: number, h: number) =>
  `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${(((h % 360) + 360) % 360).toFixed(1)})`

// A few blob layouts (percent positions for the focal/mid/light stops). A seed
// picks one; small jitter keeps repeats from looking identical.
const LAYOUTS: { focal: [number, number]; mid: [number, number]; light: [number, number]; angle: number }[] = [
  { focal: [78, 74], mid: [30, 30], light: [60, 88], angle: 155 },
  { focal: [22, 78], mid: [70, 32], light: [48, 20], angle: 200 },
  { focal: [26, 24], mid: [76, 66], light: [90, 20], angle: 135 },
  { focal: [74, 26], mid: [28, 70], light: [16, 30], angle: 165 },
  { focal: [50, 82], mid: [20, 26], light: [82, 40], angle: 180 },
]

/** CSS `background`: a soft single-band OKLCH wash with a richer focal glow. */
export function cardGradient(seed: string): string {
  const rng = makeRng(seed)

  // Anchor hue + a small per-card jitter so two cards on the same band still differ.
  const H = ANCHOR_HUES[Math.floor(rng() * ANCHOR_HUES.length)] + Math.round(rng() * 10 - 5)
  // Overall depth: some cards lean lighter/airier, some a touch deeper.
  const depth = 0.9 + rng() * 0.2 // 0.9..1.1 multiplier on chroma
  const c = (base: number) => +(base * depth).toFixed(3)

  // One hue band: light → deep, with gentle hue torsion (±8°) and rising chroma.
  const neutral = okl(0.958, c(0.012), H) // near-white, faintly tinted — breathing room
  const tint = okl(0.9, c(0.05), H + 8)
  const light = okl(0.84, c(0.088), H + 3)
  const mid = okl(0.76, c(0.12), H)
  const deep = okl(0.67, c(0.145), H - 8)

  const L = LAYOUTS[Math.floor(rng() * LAYOUTS.length)]
  const jit = (p: [number, number]): [number, number] => [
    Math.round(p[0] + (rng() * 8 - 4)),
    Math.round(p[1] + (rng() * 8 - 4)),
  ]
  const [fx, fy] = jit(L.focal)
  const [mx, my] = jit(L.mid)
  const [lx, ly] = jit(L.light)

  return [
    // Focal glow — smaller + deepest, one intentional bright spot.
    `radial-gradient(70% 70% at ${fx}% ${fy}%, ${deep} 0%, transparent 48%)`,
    // Mid wash — the main colour body.
    `radial-gradient(115% 105% at ${mx}% ${my}%, ${mid} 0%, transparent 60%)`,
    // Light lift — keeps the top airy.
    `radial-gradient(120% 120% at ${lx}% ${ly}%, ${light} 0%, transparent 64%)`,
    // Base: near-white neutral → soft tint, so the card never goes flat.
    `linear-gradient(${L.angle}deg, ${neutral}, ${tint})`,
  ].join(', ')
}
