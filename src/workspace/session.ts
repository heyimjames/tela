/**
 * The workspace session: everything the hosted UX does, as a plain module.
 *
 * ## Why the behaviour is not in the components
 *
 * This repo's vitest runs `environment: 'node'` with no jsdom and no
 * `@testing-library/react` — and the Lessons Log records, from CLI-513, that the
 * substitute (`renderToStaticMarkup`) resolves store reads to their *initial*
 * snapshot, so a UI assertion driven through a store is satisfied whether or not
 * the behaviour exists. Putting the conflict rules inside components would make the
 * one behaviour CLI-517 must guarantee untestable in this harness.
 *
 * So the rules live here, in a controller a test can drive for real, and the
 * components are thin: they read this state and call these methods. What the user
 * sees is asserted separately by rendering components with explicit props.
 *
 * ## The refusal contract
 *
 * A `409` means the server wrote **nothing**. On that path this controller:
 *
 *  - never calls `bridge.apply` (the only way the editor buffer can be replaced),
 *  - never re-issues the `PUT`, with the same base or a rebased one,
 *  - records `expected`/`actual` so the user can inspect them,
 *  - and waits for the user to choose: reload the server's copy (destructive,
 *    confirmed) or download their own copy (lossless).
 *
 * Auto-merge and retry are out of scope by project decision, not by omission.
 */

import type { WorkspaceMembership, User } from '@performance-clickt/design-api-client'
import { ConflictError } from '@/storage/StorageAdapter'
import type { DocumentSummary } from '@/storage/StorageAdapter'
import { WorkspaceStorageAdapter } from '@/storage/WorkspaceStorageAdapter'
import { getDesignApiClient } from './client'
import type { DocumentBridge } from './documentBridge'
import { setActiveWorkspaceId } from './activeWorkspace'
import {
  RateLimitedError,
  SessionExpiredError,
  describeWorkspaceError,
  mapApiError,
} from './errors'
import { UnexpectedResponseError } from './responseShape'

/** What the app is showing. A closed set, so a component can switch exhaustively. */
export type WorkspaceScreen = 'signed-out' | 'accept-invite' | 'library' | 'editor'

/** The conflict the user has to resolve. `null` whenever there isn't one. */
export interface ConflictReport {
  readonly documentId: string
  /** The revision the edit was based on — what this client sent. */
  readonly baseContentRevision: string | null
  /** The revision the server actually holds. */
  readonly actualContentRevision: string
  /** Bytes the save would have written. Held so "download my version" cannot fail. */
  readonly refusedBundle: Uint8Array
}

export interface WorkspaceState {
  readonly screen: WorkspaceScreen
  readonly user: User | null
  readonly workspaces: readonly WorkspaceMembership[]
  readonly activeWorkspaceId: string | null
  readonly documents: readonly DocumentSummary[]
  /** The open document and the revision its bytes were read at. */
  readonly open: { readonly documentId: string; readonly contentRevision: string } | null
  readonly conflict: ConflictReport | null
  /** A message for the user. Never an internal error string. */
  readonly notice: string | null
  readonly busy: boolean
  /**
   * The address to pre-fill on the sign-in form.
   *
   * Set after redeeming an invitation. The contract mints no session there, so the
   * user has to sign in — retyping the address they just proved they control would
   * be a pointless obstacle at the least forgiving moment in the flow.
   */
  readonly prefillEmail: string | null
  /**
   * True once a save was refused and not yet resolved. Distinct from `conflict`
   * only in that a component can render "unsaved" without reading revisions.
   */
  readonly hasUnsavedRefusal: boolean
}

const INITIAL: WorkspaceState = {
  screen: 'signed-out',
  user: null,
  workspaces: [],
  activeWorkspaceId: null,
  documents: [],
  open: null,
  conflict: null,
  notice: null,
  busy: false,
  prefillEmail: null,
  hasUnsavedRefusal: false,
}

let state: WorkspaceState = INITIAL
const listeners = new Set<() => void>()

function setState(patch: Partial<WorkspaceState>): void {
  // A fresh object every time: `useSyncExternalStore` compares snapshots by
  // identity, and mutating in place would leave React showing stale state.
  state = { ...state, ...patch }
  for (const listener of listeners) {
    listener()
  }
}

export function getWorkspaceState(): WorkspaceState {
  return state
}

export function subscribeWorkspace(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Drop all session state. Used by tests, and by logout. */
export function resetWorkspaceSessionForTests(): void {
  state = INITIAL
  setActiveWorkspaceId(null)
  bridge = null
  adapter = null
}

let bridge: DocumentBridge | null = null
let adapter: WorkspaceStorageAdapter | null = null

/**
 * Install the editor bridge and (optionally) an adapter.
 *
 * The app calls this once at startup with the browser bridge; tests call it with a
 * fake whose `apply` they can assert was never reached.
 */
export function configureWorkspaceSession(options: {
  bridge: DocumentBridge
  adapter?: WorkspaceStorageAdapter
}): void {
  bridge = options.bridge
  adapter = options.adapter ?? new WorkspaceStorageAdapter()
}

function requireBridge(): DocumentBridge {
  if (bridge === null) {
    throw new Error('workspace session used before configureWorkspaceSession()')
  }
  return bridge
}

function requireAdapter(): WorkspaceStorageAdapter {
  if (adapter === null) {
    throw new Error('workspace session used before configureWorkspaceSession()')
  }
  return adapter
}

/**
 * Route a `401` to the login screen without discarding anything.
 *
 * Returns `true` when it handled the error. The notice says explicitly that the
 * unsaved work is still there, because the alternative — a bare "signed out" —
 * leaves a user guessing whether their last hour survived.
 */
function handleSessionExpiry(error: unknown): boolean {
  if (!(error instanceof SessionExpiredError)) {
    return false
  }
  setState({
    screen: 'signed-out',
    user: null,
    workspaces: [],
    documents: [],
    busy: false,
    // `open` and `conflict` are deliberately NOT cleared, and the bridge is not
    // touched: the editor keeps whatever the user had. Signing back in returns them
    // to it.
    notice:
      'Your session ended, so that save did not go through. Your work is still open and unsaved — sign in again to save it.',
  })
  setActiveWorkspaceId(null)
  return true
}

/** Turn any failure into a user-facing notice, routing `401` to login. */
function fail(error: unknown): void {
  if (handleSessionExpiry(error)) {
    return
  }
  setState({ busy: false, notice: describeWorkspaceError(error) })
}

export async function login(email: string, password: string): Promise<void> {
  setState({ busy: true, notice: null })
  try {
    const session = await getDesignApiClient().login({ body: { email, password } })
    setState({
      screen: 'library',
      user: session.user,
      workspaces: session.workspaces,
      busy: false,
      notice: null,
    })
    // One workspace is the common case; selecting it saves a pointless click. More
    // than one, and the user picks — never guessed, because the choice decides where
    // their work is written.
    if (session.workspaces.length === 1) {
      await selectWorkspace(session.workspaces[0]!.workspaceId)
    }
  } catch (raised) {
    const error = mapApiError(raised)
    if (error instanceof RateLimitedError) {
      setState({ busy: false, notice: describeWorkspaceError(error) })
      return
    }
    // The exception the catch-all below must never swallow. An `UnexpectedResponseError`
    // means nothing answered in this API's shape — a misrouted base URL, a proxy error
    // page, an SPA fallback returning `index.html` at 200 — and calling that a wrong
    // password sends the user to reset a credential that was never checked. This is the
    // defect CLI-559 shipped, and this branch is where it stops being possible.
    if (error instanceof UnexpectedResponseError) {
      setState({ busy: false, notice: describeWorkspaceError(error) })
      return
    }
    // Every other login failure is one message. The server refuses to say whether
    // the email is known, and inventing that distinction here would rebuild the
    // account-enumeration oracle it deliberately closed.
    setState({ busy: false, notice: 'Email or password is incorrect.' })
  }
}

/**
 * Redeem an invite.
 *
 * The frozen contract does **not** mint a session here (`authenticated` is always
 * `false`), so this cannot land the user in their workspace — it lands them at the
 * login screen with their address filled in. See the deviation note on CLI-517.
 */
export async function acceptInvite(
  token: string,
  password: string,
): Promise<{ email: string; workspaceName: string } | null> {
  setState({ busy: true, notice: null })
  try {
    const result = await getDesignApiClient().acceptInvite({ body: { token, password } })
    setState({
      screen: 'signed-out',
      busy: false,
      prefillEmail: result.email,
      notice: `You've joined ${result.workspace.name}. Sign in with ${result.email} to continue.`,
    })
    return { email: result.email, workspaceName: result.workspace.name }
  } catch (raised) {
    // Same trap as `login`, one screen over: this catch-all speaks for a `400` the
    // server sent, and a response that never came from the server has no business
    // being described as an expired invite. Guarded before the fallback for the same
    // reason. (CLI-559.)
    if (raised instanceof UnexpectedResponseError) {
      setState({ busy: false, notice: describeWorkspaceError(raised) })
      return null
    }
    // Unknown, already-redeemed and expired are one `400` by design; the message
    // says the only true thing about all three.
    setState({ busy: false, notice: 'This invite is no longer valid. Ask for a new one.' })
    return null
  }
}

export async function selectWorkspace(workspaceId: string): Promise<void> {
  setActiveWorkspaceId(workspaceId)
  setState({ activeWorkspaceId: workspaceId, screen: 'library' })
  await refreshDocuments()
}

export async function refreshDocuments(): Promise<void> {
  setState({ busy: true })
  try {
    setState({ documents: await requireAdapter().listDocuments(), busy: false })
  } catch (error) {
    fail(error)
  }
}

export async function archiveDocument(documentId: string): Promise<void> {
  setState({ busy: true, notice: null })
  try {
    await requireAdapter().archiveDocument(documentId)
    setState({ busy: false })
    await refreshDocuments()
  } catch (error) {
    fail(error)
  }
}

/**
 * Open a document into the editor.
 *
 * Records the revision the bytes were read at. Every later save is based on it, and
 * that is the entire concurrency mechanism.
 */
export async function openDocument(documentId: string): Promise<void> {
  setState({ busy: true, notice: null })
  try {
    const { bundle, contentRevision } = await requireAdapter().getDocument(documentId)
    await requireBridge().apply(bundle)
    setState({
      screen: 'editor',
      open: { documentId, contentRevision },
      conflict: null,
      hasUnsavedRefusal: false,
      busy: false,
    })
  } catch (error) {
    fail(error)
  }
}

/** What a save attempt did. Returned so a caller can react without reading state. */
export type SaveOutcome =
  | { readonly kind: 'saved' }
  | { readonly kind: 'refused'; readonly conflict: ConflictReport }
  | { readonly kind: 'rename-not-stored' }
  | { readonly kind: 'failed' }

export async function saveDocument(): Promise<SaveOutcome> {
  const open = state.open
  if (open === null) {
    setState({ notice: 'No workspace document is open.' })
    return { kind: 'failed' }
  }
  setState({ busy: true, notice: null })

  // Captured once, before the request. The same bytes are what a refusal hands back
  // to the user, so a save and its fallback download can never disagree.
  const bundle = requireBridge().capture()

  try {
    const result = await requireAdapter().putDocumentDetailed(
      open.documentId,
      bundle,
      open.contentRevision,
    )
    if (!result.storedOurBytes) {
      // Accepted, but the server kept its earlier bytes: creative content did not
      // change, so there was no revision to append and the rename is not durable.
      // Not an error, and explicitly not retried — the same bytes reach the same
      // outcome. The user is told rather than left to discover it later.
      setState({
        open: { documentId: open.documentId, contentRevision: result.contentRevision },
        busy: false,
        hasUnsavedRefusal: false,
        notice:
          'Saved. The name change is not stored on the server yet — only design changes create a new version.',
      })
      return { kind: 'rename-not-stored' }
    }
    setState({
      open: { documentId: open.documentId, contentRevision: result.contentRevision },
      conflict: null,
      hasUnsavedRefusal: false,
      busy: false,
      notice: 'Saved.',
    })
    return { kind: 'saved' }
  } catch (error) {
    if (error instanceof ConflictError) {
      const conflict: ConflictReport = {
        documentId: open.documentId,
        baseContentRevision: error.baseContentRevision,
        actualContentRevision: error.actualContentRevision,
        refusedBundle: bundle,
      }
      // Nothing else happens here. No retry, no rebase, no `bridge.apply`. The held
      // revision stays as it was, so a blind second click reproduces the same
      // refusal rather than silently succeeding against a moved target.
      setState({
        conflict,
        hasUnsavedRefusal: true,
        busy: false,
        notice: null,
      })
      return { kind: 'refused', conflict }
    }
    fail(error)
    return { kind: 'failed' }
  }
}

/**
 * Resolve a conflict by taking the server's version, **discarding local edits**.
 *
 * `confirmed` is not a default-true parameter and not a boolean the caller can
 * forget: passing anything but `true` is refused. This is the only path in the
 * controller that destroys the user's work, and it should be impossible to reach by
 * accident.
 */
export async function reloadServerVersion(confirmed: boolean): Promise<boolean> {
  const conflict = state.conflict
  if (conflict === null) {
    return false
  }
  if (confirmed !== true) {
    setState({ notice: 'Not reloaded — your work is still here, unsaved.' })
    return false
  }
  setState({ busy: true, notice: null })
  try {
    const { bundle, contentRevision } = await requireAdapter().getDocument(conflict.documentId)
    await requireBridge().apply(bundle)
    setState({
      open: { documentId: conflict.documentId, contentRevision },
      conflict: null,
      hasUnsavedRefusal: false,
      busy: false,
      notice: 'Loaded the current version from the server. Your earlier edits were discarded.',
    })
    return true
  } catch (error) {
    // A failed reload leaves the conflict standing, which is right: the user's work
    // is still in the editor and still the only copy.
    fail(error)
    return false
  }
}

/** Resolve a conflict by keeping local work as a file. Never destructive. */
export function downloadRefusedVersion(documentName: string): void {
  requireBridge().download(documentName)
  setState({
    notice: 'Downloaded your version. It is still open here, and still unsaved on the server.',
  })
}

/** Dismiss the conflict banner. The refusal stands and the work stays put. */
export function dismissConflict(): void {
  setState({ conflict: null, notice: null })
}

export async function logout(): Promise<void> {
  setState({ busy: true })
  try {
    await getDesignApiClient().logout()
  } catch {
    // Logout is idempotent server-side and the local state must be cleared either
    // way: a user who clicked "sign out" and saw an error would reasonably believe
    // they were still signed in.
  }
  state = INITIAL
  setActiveWorkspaceId(null)
  setState({ notice: 'Signed out.' })
}
