/**
 * The session controller: login, invite redemption, expiry, logout.
 *
 * Driven through the fake wire server, so the `401`/`429`/`400` branches are taken
 * because the server sent those statuses, not because a mock was told to.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { WorkspaceStorageAdapter } from '@/storage/WorkspaceStorageAdapter'
import { createDesignApiClient, setDesignApiClientForTests } from '../client'
import { getActiveWorkspaceId } from '../activeWorkspace'
import {
  acceptInvite,
  archiveDocument,
  configureWorkspaceSession,
  getWorkspaceState,
  login,
  logout,
  openDocument,
  refreshDocuments,
  resetWorkspaceSessionForTests,
  saveDocument,
  selectWorkspace,
} from '../session'
import { FakeServer, fakeBundle } from './fakeServer'
import type { DocumentBridge } from '../documentBridge'

const CREDENTIALS = { email: 'designer@example.test', password: 'correct horse battery staple' }

function fakeBridge(initial: Uint8Array) {
  const applied: Uint8Array[] = []
  let buffer = initial
  const bridge: DocumentBridge = {
    capture: () => buffer,
    apply: async (bundle) => {
      applied.push(bundle)
      buffer = bundle
    },
    download: () => {},
  }
  return { bridge, applied, current: () => buffer, edit: (b: Uint8Array) => { buffer = b } }
}

function wire(server: FakeServer) {
  const client = createDesignApiClient({ fetch: server.fetch, baseUrl: '/' })
  setDesignApiClientForTests(client)
  const adapter = new WorkspaceStorageAdapter({
    client: () => client,
    workspaceId: () => server.workspaceId,
  })
  const editor = fakeBridge(fakeBundle('Poster', { v: 'local' }))
  configureWorkspaceSession({ bridge: editor.bridge, adapter })
  return { client, adapter, editor }
}

function serverWithDocument(): FakeServer {
  return new FakeServer({
    documents: [
      {
        id: 'doc-1',
        title: 'Poster',
        contentRevision: null,
        bundle: null,
        archivedAt: null,
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      },
    ],
  })
}

describe('login', () => {
  beforeEach(() => {
    resetWorkspaceSessionForTests()
    setDesignApiClientForTests(null)
  })

  it('signs in, lists workspaces, and auto-selects the only one', async () => {
    const server = serverWithDocument()
    wire(server)

    await login(CREDENTIALS.email, CREDENTIALS.password)

    const state = getWorkspaceState()
    expect(state.screen).toBe('library')
    expect(state.user?.email).toBe(CREDENTIALS.email)
    expect(state.workspaces).toHaveLength(1)
    expect(state.activeWorkspaceId).toBe(server.workspaceId)
    // The adapter's workspace is set as a side effect, or every later call fails.
    expect(getActiveWorkspaceId()).toBe(server.workspaceId)
    // Auto-selecting the sole workspace also fetched its library — the assertion
    // that proves the selection did something, rather than only setting a field.
    expect(state.documents.map((document) => document.id)).toEqual(['doc-1'])
  })

  it('gives one message for a wrong password and an unknown email', async () => {
    const server = serverWithDocument()
    wire(server)

    await login(CREDENTIALS.email, 'wrong')
    const wrongPassword = getWorkspaceState().notice

    resetWorkspaceSessionForTests()
    wire(server)
    await login('nobody@example.test', CREDENTIALS.password)
    const unknownEmail = getWorkspaceState().notice

    // Pinned absolutely first, so "they match" cannot be satisfied by both being
    // null or both being some unrelated failure.
    expect(wrongPassword).toBe('Email or password is incorrect.')
    expect(unknownEmail).toBe(wrongPassword)
    expect(getWorkspaceState().screen).toBe('signed-out')
    expect(getWorkspaceState().user).toBeNull()
  })

  it('reports the Retry-After wait on a rate limit', async () => {
    const server = serverWithDocument()
    server.rateLimitLoginFor = 42
    wire(server)

    await login(CREDENTIALS.email, CREDENTIALS.password)

    expect(getWorkspaceState().notice).toContain('42 seconds')
    expect(getWorkspaceState().screen).toBe('signed-out')
  })

  it('singularises a one-second wait', async () => {
    const server = serverWithDocument()
    server.rateLimitLoginFor = 1
    wire(server)

    await login(CREDENTIALS.email, CREDENTIALS.password)

    expect(getWorkspaceState().notice).toContain('1 second.')
  })
})

describe('invite acceptance', () => {
  beforeEach(() => {
    resetWorkspaceSessionForTests()
    setDesignApiClientForTests(null)
  })

  it('joins the workspace and sends the user to sign in, because no session is minted', async () => {
    const server = serverWithDocument()
    wire(server)

    const result = await acceptInvite('good-token', 'a new password')

    expect(result).toEqual({ email: CREDENTIALS.email, workspaceName: 'Studio' })
    // The frozen contract returns `authenticated: false` on purpose. Landing the
    // user "in their workspace" would mean inventing a session the API refused.
    expect(getWorkspaceState().screen).toBe('signed-out')
    expect(getWorkspaceState().user).toBeNull()
    expect(getWorkspaceState().notice).toContain('Studio')
    expect(getWorkspaceState().notice).toContain(CREDENTIALS.email)
  })

  it('gives one clear message for an expired, unknown or already-used token', async () => {
    const server = serverWithDocument()
    wire(server)

    const result = await acceptInvite('stale-token', 'a new password')

    expect(result).toBeNull()
    expect(getWorkspaceState().notice).toBe('This invite is no longer valid. Ask for a new one.')
  })
})

describe('session expiry', () => {
  beforeEach(() => {
    resetWorkspaceSessionForTests()
    setDesignApiClientForTests(null)
  })

  it('routes a mid-session 401 to login without silently dropping the buffer', async () => {
    const server = serverWithDocument()
    const { adapter, editor } = wire(server)
    await login(CREDENTIALS.email, CREDENTIALS.password)
    await adapter.putDocument('doc-1', fakeBundle('Poster', { v: 'server' }), null)
    await openDocument('doc-1')

    const myWork = fakeBundle('Poster', { v: 'unsaved-and-precious' })
    editor.edit(myWork)
    const appliedBefore = editor.applied.length
    server.expireSessionOnNextCall = true

    const outcome = await saveDocument()

    expect(outcome.kind).toBe('failed')
    const state = getWorkspaceState()
    expect(state.screen).toBe('signed-out')
    expect(state.user).toBeNull()
    // The buffer is untouched, and the user is told so in words rather than left to
    // infer it from an empty screen.
    expect([...editor.current()]).toEqual([...myWork])
    expect(editor.applied).toHaveLength(appliedBefore)
    expect(state.notice).toMatch(/still open and unsaved/i)
    expect(state.notice).toMatch(/did not go through/i)
    // The open document is deliberately retained, so signing back in returns the
    // user to what they had.
    expect(state.open?.documentId).toBe('doc-1')
  })

  it('routes a 401 from a plain listing to login too', async () => {
    const server = serverWithDocument()
    wire(server)
    await login(CREDENTIALS.email, CREDENTIALS.password)
    server.expireSessionOnNextCall = true

    await refreshDocuments()

    expect(getWorkspaceState().screen).toBe('signed-out')
    expect(getActiveWorkspaceId()).toBeNull()
  })
})

describe('library', () => {
  beforeEach(() => {
    resetWorkspaceSessionForTests()
    setDesignApiClientForTests(null)
  })

  it('lists documents for the selected workspace', async () => {
    const server = serverWithDocument()
    const { adapter } = wire(server)
    await login(CREDENTIALS.email, CREDENTIALS.password)
    await adapter.putDocument('doc-1', fakeBundle('Poster', { v: 1 }), null)

    await selectWorkspace(server.workspaceId)

    expect(getWorkspaceState().documents.map((document) => document.name)).toEqual(['Poster'])
  })

  it('drops an archived document from the library', async () => {
    const server = serverWithDocument()
    const { adapter } = wire(server)
    await login(CREDENTIALS.email, CREDENTIALS.password)
    await adapter.putDocument('doc-1', fakeBundle('Poster', { v: 1 }), null)
    await refreshDocuments()
    expect(getWorkspaceState().documents).toHaveLength(1)

    await archiveDocument('doc-1')

    expect(getWorkspaceState().documents).toHaveLength(0)
    expect(server.documents.get('doc-1')?.archivedAt).not.toBeNull()
  })
})

describe('logout', () => {
  beforeEach(() => {
    resetWorkspaceSessionForTests()
    setDesignApiClientForTests(null)
  })

  it('calls the API, clears client state, and returns to login', async () => {
    const server = serverWithDocument()
    const { adapter } = wire(server)
    await login(CREDENTIALS.email, CREDENTIALS.password)
    await adapter.putDocument('doc-1', fakeBundle('Poster', { v: 1 }), null)
    await refreshDocuments()

    await logout()

    expect(server.requestsMatching('POST', '/v1/auth/logout')).toHaveLength(1)
    const state = getWorkspaceState()
    expect(state.screen).toBe('signed-out')
    expect(state.user).toBeNull()
    expect(state.workspaces).toHaveLength(0)
    expect(state.documents).toHaveLength(0)
    expect(state.open).toBeNull()
    expect(getActiveWorkspaceId()).toBeNull()
  })

  it('still signs the user out locally when the API call fails', async () => {
    const server = serverWithDocument()
    wire(server)
    await login(CREDENTIALS.email, CREDENTIALS.password)
    // A user who clicked "sign out" and stayed signed in would be a security bug,
    // not a cosmetic one.
    server.expireSessionOnNextCall = true

    await logout()

    expect(getWorkspaceState().screen).toBe('signed-out')
    expect(getWorkspaceState().user).toBeNull()
  })
})
