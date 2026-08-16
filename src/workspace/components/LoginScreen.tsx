/**
 * Sign in.
 *
 * Everything the tests assert arrives as a prop. Nothing is read from a store here,
 * because the repo's UI tests render with `renderToStaticMarkup`, where a store read
 * resolves to its initial snapshot and an assertion about rendered state can pass
 * whether or not the state was ever applied (CLI-513).
 *
 * **There is no account-creation path, and there must never be one.** This product
 * is invite-only: users arrive through `?invite=<token>`. A self-service enrolment
 * link here would be the public enrolment route the project forbids in every
 * milestone, which `__tests__/inviteOnly.test.ts` enforces over both this file's
 * rendered output and the whole of `src/`. (The forbidden phrases are deliberately
 * not written out in this comment, so that sweep can assert zero occurrences rather
 * than maintain a list of exceptions that would grow until it hid a real one.)
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface LoginScreenProps {
  /** A message from the last attempt, or the session that just ended. */
  readonly notice: string | null
  readonly busy: boolean
  /** Pre-filled after redeeming an invite, so the user does not retype it. */
  readonly initialEmail?: string
  readonly onSubmit: (email: string, password: string) => void
}

export function LoginScreen({ notice, busy, initialEmail, onSubmit }: LoginScreenProps) {
  const [email, setEmail] = useState(initialEmail ?? '')
  const [password, setPassword] = useState('')

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <form
        className="w-full max-w-sm space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(email, password)
        }}
      >
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">Pyrito Design workspaces.</p>
        </div>

        {notice === null ? null : (
          <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
            {notice}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="workspace-email">Email</Label>
          <Input
            id="workspace-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="workspace-password">Password</Label>
          <Input
            id="workspace-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>

        <p className="text-xs text-muted-foreground">
          Access is by invitation. If you have an invitation link, open it to join.
        </p>
      </form>
    </div>
  )
}
