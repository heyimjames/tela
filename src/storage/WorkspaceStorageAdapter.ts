/**
 * Workspace mode's adapter — the seam's other side, against the hosted v1 API.
 *
 * CLI-510 left this a stub and wrote down why it held no HTTP client: doing so
 * "would put network-capable code in the default build ahead of the review that is
 * supposed to authorize it". CLI-517 is that review. The client is now imported
 * here, and three properties keep the certified offline payload honest:
 *
 *  - Nothing is constructed at module scope. `getDesignApiClient()` builds its
 *    client on first call, so importing this file opens nothing.
 *  - Every method needs an active workspace id, which only a completed login sets.
 *    In local mode there is none, and there is no path that calls these methods
 *    anyway — `getStorageAdapter()` returns `LocalStorageAdapter` unless
 *    `VITE_WORKSPACE_MODE` is switched on.
 *  - The zero-network Playwright gate (`tests/network/`) builds with the flag
 *    explicitly empty and asserts the running app makes no request at all. That
 *    gate, not this comment, is the evidence.
 *
 * Error translation lives in `src/workspace/errors.ts` rather than inline, because
 * one of the translations inverts a property name — see the note there before
 * touching the conflict path.
 */

import type { DesignApiClient } from '@performance-clickt/design-api-client'
import { serverStoredOurBytes } from '@/workspace/bundleHash'
import { getDesignApiClient } from '@/workspace/client'
import { mapApiError } from '@/workspace/errors'
import { requireActiveWorkspaceId } from '@/workspace/activeWorkspace'
import { ApiError } from '@performance-clickt/design-api-client'
import type { DocumentSummary, StorageAdapter } from './StorageAdapter'

/**
 * Retained for compatibility with CLI-510's export surface.
 *
 * Nothing throws it any more; `src/storage/index.ts` re-exports it, and removing it
 * would be an unrelated breaking change to a published barrel.
 */
export class NotImplementedError extends Error {
  readonly operation: string

  constructor(operation: string) {
    super(`workspace storage is not yet implemented: ${operation}`)
    // Set explicitly — a downlevelled class extension can otherwise leave this as
    // 'Error', and a caller matching on the name would stop recognising it.
    this.name = 'NotImplementedError'
    this.operation = operation
  }
}

/**
 * What a `PUT` actually did.
 *
 * Wider than the `StorageAdapter` interface's return on purpose. The interface is
 * frozen and shared with local mode, but a workspace save carries one extra fact
 * local mode has no concept of: whether the server kept the bytes it was sent.
 * `putDocument` narrows this to the interface; the session controller calls
 * `putDocumentDetailed` and reports the difference.
 */
export interface WorkspacePutResult {
  readonly contentRevision: string
  /** The sha256 of the archive the server **has**, which may not be the one sent. */
  readonly bundleSha256: string
  /**
   * `false` when the server accepted the write but kept its earlier bytes — the
   * rename quirk documented in `src/workspace/bundleHash.ts`. Not an error, and
   * never a reason to retry.
   */
  readonly storedOurBytes: boolean
}

export interface WorkspaceStorageAdapterOptions {
  /** Defaults to the shared client. Injected by tests holding a request log. */
  readonly client?: () => DesignApiClient
  /** Defaults to the active workspace. Injected by tests pinning one. */
  readonly workspaceId?: () => string
}

export class WorkspaceStorageAdapter implements StorageAdapter {
  private readonly client: () => DesignApiClient
  private readonly workspaceId: () => string

  /**
   * Constructible with no arguments, because `getStorageAdapter()` does exactly
   * that. The options exist for tests and for a future caller that holds more than
   * one workspace open at once.
   */
  constructor(options: WorkspaceStorageAdapterOptions = {}) {
    this.client = options.client ?? getDesignApiClient
    this.workspaceId = options.workspaceId ?? requireActiveWorkspaceId
  }

  async listDocuments(): Promise<DocumentSummary[]> {
    try {
      const { documents } = await this.client().listDocuments({ workspaceId: this.workspaceId() })
      return documents.map((document) => ({
        id: document.id,
        // The API calls it `title`; the seam calls it `name`. Same string.
        name: document.title,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        // Folders are a local-library concept the hosted API does not model. Every
        // workspace document sits at the root, which `null` is the seam's spelling of.
        folderId: null,
      }))
    } catch (error) {
      throw mapApiError(error)
    }
  }

  async getDocument(id: string): Promise<{ bundle: Uint8Array; contentRevision: string }> {
    try {
      const { bytes, contentRevision } = await this.client().getDocumentBundle({
        workspaceId: this.workspaceId(),
        documentId: id,
      })
      if (contentRevision.trim() === '') {
        // The client renders a missing `X-Content-Revision` as ''. Returning that
        // would be worse than failing: '' is also how "I expect no revision" is
        // spelled on the way back in, so an empty revision here would turn the next
        // save into a claimed create and a guaranteed conflict — or, against a
        // document with no revision yet, an overwrite. Fail loudly instead.
        throw new Error(`document ${id} was served without a content revision`)
      }
      return { bundle: bytes, contentRevision }
    } catch (error) {
      throw mapApiError(error, id)
    }
  }

  /**
   * The full result of a write, including whether the bytes were stored.
   *
   * `baseContentRevision` is passed through as `X-Base-Content-Revision`; `null`
   * omits the header, which asserts "this document has no revision yet". Both a
   * stale base and a wrongly-absent one are conflicts, and a conflict writes
   * nothing.
   */
  async putDocumentDetailed(
    id: string,
    bundle: Uint8Array,
    baseContentRevision: string | null,
  ): Promise<WorkspacePutResult> {
    try {
      const result = await this.client().putDocumentBundle({
        workspaceId: this.workspaceId(),
        documentId: id,
        ...(baseContentRevision === null ? {} : { baseContentRevision }),
        body: bundle,
      })
      return {
        contentRevision: result.contentRevision,
        bundleSha256: result.bundleSha256,
        storedOurBytes: await serverStoredOurBytes(bundle, result.bundleSha256),
      }
    } catch (error) {
      throw mapApiError(error, id)
    }
  }

  async putDocument(
    id: string,
    bundle: Uint8Array,
    baseContentRevision: string | null,
  ): Promise<{ contentRevision: string }> {
    const { contentRevision } = await this.putDocumentDetailed(id, bundle, baseContentRevision)
    return { contentRevision }
  }

  async archiveDocument(id: string): Promise<void> {
    try {
      await this.client().archiveDocument({ workspaceId: this.workspaceId(), documentId: id })
    } catch (error) {
      // "Archiving an id that does not exist is not an error" — the interface says
      // so, and local mode behaves that way. The API answers `404`, so the
      // difference is absorbed here rather than at every call site.
      //
      // Narrowed to a genuine `404` from the API: a `WorkspaceNotFoundError` raised
      // for any other reason, or a mapped `SessionExpiredError`, must still
      // propagate. Swallowing on the mapped type would also swallow a `404` that
      // meant "your session ended and the route rejected you".
      if (error instanceof ApiError && error.status === 404) {
        return
      }
      throw mapApiError(error, id)
    }
  }
}
