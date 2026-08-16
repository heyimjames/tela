/**
 * The origin the brand suite serves its subject on.
 *
 * Its own module so the Playwright config and the spec agree by construction —
 * the same reasoning as `tests/network/origin.ts`. The port is distinct from
 * every other suite's so a preview server left running by the zero-network or
 * storage probe cannot answer these assertions from a differently-configured
 * build.
 */
export const BRAND_PORT = 4321
export const BASE_URL = `http://127.0.0.1:${BRAND_PORT}`
