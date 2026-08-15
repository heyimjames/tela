/**
 * The Node-side handle on the storage harness page.
 *
 * Thin by design — it forwards calls and does no interpretation — but it is the one
 * place that checks the harness is actually installed. Without that check every call
 * below would be `undefined?.something` on a page that failed to load its module, and
 * a spec would see "no error, no record written" rather than a failure: exactly the
 * shape of a test that certifies a subject it never reached.
 */

import { expect, type Page } from '@playwright/test'

import { HARNESS_PATH } from './origin'

/** Mirrors `HarnessResult` in `tests/storage/harness/main.ts`. */
export type HarnessResult =
  | { readonly ok: true; readonly contentRevision?: string; readonly base64?: string }
  | {
      readonly ok: false
      readonly name: string
      readonly message: string
      readonly backend?: string
      readonly quota: boolean
    }

interface HarnessWindow extends Window {
  __telaStorageHarness?: {
    mode: string
    freshAdapter(): void
    put(id: string, base64: string): Promise<HarnessResult>
    get(id: string): Promise<HarnessResult>
    seedLegacyBody(id: string, base64: string): void
    clearAll(): Promise<void>
    bucketsAvailable(): boolean
    putUnderQuota(bucketName: string, quotaBytes: number, id: string, base64: string): Promise<HarnessResult>
  }
}

function required(page: Page) {
  return {
    async mode(): Promise<string> {
      return page.evaluate(() => {
        const harness = (window as HarnessWindow).__telaStorageHarness
        if (harness === undefined) throw new Error('the storage harness is not installed on this page')
        return harness.mode
      })
    },
    async freshAdapter(): Promise<void> {
      await page.evaluate(() => {
        const harness = (window as HarnessWindow).__telaStorageHarness
        if (harness === undefined) throw new Error('the storage harness is not installed on this page')
        harness.freshAdapter()
      })
    },
    async put(id: string, base64: string): Promise<HarnessResult> {
      return page.evaluate(async ([documentId, payload]) => {
        const harness = (window as HarnessWindow).__telaStorageHarness
        if (harness === undefined) throw new Error('the storage harness is not installed on this page')
        return harness.put(documentId, payload)
      }, [id, base64] as const)
    },
    async get(id: string): Promise<HarnessResult> {
      return page.evaluate(async ([documentId]) => {
        const harness = (window as HarnessWindow).__telaStorageHarness
        if (harness === undefined) throw new Error('the storage harness is not installed on this page')
        return harness.get(documentId)
      }, [id] as const)
    },
    async seedLegacyBody(id: string, base64: string): Promise<void> {
      await page.evaluate(([documentId, payload]) => {
        const harness = (window as HarnessWindow).__telaStorageHarness
        if (harness === undefined) throw new Error('the storage harness is not installed on this page')
        harness.seedLegacyBody(documentId, payload)
      }, [id, base64] as const)
    },
    async bucketsAvailable(): Promise<boolean> {
      return page.evaluate(() => {
        const harness = (window as HarnessWindow).__telaStorageHarness
        if (harness === undefined) throw new Error('the storage harness is not installed on this page')
        return harness.bucketsAvailable()
      })
    },
    async putUnderQuota(
      bucketName: string,
      quotaBytes: number,
      id: string,
      base64: string,
    ): Promise<HarnessResult> {
      return page.evaluate(
        async ([name, quota, documentId, payload]) => {
          const harness = (window as HarnessWindow).__telaStorageHarness
          if (harness === undefined) throw new Error('the storage harness is not installed on this page')
          return harness.putUnderQuota(name as string, quota as number, documentId as string, payload as string)
        },
        [bucketName, quotaBytes, id, base64] as const,
      )
    },
    async clearAll(): Promise<void> {
      await page.evaluate(async () => {
        const harness = (window as HarnessWindow).__telaStorageHarness
        if (harness === undefined) throw new Error('the storage harness is not installed on this page')
        await harness.clearAll()
      })
    },
  }
}

export type Harness = ReturnType<typeof required>

/**
 * Assert the harness page is loaded and running the default-mode build, then return a
 * handle to it.
 *
 * The mode assertion is not decoration. A harness built with `VITE_WORKSPACE_MODE=true`
 * would route every call through the API-backed adapter, and every claim this suite
 * makes about IndexedDB would be about a code path that never ran.
 */
export async function openHarness(page: Page): Promise<Harness> {
  const harness = required(page)
  await expect(page.locator('#harness-status')).toHaveText(/^ready:/)
  expect(
    await harness.mode(),
    'the harness page was built with workspace mode on — it is not exercising the local storage path',
  ).toBe('local')
  return harness
}

/** Load the harness page. */
export async function gotoHarness(page: Page): Promise<void> {
  await page.goto(`${HARNESS_PATH}index.html`)
}
