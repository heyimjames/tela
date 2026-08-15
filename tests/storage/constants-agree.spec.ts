/**
 * The inspector observes the store the app actually writes to.
 *
 * `tests/storage/idb.ts` names the database, the object store and the legacy key
 * prefix itself rather than importing them, so that it stays an independent observer.
 * The cost of that independence is drift: rename `DATABASE_NAME` and the inspector
 * would go on faithfully reporting an empty store that nothing uses, and every "the
 * reset emptied IndexedDB" assertion would pass against a database that never existed.
 *
 * This is the check that turns that silent hole into a red test. It is a pure
 * comparison — no browser — and it lives in the same project so it cannot be run
 * separately from the gate it protects.
 */

import { readdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

import { BODY_STORE_NAME, DATABASE_NAME } from '@/storage/IndexedDbBodyStore'
import { DOCUMENT_KEY_PREFIX } from '@/storage/documentKey'
import { OBSERVED_DATABASE_NAME, OBSERVED_LEGACY_KEY_PREFIX, OBSERVED_STORE_NAME } from './idb'

test.describe('the inspector and the app name the same store', () => {
  test('database, object store and legacy prefix agree', () => {
    expect(
      OBSERVED_DATABASE_NAME,
      'the app renamed its IndexedDB database — the inspector is watching the old one',
    ).toBe(DATABASE_NAME)
    expect(
      OBSERVED_STORE_NAME,
      'the app renamed its object store — the inspector is watching the old one',
    ).toBe(BODY_STORE_NAME)
    expect(
      OBSERVED_LEGACY_KEY_PREFIX,
      'the app changed the legacy body key prefix — the migration assertions address the old one',
    ).toBe(DOCUMENT_KEY_PREFIX)
  })

  /**
   * The gate still covers what it was built to cover.
   *
   * Deleting a spec file does not fail a Playwright run: the remaining tests pass and
   * the job is green, so a behaviour can stop being checked without anything going
   * red. Pinning the set turns that into a failure someone has to look at — the same
   * reason CLI-533 pins the op list rather than trusting behavioural coverage alone.
   *
   * This is a floor, not a ceiling: adding a spec is allowed and needs no edit here
   * (`playwright.storage.config.ts` subtracts rather than allow-lists, so a new file
   * runs by default). Removing one is the thing that has to be deliberate.
   */
  test('every behaviour this gate exists to cover still has a spec', () => {
    const required = [
      'storage-gate.spec.ts',
      'inspector-selftest.spec.ts',
      'workspace-cookies.spec.ts',
      'constants-agree.spec.ts',
    ]
    const present = readdirSync(import.meta.dirname).filter((name) => name.endsWith('.spec.ts'))
    // Asserted before the comparison: an empty listing would otherwise satisfy
    // nothing-is-missing by having read the wrong directory.
    expect(present.length, 'no spec files were found — this check read the wrong directory').toBeGreaterThan(0)
    expect(
      required.filter((name) => !present.includes(name)),
      'a covered behaviour lost its spec file; the gate is quietly no longer checking it',
    ).toEqual([])
  })
})
