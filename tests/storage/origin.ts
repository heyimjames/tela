/**
 * The origins the storage gate serves its subjects on.
 *
 * Its own module so the Playwright config, the stub server and the specs agree by
 * construction — the same reason `tests/network/origin.ts` exists. If a spec derived
 * an origin independently, a config change could point the two at different places
 * while every assertion still passed against whatever answered.
 *
 * Two origins, because there are two subjects and they must not be one:
 *
 *  - `STORAGE_BASE_URL` serves the **default-mode** build (workspace mode and the AI
 *    endpoint explicitly empty). Everything about IndexedDB, quota, migration and the
 *    reset buttons is asserted against the build that actually ships.
 *  - `WORKSPACE_BASE_URL` serves the **workspace-mode** build against a stub API. It
 *    is a separate origin *and* a separate output directory so a build with
 *    `VITE_WORKSPACE_MODE=true` can never be the thing a default-mode assertion
 *    measured. Sharing an origin would also share one IndexedDB and one cookie jar
 *    between the two suites.
 *
 * Neither port is Vite's default (4173), nor the zero-network probe's (4319): a
 * preview server left running from another branch must not be able to answer these.
 */

export const STORAGE_PORT = 4331
export const WORKSPACE_PORT = 4332

export const STORAGE_BASE_URL = `http://127.0.0.1:${STORAGE_PORT}`
export const WORKSPACE_BASE_URL = `http://127.0.0.1:${WORKSPACE_PORT}`

/**
 * Where the storage harness page is served from, under the default-mode build.
 *
 * Same origin as the app on purpose: the harness writes through the real storage
 * modules and the app's own reset buttons must be able to see — and clear — exactly
 * what it wrote. A different origin would give them different IndexedDB databases and
 * the reset assertions would be measuring nothing.
 */
export const HARNESS_PATH = '/__storage_harness__/'
