/**
 * Explicit, ordered document migrations.
 *
 * Two rules govern this file:
 *
 * 1. **Forward only, never guess.** A document authored at a schema version newer
 *    than this build understands is *rejected*, not best-effort parsed. Opening a
 *    v2 file with a v1 reader and saving it would write back a v1 file with the v2
 *    fields deleted — a data-loss bug that looks like a successful save.
 * 2. **Every step is named and recorded.** The manifest carries the original
 *    version and the ordered list of migration ids that ran, so a bundle can always
 *    be traced back to the shape it was authored in.
 */

import { telaError } from './errors'
import { CURRENT_DOCUMENT_SCHEMA_VERSION } from './schema'

export interface Migration {
  /** Stable id recorded in the manifest, e.g. `v1->v2:split-frame-background`. */
  readonly id: string
  readonly from: number
  readonly to: number
  /** Pure transform over the raw parsed JSON, before shape validation. */
  migrate(document: Record<string, unknown>): Record<string, unknown>
}

/**
 * Ordered by `from`. v1 is the first published schema, so there is nothing to
 * migrate yet; the machinery ships now so that the first real migration is a data
 * change rather than an architecture change under time pressure.
 */
export const MIGRATIONS: readonly Migration[] = []

export interface MigrationResult {
  document: Record<string, unknown>
  originalVersion: number
  applied: string[]
}

function readVersion(document: Record<string, unknown>): number {
  const raw = document.schemaVersion
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw telaError(
      'unknown_schema_version',
      'document.json does not declare a valid integer schemaVersion',
      String(raw),
    )
  }
  return raw
}

/** Bring a raw parsed document up to the current schema version, or refuse. */
export function migrateDocument(input: Record<string, unknown>): MigrationResult {
  const originalVersion = readVersion(input)

  if (originalVersion > CURRENT_DOCUMENT_SCHEMA_VERSION) {
    throw telaError(
      'future_schema_version',
      `this bundle was written by a newer version of Tela (document schema v${originalVersion}; this build understands up to v${CURRENT_DOCUMENT_SCHEMA_VERSION}). Update Tela to open it.`,
      String(originalVersion),
    )
  }

  let document = input
  let version = originalVersion
  const applied: string[] = []

  while (version < CURRENT_DOCUMENT_SCHEMA_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === version)
    if (!step) {
      throw telaError(
        'migration_failed',
        `no migration is registered from document schema v${version}`,
        String(version),
      )
    }
    try {
      document = step.migrate(document)
    } catch (cause) {
      throw telaError(
        'migration_failed',
        `migration ${step.id} failed`,
        cause instanceof Error ? cause.message : String(cause),
      )
    }
    document = { ...document, schemaVersion: step.to }
    applied.push(step.id)
    version = step.to
  }

  return { document, originalVersion, applied }
}
