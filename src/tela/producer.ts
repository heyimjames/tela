/**
 * Producer identity stamped into every manifest.
 *
 * These are build-time constants, never read from the environment at runtime. That
 * is deliberate: if `sourceCommit` came from `process.env` or a `git` call, two
 * machines would write different bytes for identical documents and the determinism
 * contract would be broken by the very field meant to make bundles auditable.
 *
 * The release pipeline rewrites `SOURCE_COMMIT` when it builds the pinned artifact.
 * A development build carries the all-zero commit, which is a valid 40-hex string
 * and unambiguously means "not a released build".
 */

export const PRODUCER_NAME = 'tela-design'
export const PRODUCER_VERSION = '0.1.0'
export const UNKNOWN_SOURCE_COMMIT = '0000000000000000000000000000000000000000'

/** Replaced at release-build time. Must stay a literal 40-char lowercase hex string. */
export const SOURCE_COMMIT: string = UNKNOWN_SOURCE_COMMIT

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
