#!/usr/bin/env node
/**
 * Generate the immutable evaluation fixtures.
 *
 * This runs **once** and its output is committed. It is not part of the
 * evaluation run, and the runner never calls it: an evaluation whose fixtures
 * are regenerated on every run is not measuring the server, it is measuring the
 * generator and the server agreeing with each other, which they will do even
 * when both are wrong.
 *
 * The fixtures are therefore committed `.tela` files with their SHA-256 digests
 * pinned in `DIGESTS.json`. The runner verifies those digests before asking a
 * single question and again afterwards. Before, so a drifted fixture fails
 * loudly instead of quietly changing what the answers mean; after, so a question
 * that mutated something is caught rather than trusted.
 *
 * Regenerating deliberately (a format migration, say) means re-running this and
 * re-deriving the expected answers in `questions.mjs`. That friction is the
 * point — the answers are only stable if the fixtures are.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { call, connect, FIXTURE_DIR, makeSeededRoot } from '../lib/session.mjs'

/** A 1×1 transparent PNG — real bytes, so content sniffing and hashing behave normally. */
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const designsDir = join(FIXTURE_DIR, 'designs')

const root = await makeSeededRoot({ seed: false })
const session = await connect(root)

try {
  await writeFile(join(root, 'team.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  await writeFile(join(root, 'mark.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))

  await buildSpringLaunch(session.client)
  await buildHiringQ3(session.client)
  await buildLegacyPromo(session.client)

  await rm(designsDir, { recursive: true, force: true })
  await mkdir(designsDir, { recursive: true })

  const digests = {}
  for (const name of (await readdir(root)).sort()) {
    if (!name.endsWith('.tela')) continue
    const bytes = await readFile(join(root, name))
    await writeFile(join(designsDir, name), bytes)
    digests[name] = createHash('sha256').update(bytes).digest('hex')
  }

  await writeFile(
    join(FIXTURE_DIR, 'DIGESTS.json'),
    JSON.stringify(
      {
        note: 'Pinned digests of the immutable evaluation fixtures. The runner verifies these before and after every run; a change here means the fixtures moved and the expected answers must be re-derived.',
        designs: Object.fromEntries(Object.entries(digests).sort(([a], [b]) => (a < b ? -1 : 1))),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  )
  process.stdout.write(`${Object.keys(digests).length} fixtures written to evaluations/fixtures/designs\n`)
} finally {
  await session.close()
}

/**
 * A live campaign mid-production: one approved feed frame, two format variants
 * generated from it, a second page holding a banner, and two saved versions.
 */
async function buildSpringLaunch(client) {
  const design = 'spring-launch.tela'
  const created = await call(client, 'tela_create_design', { design, name: 'Spring launch' })
  const opened = await call(client, 'tela_open_design', { design })
  let revision = opened.session.session_revision
  const next = (result) => {
    revision = result.session.session_revision
    return result
  }

  next(await call(client, 'tela_update_frame', { design, frame_id: created.frame_id, name: 'Hero', expected_session_revision: revision }))
  next(
    await call(client, 'tela_set_brand_context', {
      design,
      product_name: 'ABES',
      display_name: 'ABES Engineering',
      website: 'abes.example',
      call_to_action: 'Apply now',
      palette: { 'brand-primary': '#ff5a1f', 'brand-ink': '#101820' },
      expected_session_revision: revision,
    }),
  )
  const photo = next(await call(client, 'tela_import_asset', { design, source: 'team.png', name: 'Team photo', category: 'photos', expected_session_revision: revision }))
  next(
    await call(client, 'tela_add_layers', {
      design,
      frame_id: created.frame_id,
      expected_session_revision: revision,
      layers: [
        { type: 'background', name: 'Field', x: 0, y: 0, width: 1200, height: 627, fill: { type: 'solid', color: { hex: '#101820', token: 'brand-ink' } } },
        { type: 'image', name: 'Team', x: 700, y: 0, width: 500, height: 627, imageUrl: photo.ref },
        { type: 'text', name: 'Headline', content: 'We are hiring engineers', fontSize: 64, x: 80, y: 120, width: 560, height: 180 },
        { type: 'text', name: 'Role line', content: 'Platform and infrastructure', fontSize: 28, x: 80, y: 320, width: 520, height: 60 },
        { type: 'text', name: 'CTA', content: 'Apply now', fontSize: 24, x: 80, y: 440, width: 220, height: 56 },
        { type: 'shape', name: 'Rule', shape: 'rectangle', x: 80, y: 410, width: 120, height: 4 },
      ],
    }),
  )
  next(await call(client, 'tela_save_version', { design, frame_id: created.frame_id, name: 'first pass', expected_session_revision: revision }))
  next(
    await call(client, 'tela_generate_format_variants', {
      design,
      frame_id: created.frame_id,
      format_ids: ['instagram-story', 'instagram-feed'],
      expected_session_revision: revision,
    }),
  )
  next(await call(client, 'tela_save_version', { design, frame_id: created.frame_id, name: 'approved feed artwork', expected_session_revision: revision }))

  const page = next(await call(client, 'tela_add_page', { design, name: 'Banners', expected_session_revision: revision }))
  next(await call(client, 'tela_add_frame', { design, page_id: page.page_id, name: 'Wide banner', format_id: 'generic-banner', expected_session_revision: revision }))

  await save(client, design, revision)
}

/** A smaller brief carrying an imported licensed font and an SVG-free image mark. */
async function buildHiringQ3(client) {
  const design = 'hiring-q3.tela'
  const created = await call(client, 'tela_create_design', { design, name: 'Hiring Q3' })
  const opened = await call(client, 'tela_open_design', { design })
  let revision = opened.session.session_revision
  const next = (result) => {
    revision = result.session.session_revision
    return result
  }

  next(await call(client, 'tela_update_frame', { design, frame_id: created.frame_id, name: 'Square', format_id: 'instagram-feed', expected_session_revision: revision }))
  next(
    await call(client, 'tela_set_brand_context', {
      design,
      product_name: 'ABES',
      brand_voice: 'direct, warm, no hype',
      palette: { 'brand-primary': '#2f6df6' },
      expected_session_revision: revision,
    }),
  )
  const mark = next(await call(client, 'tela_import_asset', { design, source: 'mark.png', name: 'Logo', category: 'logos', expected_session_revision: revision }))
  next(
    await call(client, 'tela_add_layers', {
      design,
      frame_id: created.frame_id,
      expected_session_revision: revision,
      layers: [
        { type: 'background', name: 'Paper', x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: { hex: '#ffffff', token: 'white' } } },
        { type: 'image', name: 'Logo', x: 80, y: 80, width: 160, height: 160, imageUrl: mark.ref },
        { type: 'text', name: 'Headline', content: 'Join the platform team', fontSize: 72, x: 80, y: 320, width: 900, height: 220 },
      ],
    }),
  )
  await save(client, design, revision)
}

/** An old, minimal design — the "nothing interesting here" control. */
async function buildLegacyPromo(client) {
  const design = 'legacy-promo.tela'
  const created = await call(client, 'tela_create_design', { design, name: 'Legacy promo' })
  const opened = await call(client, 'tela_open_design', { design })
  let revision = opened.session.session_revision
  const added = await call(client, 'tela_add_layers', {
    design,
    frame_id: created.frame_id,
    expected_session_revision: revision,
    layers: [{ type: 'text', name: 'Promo', content: 'Half price this week', fontSize: 48, x: 60, y: 200, width: 700, height: 90 }],
  })
  await save(client, design, added.session.session_revision)
}

async function save(client, design, revision) {
  const summary = await call(client, 'tela_get_design_summary', { design })
  await call(client, 'tela_save_design', { design, expected_session_revision: revision, expected_disk_revision: summary.disk_revision })
  await call(client, 'tela_close_design', { design })
}
