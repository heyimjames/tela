/**
 * The instrument's own self-test.
 *
 * Every assertion in `storage-gate.spec.ts` rests on the inspector: that it can see a
 * record, that the sha256 it reports is of the bytes that are really there, and above
 * all that an empty result means the store is empty rather than that the inspector is
 * broken, pointed at the wrong database, or silently swallowing an error. Those two
 * are indistinguishable from a green tick, which is the CLI-528 lesson: a gate's zero
 * is indistinguishable from "nothing was watching" unless the instrument proves,
 * every run, that it can see.
 *
 * So this file makes the inspector do all four things on purpose: report "no database
 * at all", report a seeded record with a hash the Node side computed independently,
 * notice a difference of exactly one byte, and report an emptied store as empty while
 * still saying the database exists. If the inspector ever breaks into silence, this
 * goes red on the same run that would otherwise have certified everything.
 */

import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'

import { readStore, resetOrigin, seedRecord } from './idb'
import { gotoHarness, openHarness } from './harnessClient'

/** A hash from Node's own crypto: neither the app's implementation nor the page's. */
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

test.describe('IndexedDB inspector self-test', () => {
  test('sees a seeded record, notices one flipped byte, and reports an emptied store', async ({ page }) => {
    await gotoHarness(page)
    await resetOrigin(page)

    // 1. Nothing there, and nothing there is *distinguishable* from "never created".
    const empty = await readStore(page)
    expect(empty.databaseExists, 'a database exists before anything created one').toBe(false)
    expect(empty.records).toEqual([])

    // 2. A record the inspector did not write through any app code.
    const original = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8])
    const flipped = new Uint8Array(original)
    flipped[7] = (flipped[7]! ^ 0x01) & 0xff

    await seedRecord(page, 'record-original', original)
    await seedRecord(page, 'record-flipped', flipped)

    const seeded = await readStore(page)
    expect(seeded.databaseExists).toBe(true)
    const byId = new Map(seeded.records.map((record) => [record.id, record]))
    expect([...byId.keys()].sort()).toEqual(['record-flipped', 'record-original'])

    const observedOriginal = byId.get('record-original')!
    const observedFlipped = byId.get('record-flipped')!

    // 3. The hashes match Node's, so the inspector reports the bytes that are there
    //    rather than a constant, and...
    expect(observedOriginal.sha256).toBe(sha256(original))
    expect(observedFlipped.sha256).toBe(sha256(flipped))
    expect(observedOriginal.byteLength).toBe(original.byteLength)
    // ...a one-byte difference produces a different hash, which is what makes the
    //    byte-identity assertion in the round-trip test falsifiable at all.
    expect(
      observedFlipped.sha256,
      'two bodies differing in a single byte hashed identically — the inspector cannot detect a changed body',
    ).not.toBe(observedOriginal.sha256)

    console.log(
      `[storage self-test] seeded=2 sha_original=${observedOriginal.sha256.slice(0, 16)} ` +
        `sha_flipped=${observedFlipped.sha256.slice(0, 16)} distinct=true`,
    )

    // 4. And an emptied store reads as empty — with the database still present, so
    //    "cleared" is never confused with "deleted" or "never existed".
    const harness = await openHarness(page)
    await harness.clearAll()

    const cleared = await readStore(page)
    expect(cleared.databaseExists, 'clearing removed the database rather than its records').toBe(true)
    expect(cleared.records).toEqual([])
  })
})
