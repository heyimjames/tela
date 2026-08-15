/**
 * The browser-level storage gate (CLI-538).
 *
 * Four properties CLI-527 established, each of which the committed vitest suite can
 * only assert against an IndexedDB double:
 *
 *  1. a 6 MB body round-trips byte-identically through real IndexedDB,
 *  2. a genuine `QuotaExceededError` is classified as `StorageQuotaExceededError`,
 *  3. a legacy `localStorage` body is migrated into IndexedDB and the old copy dropped,
 *  4. **both** "Clear All Data" buttons actually empty the store.
 *
 * (4) is the one the double could never have covered: those are two `onClick`
 * handlers in two components, which CLI-527's wrap-up disclosed as untested. They are
 * driven here through the real built app, in a real browser, with a real confirm
 * dialog — the only harness in which that code executes at all.
 *
 * Every "what is in the store" answer comes from `tests/storage/idb.ts`, which reads
 * IndexedDB directly and hashes with `crypto.subtle`. Nothing in this file takes the
 * subject's word for what the subject did.
 */

import { expect, test, type Page } from '@playwright/test'

import { largeBundle, smallBundle, LARGE_BODY_BYTES } from './bundles'
import { fromBase64, legacyKeys, readStore, resetOrigin, seedRecord, toBase64 } from './idb'
import { gotoHarness, openHarness } from './harnessClient'

/**
 * The store's record count, tolerating the moment a page is navigating.
 *
 * The reset buttons reload the page immediately after clearing, so a poll that ran
 * during the reload would fail on a destroyed execution context rather than report a
 * count. `-1` is returned in that window: it is not zero, so a poll can never satisfy
 * "the store is empty" by catching an error.
 */
async function recordCount(page: Page): Promise<number> {
  try {
    return (await readStore(page)).records.length
  } catch {
    return -1
  }
}

/**
 * Read the store once the page has stopped navigating.
 *
 * Same reload, different problem: after the poll above is satisfied the page may
 * still be swapping documents, and a plain `readStore` would fail on a destroyed
 * execution context. Retrying is safe because the assertion is made on the snapshot
 * that finally comes back, never on the fact that a read succeeded.
 */
async function readStoreStable(page: Page) {
  const deadline = Date.now() + 30_000
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      return await readStore(page)
    } catch (error) {
      lastError = error
      await page.waitForTimeout(250)
    }
  }
  throw lastError ?? new Error('could not read the store')
}

test.describe('IndexedDB body storage, in a real browser', () => {
  test('a 6 MB bundle round-trips byte-identically through real IndexedDB', async ({ page }) => {
    const fixture = largeBundle()
    expect(fixture.bytes.length).toBeGreaterThanOrEqual(LARGE_BODY_BYTES)

    await gotoHarness(page)
    await resetOrigin(page)
    const harness = await openHarness(page)

    const written = await harness.put('round-trip', toBase64(fixture.bytes))
    expect(written, `putDocument refused a valid ${fixture.bytes.length}-byte bundle`).toMatchObject({ ok: true })

    // The independent observer: these bytes are in IndexedDB, and they are the bytes
    // the test built. Asserted before the read-back, so a `getDocument` that returned
    // its own write buffer could not stand in for durable storage.
    const stored = await readStore(page)
    expect(stored.databaseExists, 'no IndexedDB database exists — the body did not go there').toBe(true)
    expect(
      stored.records.map((record) => record.id),
      'the body is not in IndexedDB; the adapter fell back to localStorage, where 6 MB cannot fit',
    ).toEqual(['round-trip'])
    expect(stored.records[0]!.byteLength).toBe(fixture.bytes.length)
    expect(stored.records[0]!.sha256, 'the bytes in IndexedDB are not the bytes that were written').toBe(
      fixture.sha256,
    )

    const read = await harness.get('round-trip')
    expect(read).toMatchObject({ ok: true })
    const returned = fromBase64((read as { base64: string }).base64)

    console.log(
      `[storage gate] round_trip bytes=${fixture.bytes.length} ` +
        `sha_written=${fixture.sha256.slice(0, 16)} sha_in_indexeddb=${stored.records[0]!.sha256.slice(0, 16)} ` +
        `sha_read_back=${(await sha256OfBytes(returned)).slice(0, 16)}`,
    )

    expect(returned.length).toBe(fixture.bytes.length)
    expect(
      Buffer.from(returned).equals(Buffer.from(fixture.bytes)),
      'the bytes read back differ from the bytes stored',
    ).toBe(true)
  })

  test('a genuine quota rejection is classified as a quota error against the indexedDB budget', async ({
    page,
  }) => {
    const small = smallBundle()
    const large = largeBundle()
    const QUOTA = 1024 * 1024

    await gotoHarness(page)
    await resetOrigin(page)
    const harness = await openHarness(page)

    // Not a skip. The suite's browser is pinned by `package-lock.json`, so an absent
    // Storage Buckets API means the pin moved to a build that cannot run this check —
    // which has to be a red test someone reads, not a quietly skipped one.
    expect(
      await harness.bucketsAvailable(),
      'this Chromium has no Storage Buckets API, so no genuine IndexedDB quota can be imposed',
    ).toBe(true)

    // Control: the same adapter, the same bucket, the same quota — a body that fits
    // is stored. Without it, a failure below could be the harness, the bucket, or the
    // bundle rather than the budget.
    const fits = await harness.putUnderQuota('quota-gate', QUOTA, 'quota-small', toBase64(small.bytes))
    expect(fits, `a ${small.bytes.length}-byte body was refused by a ${QUOTA}-byte budget`).toMatchObject({ ok: true })

    const refused = await harness.putUnderQuota('quota-gate', QUOTA, 'quota-large', toBase64(large.bytes))
    console.log(
      `[storage gate] quota control_bytes=${small.bytes.length} control_ok=${fits.ok} ` +
        `refused_bytes=${large.bytes.length} budget=${QUOTA} ` +
        `ok=${refused.ok} name=${refused.ok ? '-' : refused.name} backend=${refused.ok ? '-' : (refused.backend ?? '-')}`,
    )

    expect(refused.ok, 'a 6 MB body was accepted under a 1 MB budget — the browser did not enforce it').toBe(false)
    const failure = refused as Extract<typeof refused, { ok: false }>
    expect(
      failure.quota,
      `the quota rejection was not classified: ${failure.name} — ${failure.message}`,
    ).toBe(true)
    expect(failure.name).toBe('StorageQuotaExceededError')
    expect(failure.backend, 'the error names the wrong budget').toBe('indexedDB')

    // And the same bytes are storable when the budget is not the obstacle: written
    // through the ambient adapter, into the origin's own IndexedDB, they land. So the
    // refusal above was about the budget, not about the payload.
    expect(
      await harness.put('quota-large-unconstrained', toBase64(large.bytes)),
      'the same bytes fail against the unconstrained store too — the refusal was not about the quota',
    ).toMatchObject({ ok: true })
  })

  test('a legacy localStorage body is migrated into IndexedDB and the old copy dropped', async ({ page }) => {
    const fixture = smallBundle()

    await gotoHarness(page)
    await resetOrigin(page)
    const harness = await openHarness(page)

    // Seeded through the app's own key derivation, so the test cannot pass by
    // migrating a key the app would never have written.
    await harness.seedLegacyBody('legacy-doc', toBase64(fixture.bytes))
    expect(
      await legacyKeys(page),
      'the legacy body was not seeded — the migration below would have nothing to do',
    ).toEqual(['tela-bundle:legacy-doc'])
    expect((await readStore(page)).records, 'IndexedDB already holds the body before any migration').toEqual([])

    // A fresh adapter resolves its body store, which is when the sweep runs.
    await harness.freshAdapter()
    const read = await harness.get('legacy-doc')
    expect(read, 'the legacy document could not be read after migration').toMatchObject({ ok: true })

    const migrated = await readStore(page)
    expect(migrated.records.map((record) => record.id)).toEqual(['legacy-doc'])
    expect(migrated.records[0]!.sha256, 'the migrated body is not the bytes that were seeded').toBe(fixture.sha256)
    expect(
      await legacyKeys(page),
      'the legacy copy survived the migration and is still consuming the localStorage budget',
    ).toEqual([])

    const returned = fromBase64((read as { base64: string }).base64)
    expect(Buffer.from(returned).equals(Buffer.from(fixture.bytes))).toBe(true)

    console.log(
      `[storage gate] migration bytes=${fixture.bytes.length} sha=${fixture.sha256.slice(0, 16)} ` +
        `legacy_keys_after=0 indexeddb_records_after=${migrated.records.length}`,
    )
  })
})

/**
 * The two reset call sites.
 *
 * Written as a loop over the two routes so neither can be quietly dropped, and so the
 * difference between them is visible: they are the same handler pasted into two
 * components, which is exactly why one of them could rot unnoticed.
 */
const RESET_CALL_SITES = [
  {
    name: 'SettingsPage (library)',
    async open(page: Page): Promise<void> {
      await expect(page.getByRole('heading', { name: 'Files', level: 1 })).toBeVisible()
      // Scoped to the sidebar: the mobile header carries a second control with the
      // same accessible name, and an ambiguous locator would fail for the wrong reason.
      await page.locator('aside').getByRole('button', { name: 'Settings' }).click()
      await expect(page.getByRole('heading', { name: 'Data' })).toBeVisible()
    },
  },
  {
    name: 'SettingsModal (editor)',
    async open(page: Page): Promise<void> {
      await page.getByRole('button', { name: 'New file' }).click()
      await expect(page.getByRole('button', { name: 'Shapes' })).toBeVisible()
      await page.locator('button[aria-label="Settings"]:visible').click()
      await expect(page.getByText('Data Storage')).toBeVisible()
    },
  },
] as const

for (const callSite of RESET_CALL_SITES) {
  test(`Clear All Data from ${callSite.name} empties IndexedDB`, async ({ page }) => {
    const fixture = smallBundle()

    await page.goto('/')
    await resetOrigin(page)

    // Seeded straight into IndexedDB, bypassing every app module: a reset test must
    // fail for one reason, and "the writer broke" is not that reason. A `tela-` key
    // goes in beside it, because the button's own sweep is what removes those and the
    // two erasures have to be seen to happen together.
    await seedRecord(page, 'to-be-erased', fixture.bytes)
    await page.evaluate(() => localStorage.setItem('tela-files', '[]'))
    await page.reload()

    const before = await readStore(page)
    expect(
      before.records.map((record) => record.id),
      'nothing was in the store before the reset — the assertion below could not fail',
    ).toEqual(['to-be-erased'])
    expect(before.records[0]!.sha256).toBe(fixture.sha256)

    await callSite.open(page)

    // The handler is `confirm()`-gated and reloads the page afterwards.
    page.on('dialog', (dialog) => {
      void dialog.accept()
    })
    await page.getByRole('button', { name: 'Clear All Data' }).click()

    await expect
      .poll(() => recordCount(page), {
        message: 'IndexedDB still holds a document body after Clear All Data',
        timeout: 30_000,
      })
      .toBe(0)

    const after = await readStoreStable(page)
    expect(after.databaseExists, 'the reset deleted the database rather than clearing it').toBe(true)
    expect(
      await page.evaluate(() => localStorage.getItem('tela-files')),
      'the localStorage sweep did not run — only half the reset happened',
    ).toBeNull()

    console.log(
      `[storage gate] reset call_site="${callSite.name}" records_before=${before.records.length} ` +
        `records_after=${after.records.length} database_still_exists=${after.databaseExists}`,
    )
  })
}

/** SHA-256 of `bytes`, from Node's crypto. Used only for the evidence line. */
async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(bytes).digest('hex')
}
