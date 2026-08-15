/**
 * The workspace library: pick a workspace, open a document, archive one.
 *
 * Props-driven, per `LoginScreen`'s note. The only local state is which document is
 * pending an archive confirmation — archiving is destructive enough to need one, and
 * cheap enough not to need a modal.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { DocumentSummary } from '@/storage/StorageAdapter'
import type { WorkspaceMembership } from '@performance-clickt/design-api-client'

export interface WorkspaceLibraryProps {
  readonly email: string
  readonly workspaces: readonly WorkspaceMembership[]
  readonly activeWorkspaceId: string | null
  readonly documents: readonly DocumentSummary[]
  readonly notice: string | null
  readonly busy: boolean
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onOpen: (documentId: string) => void
  readonly onArchive: (documentId: string) => void
  readonly onLogout: () => void
}

export function WorkspaceLibrary({
  email,
  workspaces,
  activeWorkspaceId,
  documents,
  notice,
  busy,
  onSelectWorkspace,
  onOpen,
  onArchive,
  onLogout,
}: WorkspaceLibraryProps) {
  const [pendingArchive, setPendingArchive] = useState<string | null>(null)

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workspaces</h1>
          <p className="text-sm text-muted-foreground">{email}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onLogout}>
          Sign out
        </Button>
      </header>

      {notice === null ? null : (
        <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
          {notice}
        </p>
      )}

      {workspaces.length > 1 ? (
        <nav className="flex flex-wrap gap-2">
          {workspaces.map((workspace) => (
            <Button
              key={workspace.workspaceId}
              size="sm"
              variant={workspace.workspaceId === activeWorkspaceId ? 'default' : 'outline'}
              onClick={() => onSelectWorkspace(workspace.workspaceId)}
            >
              {workspace.name}
            </Button>
          ))}
        </nav>
      ) : null}

      <section className="flex flex-col gap-2">
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {busy ? 'Loading…' : 'No documents in this workspace yet.'}
          </p>
        ) : (
          documents.map((document) => (
            <article
              key={document.id}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{document.name}</p>
                <p className="text-xs text-muted-foreground">
                  Updated {formatUpdatedAt(document.updatedAt)}
                </p>
              </div>

              {pendingArchive === document.id ? (
                <div className="flex shrink-0 gap-2">
                  <span className="self-center text-xs">Archive this document?</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setPendingArchive(null)
                      onArchive(document.id)
                    }}
                  >
                    Archive
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendingArchive(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" onClick={() => onOpen(document.id)}>
                    Open
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendingArchive(document.id)}>
                    Archive…
                  </Button>
                </div>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  )
}

/**
 * A readable date, or the raw string when it will not parse.
 *
 * Falling back to the raw value rather than rendering "Invalid Date": a timestamp
 * this client does not understand is still information, and a user can quote it.
 */
function formatUpdatedAt(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString()
}
