/**
 * The storage seam.
 *
 * A *document* here is the portable `.tela` bundle — the same deterministic ZIP
 * `src/tela` writes and reads, carried as opaque bytes. It is deliberately not the
 * library's `DesignFile` cache entry: a `DesignFile` holds only `pages`, while a
 * document additionally carries `versions`, `brand`, `assets`, `fonts`, `settings`
 * and the active-page/frame pointers. Routing the seam through `DesignFile` would
 * mean a narrowing conversion on every read and write, which is the exact defect
 * class `src/tela/session.ts` and `src/types/fileSystem.ts` document as already
 * having been paid for once. Bytes in, bytes out — an adapter cannot lose a field
 * it never interprets.
 *
 * Two implementations satisfy this interface:
 *
 * - `LocalStorageAdapter` — the default. Entirely offline; the browser is the only
 *   participant. It never throws `ConflictError`, because there is no second writer.
 * - `WorkspaceStorageAdapter` — selected only when workspace mode is switched on.
 *   A placeholder in this revision; a later issue implements it against the hosted
 *   API, where a second writer makes `contentRevision` checking meaningful.
 *
 * Nothing in this module or its implementations opens a network connection.
 */

/**
 * What the library needs to render a document without reading its bytes.
 *
 * Deliberately the projection the local index already stores, so listing costs a
 * read of the index rather than a parse of every bundle.
 */
export interface DocumentSummary {
  id: string
  name: string
  /** ISO-8601, as written by the existing library store. */
  createdAt: string
  updatedAt: string
  /** `null` at the library root. Local-only today; workspace mode may ignore it. */
  folderId: string | null
  /** The app's built-in scratch document, which cannot be renamed or deleted. */
  isScratchpad?: boolean
}

/**
 * A write lost a race: the document changed since the revision the caller based its
 * edit on.
 *
 * This is the *only* sanctioned way for an adapter to signal a `contentRevision`
 * mismatch, so callers can branch on the type rather than parsing a message. Local
 * mode never throws it — there is no concurrent writer to lose a race against.
 * Workspace mode will, when the server rejects a stale `baseContentRevision`.
 */
export class ConflictError extends Error {
  readonly documentId: string
  /** The revision the caller believed it was editing, or `null` if it claimed a create. */
  readonly baseContentRevision: string | null
  /** The revision the store actually holds. */
  readonly actualContentRevision: string

  constructor(documentId: string, baseContentRevision: string | null, actualContentRevision: string) {
    super(
      `document ${documentId} changed since ${baseContentRevision ?? '(new)'} — it is now at ${actualContentRevision}`,
    )
    // `name` is set explicitly rather than inherited: bundlers that downlevel class
    // extension can leave it as 'Error', and callers matching on the name would
    // then silently stop recognising a conflict.
    this.name = 'ConflictError'
    this.documentId = documentId
    this.baseContentRevision = baseContentRevision
    this.actualContentRevision = actualContentRevision
  }
}

export interface StorageAdapter {
  /** Every document available to the current user, in the store's own order. */
  listDocuments(): Promise<DocumentSummary[]>

  /**
   * The document's bundle bytes, exactly as they were stored, plus the semantic
   * revision recorded in its manifest.
   *
   * The bytes are returned verbatim rather than re-serialized: a re-serialize would
   * make the result depend on the reader's schema version and producer stamp, and a
   * round-trip would stop being byte-identical.
   */
  getDocument(id: string): Promise<{ bundle: Uint8Array; contentRevision: string }>

  /**
   * Store `bundle` as document `id`.
   *
   * `baseContentRevision` is the revision the caller read before editing, or `null`
   * to assert a create. An adapter with concurrent writers must reject a stale base
   * with `ConflictError`; an adapter without them may ignore it.
   */
  putDocument(
    id: string,
    bundle: Uint8Array,
    baseContentRevision: string | null,
  ): Promise<{ contentRevision: string }>

  /** Retire a document. Archiving an id that does not exist is not an error. */
  archiveDocument(id: string): Promise<void>
}
