/**
 * Whether workspace mode is switched on.
 *
 * A leaf module with no imports, extracted from `src/storage/index.ts` — the same
 * move, for the same reason, as `src/ai/endpoint.ts`.
 *
 * The predicate needs nothing but an environment variable, but it is read by
 * `src/ai/capabilities.ts` and `src/workspace/WorkspaceGate.tsx`, and importing it
 * from the `@/storage` barrel dragged both storage adapters — and, once CLI-517
 * landed, the entire vendored API client — into those modules' graphs. That is not
 * hypothetical: it pushed `src/ai/__tests__/entryPoints.test.ts` about 12% slower,
 * which was enough to breach vitest's 5s default on the Windows runner while every
 * macOS run stayed green.
 *
 * `@/storage` still re-exports this, so the public surface is unchanged.
 */

/**
 * Opt-in by exact value. Anything else — unset, empty, `false`, `0`, or a typo — is
 * local mode. The alternative, treating any non-empty string as truthy, would make
 * `VITE_WORKSPACE_MODE=false` enable workspace mode.
 */
export function isWorkspaceMode(): boolean {
  const raw = (import.meta.env?.VITE_WORKSPACE_MODE as string | undefined) ?? ''
  const value = raw.trim().toLowerCase()
  return value === 'true' || value === '1'
}
