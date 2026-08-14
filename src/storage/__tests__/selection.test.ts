/**
 * Which adapter a build talks to, and the guarantee that the answer is "local"
 * unless someone deliberately says otherwise.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getStorageAdapter, isWorkspaceMode, resetStorageAdapterForTests } from '../index'
import { LocalStorageAdapter } from '../LocalStorageAdapter'
import { WorkspaceStorageAdapter } from '../WorkspaceStorageAdapter'

describe('getStorageAdapter', () => {
  beforeEach(() => resetStorageAdapterForTests())
  afterEach(() => {
    vi.unstubAllEnvs()
    resetStorageAdapterForTests()
  })

  it('returns the local adapter when the flag is unset', () => {
    expect(isWorkspaceMode()).toBe(false)
    expect(getStorageAdapter()).toBeInstanceOf(LocalStorageAdapter)
  })

  it('returns the same instance on repeated calls', () => {
    expect(getStorageAdapter()).toBe(getStorageAdapter())
  })

  it('selects workspace mode only for an explicit opt-in', () => {
    // Proves the workspace branch is compiled in and reachable — inert by default,
    // not absent. A build where this branch had been tree-shaken away would fail.
    for (const value of ['true', 'TRUE', '1', ' true ']) {
      resetStorageAdapterForTests()
      vi.stubEnv('VITE_WORKSPACE_MODE', value)
      expect(getStorageAdapter()).toBeInstanceOf(WorkspaceStorageAdapter)
    }
  })

  it('treats anything else as local', () => {
    // `false` is the one that matters: a truthiness check on a non-empty string
    // would read VITE_WORKSPACE_MODE=false as "on".
    for (const value of ['', 'false', 'FALSE', '0', 'no', 'ture', 'yes']) {
      resetStorageAdapterForTests()
      vi.stubEnv('VITE_WORKSPACE_MODE', value)
      expect(getStorageAdapter()).toBeInstanceOf(LocalStorageAdapter)
    }
  })
})
