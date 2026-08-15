/**
 * Redeem an invitation.
 *
 * The token comes from the URL; the user chooses a password. On success the API
 * grants membership but **does not** issue a session — `authenticated` is always
 * `false`, deliberately, so that whoever holds the raw token cannot walk away
 * authenticated as the invited person. So this screen cannot drop the user into
 * their workspace: it hands them to the sign-in screen with their address known.
 *
 * All state that matters arrives as props, for the reason set out in `LoginScreen`.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface AcceptInviteScreenProps {
  readonly notice: string | null
  readonly busy: boolean
  readonly onSubmit: (password: string) => void
  readonly onCancel: () => void
}

export function AcceptInviteScreen({ notice, busy, onSubmit, onCancel }: AcceptInviteScreenProps) {
  const [password, setPassword] = useState('')

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <form
        className="w-full max-w-sm space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(password)
        }}
      >
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Accept your invitation</h1>
          <p className="text-sm text-muted-foreground">
            Choose a password to finish joining the workspace.
          </p>
        </div>

        {notice === null ? null : (
          <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
            {notice}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="invite-password">Password</Label>
          <Input
            id="invite-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            If this address already has a password, keep using that one — an invitation never
            changes it.
          </p>
        </div>

        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={busy}>
            {busy ? 'Joining…' : 'Join workspace'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
