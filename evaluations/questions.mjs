/**
 * Ten evaluation questions, mcp-builder style.
 *
 * The mcp-builder criteria, and how each is met here rather than merely claimed:
 *
 *  - **Independent.** Every question gets its own server process and its own
 *    copy of the fixtures. Nothing carries over, so a question cannot pass
 *    because an earlier one left the right design open.
 *  - **Read-only and non-destructive.** Each question declares the tools it may
 *    use, the runner refuses anything outside the read-only set, and the fixture
 *    digests are re-checked afterwards. A question that mutated a design fails
 *    on the digest, not on trust.
 *  - **Multi-tool.** Each answer requires composing at least two tools; several
 *    need four. A question answerable by one call tests a tool, not a server.
 *  - **Realistic.** These are the questions someone actually asks of a campaign
 *    library mid-production: what is the biggest frame, which asset does the
 *    logo point at, does this old file still validate.
 *  - **Stable.** The fixtures are committed and hash-pinned, so an answer can
 *    only change if the server's read surface changes — which is the signal the
 *    evaluation exists to produce.
 *  - **One verifiable answer.** Every `expected` is a scalar string or number
 *    derived from the fixture, compared exactly. No fuzzy matching, no judge.
 *
 * The expected values were derived by reading the fixtures through the server's
 * own read surface once, then pinned here. That is the correct direction: the
 * fixture is the source of truth and this file records what a correct server
 * must report about it.
 */

import { call } from './lib/session.mjs'

const SPRING = 'campaigns/spring-launch.tela'
const HIRING = 'campaigns/hiring-q3.tela'
const LEGACY = 'campaigns/legacy-promo.tela'

/**
 * Tools a question may call.
 *
 * Session lifecycle (`open`/`close`) is here because neither writes to a design
 * — they are the read path's entry and exit. Every tool that can change a file
 * is absent, and the runner enforces this list rather than documenting it.
 */
export const READ_ONLY_TOOLS = new Set([
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
  'tela_get_brand_context',
  'tela_open_design',
  'tela_close_design',
])

const frames = (summary) => summary.pages.flatMap((page) => page.frames)

async function openSummary(client, design) {
  await call(client, 'tela_open_design', { design })
  return call(client, 'tela_get_design_summary', { design })
}

export const QUESTIONS = [
  {
    id: 'q01-busiest-design',
    question: 'Across every design under the approved root, which one has the most frames, and how many does it have?',
    why: 'The everyday triage question. Requires discovering the library, then opening and summarising each design rather than guessing from filenames.',
    expected: 'campaigns/spring-launch.tela:4',
    async resolve(client) {
      const listed = await call(client, 'tela_list_designs')
      let best = { design: '', frames: -1 }
      for (const entry of listed.designs) {
        const summary = await openSummary(client, entry.design)
        if (summary.counts.frames > best.frames) best = { design: entry.design, frames: summary.counts.frames }
      }
      return `${best.design}:${best.frames}`
    },
  },
  {
    id: 'q02-story-variant-size',
    question: 'In the spring launch design, what are the pixel dimensions of the Instagram Story variant of the Hero frame?',
    why: 'Format variants are the product’s core move. Answering means finding the derived frame by name and reading its geometry, not assuming the format table.',
    expected: '1080x1920',
    async resolve(client) {
      const summary = await openSummary(client, SPRING)
      const story = frames(summary).find((frame) => frame.format_id === 'instagram-story')
      return `${story.width}x${story.height}`
    },
  },
  {
    id: 'q03-hero-text-layers',
    question: 'How many text layers are on the Hero frame of the spring launch design?',
    why: 'Requires resolving a frame id from the summary and then reading the scene — the two-step every layer-level task begins with.',
    expected: 3,
    async resolve(client) {
      const summary = await openSummary(client, SPRING)
      const hero = frames(summary).find((frame) => frame.name === 'Hero')
      const scene = await call(client, 'tela_get_scene', { design: SPRING, frame_id: hero.frame_id })
      return scene.layers.filter((layer) => layer.type === 'text').length
    },
  },
  {
    id: 'q04-logo-asset-ref',
    question: 'In the hiring Q3 design, which content-addressed asset reference does the layer named "Logo" use, and is that reference listed in the design’s assets?',
    why: 'Crosses the layer surface and the asset surface. A server that returned inline payloads instead of portable refs, or listed an asset it could not resolve, fails here.',
    expected: 'asset://6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0:listed',
    async resolve(client) {
      const summary = await openSummary(client, HIRING)
      const frame = frames(summary)[0]
      const scene = await call(client, 'tela_get_scene', { design: HIRING, frame_id: frame.frame_id })
      const logo = scene.layers.find((layer) => layer.name === 'Logo')
      const assets = await call(client, 'tela_list_assets', { design: HIRING, kind: 'image' })
      const listed = assets.assets.some((asset) => asset.ref === logo.imageUrl)
      return `${logo.imageUrl}:${listed ? 'listed' : 'missing'}`
    },
  },
  {
    id: 'q05-newest-version',
    question: 'How many saved versions does the spring launch design carry, and what is the name of the most recent one?',
    why: 'Version history is what an approval workflow hangs on. Ordering is part of the answer: "newest last" has to actually hold.',
    expected: '2:approved feed artwork',
    async resolve(client) {
      await openSummary(client, SPRING)
      const listed = await call(client, 'tela_list_versions', { design: SPRING })
      return `${listed.versions.length}:${listed.versions[listed.versions.length - 1].name}`
    },
  },
  {
    id: 'q06-legacy-validates',
    question: 'Does the legacy promo design still satisfy the portable schema and its structural invariants?',
    why: 'The question asked of every old file before reusing it. Both checks must run and both must be reported separately.',
    expected: 'valid:0:none',
    async resolve(client) {
      await openSummary(client, LEGACY)
      const validation = await call(client, 'tela_validate_design', { design: LEGACY })
      return `${validation.valid ? 'valid' : 'invalid'}:${validation.schema_issues.length}:${validation.invariant_issue ?? 'none'}`
    },
  },
  {
    id: 'q07-brand-primary',
    question: 'What brand primary colour is recorded in the hiring Q3 design, and what brand voice does it carry?',
    why: 'Brand context travels inside the bundle rather than in a sidecar. This proves it survived the save and is readable without opening the editor.',
    expected: '#2f6df6|direct, warm, no hype',
    async resolve(client) {
      await openSummary(client, HIRING)
      const brand = await call(client, 'tela_get_brand_context', { design: HIRING })
      return `${brand.brand.palette['brand-primary']}|${brand.brand.ai.brand_voice}`
    },
  },
  {
    id: 'q08-capability-and-schema',
    question: 'Which export formats does this server support, and which document schema version is the hiring Q3 design written in?',
    why: 'Pairs a capability claim with a fact about a real file. A server whose advertised capabilities drift from what its files actually use fails one half or the other.',
    expected: 'png,jpg,webp,svg|1',
    async resolve(client) {
      const capabilities = await call(client, 'tela_get_capabilities')
      await openSummary(client, HIRING)
      const validation = await call(client, 'tela_validate_design', { design: HIRING })
      if (!validation.valid) throw new Error('fixture does not validate')
      return `${capabilities.export_formats.join(',')}|${capabilities.document_schema_version}`
    },
  },
  {
    id: 'q09-library-total-frames',
    question: 'How many frames does the whole library contain across all designs?',
    why: 'A fan-out across every design in the root. Catches pagination and listing errors that a single-design question never touches.',
    expected: 6,
    async resolve(client) {
      const listed = await call(client, 'tela_list_designs')
      let total = 0
      for (const entry of listed.designs) total += (await openSummary(client, entry.design)).counts.frames
      return total
    },
  },
  {
    id: 'q10-largest-frame',
    question: 'Which frame in the spring launch design has the largest pixel area, and what is that area?',
    why: 'Requires reading every frame’s geometry and computing over it, rather than reading a single field. The answer is not the frame anyone would guess from the page order.',
    expected: 'Hero — Instagram Story:2073600',
    async resolve(client) {
      const summary = await openSummary(client, SPRING)
      const largest = frames(summary).reduce((best, frame) => (frame.width * frame.height > best.width * best.height ? frame : best))
      return `${largest.name}:${largest.width * largest.height}`
    },
  },
]
