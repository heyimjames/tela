/**
 * Producer identity stamped into every manifest.
 *
 * These are build-time constants, never read from the environment at runtime. That
 * is deliberate: if `sourceCommit` came from `process.env` or a `git` call, two
 * machines would write different bytes for identical documents and the determinism
 * contract would be broken by the very field meant to make bundles auditable.
 *
 * The release pipeline supplies the commit as a *build-time define* when it builds
 * the pinned artifact (`TELA_SOURCE_COMMIT` -> `__TELA_SOURCE_COMMIT__`, applied by
 * both `scripts/build-mcp.mjs` and `vite.config.ts`). A development build has no
 * such define and carries the all-zero commit, which is a valid 40-hex string and
 * unambiguously means "not a released build".
 *
 * A define rather than a rewrite of this file: an earlier version of the release
 * script edited the literal below in the working tree and restored it in a
 * `finally`, so a build killed by a signal, an OOM, or a cancelled CI job left the
 * checkout stamped — poisoning every later build's bundle bytes, breaking the
 * byte-determinism fixtures, and corrupting any concurrent build. Nothing tracked
 * is mutated now.
 */

declare const __TELA_SOURCE_COMMIT__: string | undefined

// Frozen portable-format identity. Existing .tela bundles record this value;
// changing it for a product rebrand would create two producer identities for
// one compatible format family.
export const PRODUCER_NAME = 'tela-design'
export const PRODUCER_VERSION = '0.1.1'
export const UNKNOWN_SOURCE_COMMIT = '0000000000000000000000000000000000000000'

/**
 * Substituted at release-build time. Must resolve to a 40-char lowercase hex string.
 *
 * `typeof` guards the undefined case: with no define the identifier is simply not
 * declared at runtime, and `typeof` on an undeclared name is the one reference that
 * does not throw.
 */
export const SOURCE_COMMIT: string =
  typeof __TELA_SOURCE_COMMIT__ === 'string' ? __TELA_SOURCE_COMMIT__ : UNKNOWN_SOURCE_COMMIT

export interface ProducerIdentity {
  name: string
  version: string
  sourceCommit: string
}

export const PRODUCER: ProducerIdentity = {
  name: PRODUCER_NAME,
  version: PRODUCER_VERSION,
  sourceCommit: SOURCE_COMMIT,
}
