/**
 * The one place workspace mode changes what the app renders.
 *
 * With `VITE_WORKSPACE_MODE` off, `isWorkspaceMode()` is false and this component
 * returns `children` before touching any workspace state — no client is built, no
 * bridge installed, no request made. That is what keeps the certified offline
 * payload's behaviour byte-for-byte unchanged; the zero-network Playwright gate is
 * the evidence, not this comment.
 *
 * With it on, the gate owns the screens that come *before* an editor: sign in,
 * accept an invitation, choose a document. Once a document is open it renders
 * `children` — the ordinary editor — so the editor itself needs no knowledge of
 * workspaces beyond its save button.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { isWorkspaceMode } from '@/storage/workspaceMode'
import { createBrowserDocumentBridge } from './browserBridge'
import { readInviteToken } from './inviteToken'
import { AcceptInviteScreen } from './components/AcceptInviteScreen'
import { LoginScreen } from './components/LoginScreen'
import { WorkspaceLibrary } from './components/WorkspaceLibrary'
import { ConflictNotice } from './components/ConflictNotice'
import {
  acceptInvite,
  archiveDocument,
  configureWorkspaceSession,
  getWorkspaceState,
  login,
  logout,
  dismissConflict,
  downloadRefusedVersion,
  openDocument,
  reloadServerVersion,
  selectWorkspace,
} from './session'
import { useWorkspaceState } from './useWorkspaceState'

export function WorkspaceGate({ children }: { children: ReactNode }) {
  // Read before any hook that would do work, but *after* the hooks themselves are
  // declared, so the hook order is identical in both modes. `isWorkspaceMode()` is
  // a build-time constant, so this branch is stable for the life of the process.
  const enabled = isWorkspaceMode()
  const state = useWorkspaceState()
  const [inviteDismissed, setInviteDismissed] = useState(false)

  useEffect(() => {
    if (!enabled) {
      return
    }
    configureWorkspaceSession({ bridge: createBrowserDocumentBridge() })
  }, [enabled])

  if (!enabled) {
    return children
  }

  const inviteToken = readInviteToken(
    typeof window === 'undefined' ? '' : window.location.search,
  )

  if (state.user === null) {
    if (inviteToken !== null && !inviteDismissed) {
      return (
        <AcceptInviteScreen
          notice={state.notice}
          busy={state.busy}
          onSubmit={(password) => {
            void acceptInvite(inviteToken, password).then((result) => {
              // Only on success. A failed redemption keeps the form up with its
              // "no longer valid" notice, rather than bouncing the user to a login
              // screen that does not explain what just happened.
              if (result !== null) {
                setInviteDismissed(true)
                window.history.replaceState({}, '', window.location.pathname)
              }
            })
          }}
          onCancel={() => {
            setInviteDismissed(true)
            // Also drop the token from the URL, so a cancelled invitation does not
            // reappear on the next reload. `replaceState` rather than a navigation:
            // navigating would discard an editor buffer this gate has no right to
            // touch.
            window.history.replaceState({}, '', window.location.pathname)
          }}
        />
      )
    }
    return (
      <LoginScreen
        notice={state.notice}
        busy={state.busy}
        // Keyed so a prefill arriving after the form has mounted actually reaches
        // the input: `useState(initialEmail)` only reads its argument on the first
        // render, so without a remount the redeemed address would be ignored — the
        // exact way an "initial value" prop silently becomes dead.
        key={state.prefillEmail ?? 'signed-out'}
        initialEmail={state.prefillEmail ?? undefined}
        onSubmit={(email, password) => {
          void login(email, password)
        }}
      />
    )
  }

  if (state.screen !== 'editor') {
    return (
      <WorkspaceLibrary
        email={state.user.email}
        workspaces={state.workspaces}
        activeWorkspaceId={state.activeWorkspaceId}
        documents={state.documents}
        notice={state.notice}
        busy={state.busy}
        onSelectWorkspace={(workspaceId) => {
          void selectWorkspace(workspaceId)
        }}
        onOpen={(documentId) => {
          void openDocument(documentId)
        }}
        onArchive={(documentId) => {
          void archiveDocument(documentId)
        }}
        onLogout={() => {
          void logout()
        }}
      />
    )
  }

  // The editor, with the refusal notice floating above it when there is one.
  //
  // Rendered over the editor rather than replacing it, on purpose: the user's
  // unsaved work is in that editor, and a full-screen error that hid it would make
  // "your work is still here" a claim they cannot check.
  return (
    <>
      {state.conflict === null ? null : (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-4">
          <div className="pointer-events-auto w-full max-w-xl">
            <ConflictNotice
              conflict={state.conflict}
              onReload={() => {
                void reloadServerVersion(true)
              }}
              onDownload={() => {
                downloadRefusedVersion(openDocumentName(state))
              }}
              onDismiss={dismissConflict}
            />
          </div>
        </div>
      )}
      {children}
    </>
  )
}

/** The open document's title, for naming a downloaded fallback copy. */
function openDocumentName(state: ReturnType<typeof getWorkspaceState>): string {
  const id = state.open?.documentId
  return state.documents.find((document) => document.id === id)?.name ?? 'Untitled'
}
