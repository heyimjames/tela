/**
 * One error type for every rejection path in the bundle layer.
 *
 * Codes are stable strings rather than message text so tests, the MCP surface, and
 * the UI can branch on *why* a bundle was refused without matching on prose.
 */
export type TelaErrorCode =
  // container
  | 'container_invalid'
  // manifest / document integrity
  | 'manifest_invalid'
  | 'document_invalid'
  | 'document_hash_mismatch'
  | 'content_revision_mismatch'
  | 'unexpected_entry'
  | 'missing_entry'
  | 'entry_order'
  // schema versioning
  | 'future_schema_version'
  | 'unknown_schema_version'
  | 'migration_failed'
  // assets
  | 'asset_hash_mismatch'
  | 'asset_missing'
  | 'asset_orphaned'
  | 'asset_mime_invalid'
  | 'asset_table_invalid'
  | 'unresolved_reference'
  // semantics
  | 'invariant_violation'
  // io
  | 'io_failed'

export class TelaError extends Error {
  readonly code: TelaErrorCode
  readonly detail?: string

  constructor(code: TelaErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'TelaError'
    this.code = code
    this.detail = detail
  }
}

export function telaError(code: TelaErrorCode, message: string, detail?: string): TelaError {
  return new TelaError(code, message, detail)
}
