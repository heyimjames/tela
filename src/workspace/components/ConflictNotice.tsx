/**
 * The refusal.
 *
 * This component is the user-facing half of the one behaviour CLI-517 must not get
 * wrong, so its wording is part of the contract, not decoration:
 *
 *  - it says the save was **refused**, not "failed" — nothing was written, and the
 *    difference decides whether a user goes looking for a half-saved document;
 *  - it says the work is **still here, unsaved**, because the fear a conflict
 *    creates is that the work is gone;
 *  - it offers a lossless way out (download) alongside the destructive one (reload),
 *    and the destructive one carries its own confirmation step;
 *  - it exposes both revisions, so an operator can inspect what actually happened.
 *
 * Entirely props-driven, and it holds exactly one piece of local state: whether the
 * reload confirmation is showing. That state cannot destroy anything on its own —
 * `onReload` is only reachable from the confirmed branch.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ConflictReport } from '../session'

export interface ConflictNoticeProps {
  readonly conflict: ConflictReport
  /** Called only after the user confirms. Discards their edits. */
  readonly onReload: () => void
  /** Saves the user's version to disk. Never destructive. */
  readonly onDownload: () => void
  readonly onDismiss: () => void
}

export function ConflictNotice({ conflict, onReload, onDownload, onDismiss }: ConflictNoticeProps) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div
      role="alertdialog"
      aria-labelledby="workspace-conflict-title"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
    >
      <h2 id="workspace-conflict-title" className="font-semibold">
        Save refused — this document changed on the server
      </h2>
      <p className="mt-1">
        Someone else saved this document after you opened it, so nothing was written. Your work is
        still here in the editor, unsaved.
      </p>

      {confirming ? (
        <div className="mt-3 space-y-2">
          <p className="font-medium">
            Load the server’s version and discard your unsaved edits? This cannot be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" onClick={onReload}>
              Discard my edits and reload
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep my edits
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onDownload}>
            Download my version (.tela)
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
            Reload the server’s version…
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
        <dt>Your base revision</dt>
        <dd data-testid="conflict-base-revision">{conflict.baseContentRevision ?? '(none)'}</dd>
        <dt>Server revision</dt>
        <dd data-testid="conflict-actual-revision">{conflict.actualContentRevision}</dd>
      </dl>
    </div>
  )
}
