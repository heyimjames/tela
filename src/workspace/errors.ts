/**
 * The API's failures, translated into the small closed set this app branches on.
 *
 * The generated client already throws typed errors (`ApiError`, `ConflictError`,
 * `ValidationError`). This module exists because the app needs to branch on
 * *situations* — "your session ended", "you can't see that workspace", "the server
 * refused these bytes" — and because one of those translations is a trap:
 *
 * **The client's `ConflictError` names its revisions the opposite way round from
 * the storage seam's.** In `@performance-clickt/design-api-client`:
 *
 *   - `expected` — the revision the **server** actually holds
 *   - `actual`   — the base the **caller** sent
 *
 * In `src/storage/StorageAdapter.ts`:
 *
 *   - `baseContentRevision`   — the base the **caller** sent
 *   - `actualContentRevision` — the revision the **store** actually holds
 *
 * So `actual` maps to `baseContentRevision` and `expected` maps to
 * `actualContentRevision`, and the two properties that share the name `actual`
 * mean opposite things. Swapping them compiles, type-checks, and produces a
 * conflict dialog that tells the user to rebase onto their own stale revision.
 * `toStorageConflict` is the single place that translation happens, and
 * `__tests__/conflictMapping.test.ts` pins it in both directions.
 */

import { ApiError, ConflictError as ClientConflictError, ValidationError } from '@performance-clickt/design-api-client'
import type { BundleRejectionCode } from '@performance-clickt/design-api-client'
import { ConflictError as StorageConflictError } from '@/storage/StorageAdapter'
import { UnexpectedResponseError } from './responseShape'

/**
 * The session is gone — expired, revoked, or never established.
 *
 * Callers route this to the login screen. It is deliberately a distinct type
 * rather than a status check at every call site, because *every* call can raise it.
 */
export class SessionExpiredError extends Error {
  constructor(message = 'Your session has ended. Sign in again to continue.') {
    super(message)
    // Set explicitly: a downlevelled class extension can leave this as 'Error',
    // and a caller matching on the name would stop recognising it.
    this.name = 'SessionExpiredError'
  }
}

/**
 * A `404` on a workspace or document.
 *
 * The server answers `404` for "does not exist" and for "exists, but you are not a
 * member" with the same body, on purpose — distinguishing them would let anyone
 * enumerate which workspaces exist. This type carries that ambiguity forward, and
 * its message is worded so the UI cannot accidentally assert either half.
 */
export class WorkspaceNotFoundError extends Error {
  constructor(message = 'Not found, or not shared with your account.') {
    super(message)
    this.name = 'WorkspaceNotFoundError'
  }
}

/** `422 bundle_rejected` — the server's `.tela` validator refused these bytes. */
export class BundleRejectedError extends Error {
  readonly rejectionCode: BundleRejectionCode
  readonly detail: string | undefined

  constructor(rejectionCode: BundleRejectionCode, message: string, detail?: string) {
    super(message)
    this.name = 'BundleRejectedError'
    this.rejectionCode = rejectionCode
    this.detail = detail
  }
}

/** `429` — too many attempts. `retryAfterSeconds` is the server's own `Retry-After`. */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number | undefined

  constructor(retryAfterSeconds: number | undefined, message = 'Too many attempts.') {
    super(message)
    this.name = 'RateLimitedError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * `409 document_archived` — the document is archived and refuses writes.
 *
 * Separated from a revision conflict because the remedy is different: rebasing
 * cannot help, and offering "reload the server's version" would be a dead end.
 */
export class DocumentArchivedError extends Error {
  constructor(message = 'This document is archived, so it can no longer be saved to.') {
    super(message)
    this.name = 'DocumentArchivedError'
  }
}

/**
 * Translate a client `ConflictError` into the storage seam's `ConflictError`.
 *
 * The whole reason this function exists is the property-name inversion documented
 * at the top of this file. Read the mapping as: *whatever the server holds* becomes
 * `actualContentRevision`; *whatever we sent* becomes `baseContentRevision`.
 */
export function toStorageConflict(documentId: string, error: ClientConflictError): StorageConflictError {
  return new StorageConflictError(
    documentId,
    // The base *we* sent. The client calls this `actual`.
    error.actual,
    // The revision the *server* holds. The client calls this `expected`, and it is
    // `null` when the server has no revision at all; the storage type wants a
    // string, and '(none)' is the honest rendering of "the server holds nothing".
    error.expected ?? '(none)',
  )
}

/**
 * Map anything the client threw onto this app's vocabulary.
 *
 * Errors that are not `ApiError` — a `TypeError` from a dropped connection, say —
 * pass through untouched. Wrapping them would replace a real network diagnostic
 * with a vaguer one.
 *
 * `documentId` is only needed for the conflict branch; callers that cannot conflict
 * may omit it.
 */
export function mapApiError(error: unknown, documentId?: string): unknown {
  if (error instanceof ClientConflictError) {
    return toStorageConflict(documentId ?? '(unknown)', error)
  }
  if (error instanceof ValidationError) {
    return new BundleRejectedError(error.rejectionCode, error.message, error.detail)
  }
  if (!(error instanceof ApiError)) {
    return error
  }
  if (error.status === 401 || error.code === 'unauthenticated') {
    return new SessionExpiredError()
  }
  if (error.status === 404 || error.code === 'not_found' || error.code === 'route_not_found') {
    return new WorkspaceNotFoundError()
  }
  if (error.status === 429 || error.code === 'rate_limited') {
    return new RateLimitedError(error.retryAfterSeconds)
  }
  if (error.code === 'document_archived') {
    return new DocumentArchivedError()
  }
  return error
}

/**
 * A message safe to put in front of a user.
 *
 * Deliberately does not fall through to `error.message` for an unrecognised
 * `ApiError`: server-authored strings are written for operators, and a `500`'s
 * message is not something to render into a dialog.
 */
export function describeWorkspaceError(error: unknown): string {
  if (
    error instanceof SessionExpiredError ||
    error instanceof WorkspaceNotFoundError ||
    error instanceof DocumentArchivedError ||
    error instanceof BundleRejectedError
  ) {
    return error.message
  }
  if (error instanceof UnexpectedResponseError) {
    // Deliberately says nothing about credentials, permissions or the document. The
    // honest content of this failure is "whatever answered was not this API".
    //
    // It names two causes rather than one, because the guard cannot tell them apart
    // and should not pretend to: a misrouted base URL (CLI-559's defect) and a proxy
    // or gateway answering in the API's place (an outage, an error page) produce the
    // same wrong-shaped body. Blaming only the address would send a reader hunting a
    // build flag during what is actually a server outage. The technical detail —
    // status, content type, URL — stays on the thrown error, where a developer
    // console shows it, rather than in a dialog.
    return (
      'The server sent an unexpected response, so the app could not read it. ' +
      'The API address may be wrong, or something between the app and the API answered instead.'
    )
  }
  if (error instanceof RateLimitedError) {
    const wait = error.retryAfterSeconds
    return wait === undefined
      ? 'Too many attempts. Wait a moment and try again.'
      : `Too many attempts. Try again in ${wait} second${wait === 1 ? '' : 's'}.`
  }
  if (error instanceof StorageConflictError) {
    return 'Saving was refused: this document changed on the server since you opened it.'
  }
  if (error instanceof ApiError) {
    return `The server could not complete that request (${error.status}).`
  }
  return 'Something went wrong. Your work has not been changed.'
}
