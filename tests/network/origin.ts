/**
 * The origin the probe serves its subject on.
 *
 * Its own module so the Playwright config and the spec agree by construction.
 * If the spec derived the origin independently, a config change could silently
 * point the two at different places — and the gate's whole verdict is "did a
 * request leave *this* origin".
 *
 * The port is deliberately not Vite's default (4173): a preview server someone
 * left running from another branch must not be able to answer this probe.
 */
export const PROBE_PORT = 4319
export const BASE_URL = `http://127.0.0.1:${PROBE_PORT}`
