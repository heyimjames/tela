/**
 * The AI gate's truth table, asserted across every layer that consumes it (CLI-534).
 *
 * Before CLI-534 the conjunction `aiEnabled AND endpoint-configured` was written out
 * three times: in `isAiEnabled()`, again inside the `useAiUiEnabled` hook, and again
 * inside `postCanvasAI`. The refactor left one statement of it in `@/ai/gate`. The risk
 * a refactor like that carries is not that the resolver is wrong — it is that one layer
 * quietly stops agreeing with the others, which is the same drift the issue set out to
 * remove, just relocated.
 *
 * So this suite does not test the resolver in isolation. For **every** row of the truth
 * table it drives each consumer layer and asserts they return the same answer:
 *
 * - the resolver (`isAiEnabled`)
 * - the UI predicate (`isAiUiEnabled`) and the composition the hook uses (`aiEnabledFor`)
 * - the agent-RPC dispatch gate (`src/agent/commands.ts`, via a real `relayoutFrame`)
 * - the network chokepoint (`postCanvasAI`)
 *
 * Two properties make the rows non-vacuous, both earned lessons:
 *
 * 1. **The enabled row really reaches AI.** `fetch` is replaced by a stub that throws a
 *    recognisable error, so "the gate was passed" is a positive signal rather than the
 *    absence of one — an all-rows-false table would otherwise be satisfied by a harness
 *    that could never enable AI (the CLI-513 vacuity trap).
 * 2. **The rows disagree with the wrong operator.** The two mixed rows (one half on, the
 *    other off) expect `false`, which is what `&&` gives and `||` does not, so flipping
 *    the composition fails this suite rather than passing it. The all-off and all-on
 *    rows catch a half pinned to a constant. The mutation sweep in the wrap-up records
 *    the run.
 *
 * The halves are asserted by name alongside the composite, which is what makes the
 * mutation check sharp: a table that only pinned the composite could not tell "the AND
 * is right" from "both halves happen to be misread the same way".
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

/** A shape gives the AI path something to re-compose, so `relayoutActiveFrame` cannot
 *  bail out on an empty frame — an escape hatch that would mask a missing gate. And
 *  unlike a text layer it needs no text measurement, so this runs on plain Node. */
const SEED_SHAPE = { op: 'addShape', width: 100, height: 100 } as const

const AI_REQUEST = {
  model: 'm',
  system: 's',
  messages: [{ role: 'user' as const, content: 'c' }],
  maxTokens: 1,
} as const

/** What the `fetch` stub throws. Reaching it means every gate was passed. */
const PAST_THE_GATE = 'fetch stub — the gate was passed'

async function load(options: { workspaceMode: boolean; endpoint: boolean; grant: boolean }) {
  vi.stubEnv('VITE_WORKSPACE_MODE', options.workspaceMode ? 'true' : '')
  vi.stubEnv('VITE_AI_API_ORIGIN', options.endpoint ? 'https://ai.example.test' : '')
  vi.resetModules()

  /**
   * `fetch` is replaced rather than left to fail on its own. This repo ships under a
   * zero-network contract (CLI-528), so a unit test that resolves a hostname is an
   * outbound attempt in CI even when it errors.
   */
  const reachedNetwork = vi.fn(async (): Promise<Response> => {
    throw new Error(PAST_THE_GATE)
  })
  vi.stubGlobal('fetch', reachedNetwork)

  const ai = await import('@/ai')
  if (options.grant) ai.adoptWorkspaceCapabilities({ aiEnabled: true })

  const { postCanvasAI } = await import('@/lib/aiApi')
  const { dispatch } = await import('@/agent/commands')

  return { ai, postCanvasAI, dispatch, reachedNetwork }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

interface Row {
  name: string
  workspaceMode: boolean
  endpoint: boolean
  grant: boolean
  /** The composed answer every layer must give. */
  expected: boolean
  /** What the workspace half alone must report — local mode forces it false. */
  workspaceHalf: boolean
}

/**
 * The four combinations of the two flags, plus the local-mode rows.
 *
 * `workspaceMode: true` throughout the core four because the workspace half is
 * unconditionally false without it (`getWorkspaceCapabilities` short-circuits), so a
 * table built in local mode would be four copies of one row.
 */
const TRUTH_TABLE: Row[] = [
  {
    name: 'neither half — the dormant default',
    workspaceMode: true, grant: false, endpoint: false,
    workspaceHalf: false, expected: false,
  },
  {
    name: 'workspace grants AI, but no endpoint is configured for this build',
    workspaceMode: true, grant: true, endpoint: false,
    workspaceHalf: true, expected: false,
  },
  {
    name: 'endpoint configured, but the workspace does not grant AI',
    workspaceMode: true, grant: false, endpoint: true,
    workspaceHalf: false, expected: false,
  },
  {
    name: 'both halves — the only combination that enables AI',
    workspaceMode: true, grant: true, endpoint: true,
    workspaceHalf: true, expected: true,
  },
  {
    name: 'local mode — what the certified offline payload ships as',
    workspaceMode: false, grant: false, endpoint: false,
    workspaceHalf: false, expected: false,
  },
  {
    name: 'local mode ignores a record granting AI, even with an endpoint',
    workspaceMode: false, grant: true, endpoint: true,
    workspaceHalf: false, expected: false,
  },
]

describe('every layer answers the gate identically, for every row of the truth table', () => {
  for (const row of TRUTH_TABLE) {
    it(row.name, async () => {
      const app = await load(row)

      // The halves, by name. Pinning these alongside the composite is what lets the
      // mutation sweep distinguish a broken conjunction from a misread half.
      expect(app.ai.workspaceAllowsAi(), 'workspace half').toBe(row.workspaceHalf)
      expect(app.ai.AI_ENDPOINT_CONFIGURED, 'endpoint half').toBe(row.endpoint)

      // Layer 1 + 2: the resolver, the UI predicate, and the hook's composition.
      const layers: Record<string, boolean> = {
        'isAiEnabled (resolver)': app.ai.isAiEnabled(),
        'isAiUiEnabled (UI predicate)': app.ai.isAiUiEnabled(),
        'aiEnabledFor (hook composition)': app.ai.aiEnabledFor(app.ai.getWorkspaceCapabilities()),
      }
      for (const [layer, value] of Object.entries(layers)) {
        expect(value, `${layer} disagreed with the truth table`).toBe(row.expected)
      }

      // Layer 3: the agent-RPC dispatch gate, driven through a real op.
      await app.dispatch(SEED_SHAPE)
      const rpc = await app.dispatch({ op: 'relayoutFrame' })
      const rpcRefusedByGate = rpc.ok === false && String(rpc.error).includes(app.ai.AI_DISABLED_MESSAGE)
      expect(rpcRefusedByGate, 'the RPC gate disagreed with the truth table').toBe(!row.expected)

      // Layer 4: the network chokepoint. When the gate is open the call reaches the
      // `fetch` stub — the positive signal that keeps every `false` row meaningful.
      if (row.expected) {
        await expect(app.postCanvasAI(AI_REQUEST)).rejects.toThrow(PAST_THE_GATE)
        expect(app.reachedNetwork, 'the open gate never reached the network').toHaveBeenCalled()
      } else {
        await expect(app.postCanvasAI(AI_REQUEST)).rejects.toThrow()
        expect(app.reachedNetwork, 'a closed gate reached the network').not.toHaveBeenCalled()
      }

      app.ai.resetWorkspaceCapabilitiesForTests()
    })
  }
})

describe('the collapse preserved which half reports the refusal', () => {
  /**
   * `postCanvasAI` deliberately checks the two halves as separate branches instead of
   * calling `isAiEnabled()`, because each produces a different error: a workspace
   * without the capability is refused in `DisabledAiProvider`'s vocabulary, while a
   * build with no endpoint is a deployment mistake that should say so. Collapsing it
   * to one predicate would have been a behaviour change, so the distinction is pinned
   * here — a later "simplification" to a single branch breaks this test rather than
   * silently changing what callers see.
   */
  it('capability off → the AI-disabled message; endpoint missing → the configuration message', async () => {
    const denied = await load({ workspaceMode: true, grant: false, endpoint: true })
    await expect(denied.postCanvasAI(AI_REQUEST)).rejects.toThrow(denied.ai.AI_DISABLED_MESSAGE)
    expect(denied.reachedNetwork).not.toHaveBeenCalled()
    denied.ai.resetWorkspaceCapabilitiesForTests()

    const unconfigured = await load({ workspaceMode: true, grant: true, endpoint: false })
    // Not the AI-disabled message: the workspace *did* grant the capability.
    await expect(unconfigured.postCanvasAI(AI_REQUEST)).rejects.toThrow(/VITE_AI_API_ORIGIN/)
    await expect(unconfigured.postCanvasAI(AI_REQUEST)).rejects.not.toThrow(
      unconfigured.ai.AI_DISABLED_MESSAGE,
    )
    expect(unconfigured.reachedNetwork).not.toHaveBeenCalled()
    unconfigured.ai.resetWorkspaceCapabilitiesForTests()
  })
})

/** The workspace half, however it is spelled — the raw field test or the named helper. */
const HALF_WORKSPACE = /aiEnabled\s*===\s*true|workspaceAllowsAi\s*\(/
/** The endpoint half. */
const HALF_ENDPOINT = /AI_ENDPOINT_CONFIGURED/

/**
 * Whether a module joins **both** halves in one `&&` expression.
 *
 * Order-independent and multi-line tolerant on purpose. A first version of this check
 * pinned the two orderings it expected (`aiEnabled === true &&` / `&& AI_ENDPOINT_CONFIGURED`)
 * and a re-composition written the other way round — `AI_ENDPOINT_CONFIGURED && workspaceAllowsAi()`
 * — walked straight past it. A guard that only catches the shape you happened to
 * imagine is the vacuity trap one level up: it reports "no drift" for a class of drift
 * it cannot see. Splitting on statement boundaries rather than newlines keeps a
 * conjunction spread over several lines in one piece.
 */
function composesBothHalves(code: string): boolean {
  return code
    .split(/[;{}]/)
    .some((statement) => statement.includes('&&') && HALF_WORKSPACE.test(statement) && HALF_ENDPOINT.test(statement))
}

describe('the conjunction is stated once', () => {
  /**
   * The detector's own self-test. `composesBothHalves` is the instrument every
   * assertion below depends on, so it is checked against known-positive and
   * known-negative samples rather than trusted — a detector that silently matches
   * nothing would report a clean tree forever.
   */
  it('the drift detector catches a re-composition in either order', () => {
    for (const positive of [
      'return workspaceAllowsAi(caps) && AI_ENDPOINT_CONFIGURED',
      'return AI_ENDPOINT_CONFIGURED && workspaceAllowsAi(caps)',
      'return caps.aiEnabled === true && AI_ENDPOINT_CONFIGURED',
      'return AI_ENDPOINT_CONFIGURED && caps.aiEnabled === true',
      'return (\n  workspaceAllowsAi(caps) &&\n  AI_ENDPOINT_CONFIGURED\n)',
    ]) {
      expect(composesBothHalves(positive), `missed: ${positive}`).toBe(true)
    }

    for (const negative of [
      'import { AI_ENDPOINT_CONFIGURED } from "@/ai/endpoint"',
      'if (!workspaceAllowsAi()) { throw x } if (!AI_ENDPOINT_CONFIGURED) { throw y }',
      'return workspaceAllowsAi(caps) && somethingElse',
      'return isAiEnabled() && userAskedForIt',
    ]) {
      expect(composesBothHalves(negative), `false positive: ${negative}`).toBe(false)
    }
  })

  /**
   * The structural half of this issue, asserted rather than described.
   *
   * The three former copies of the condition are gone; `@/ai/gate` is the only module
   * that mentions both halves in one expression. Reading the sources keeps this honest
   * as the app grows: a new call site that hand-rolls `aiEnabled === true && ...` puts
   * the drift seam straight back, and this fails the day it lands.
   */
  it('no module outside @/ai/gate composes the two halves itself', async () => {
    const { glob, readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const { join } = await import('node:path')

    const srcRoot = join(fileURLToPath(new URL('../../', import.meta.url)))
    const offenders: string[] = []
    let scanned = 0

    /** The one module allowed to state the conjunction, in POSIX form. */
    const RESOLVER = 'ai/gate.ts'
    let sawResolver = false

    for await (const entry of glob('**/*.{ts,tsx}', { cwd: srcRoot })) {
      // Normalised, because `glob` yields the platform separator: on Windows this is
      // `ai\gate.ts`, which silently missed the exemption below and made the resolver
      // report itself as an offender. Caught by CI on Windows while every local run
      // was green — a comparison against a hard-coded `/` path is not portable.
      const rel = String(entry).split(/[\\/]/).join('/')
      if (rel.includes('__tests__')) continue
      const source = await readFile(join(srcRoot, rel), 'utf8')
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      scanned += 1
      if (rel === RESOLVER) sawResolver = true
      if (composesBothHalves(code) && rel !== RESOLVER) offenders.push(rel)
    }

    // The scan must actually have read the tree — an empty sweep would "pass".
    expect(scanned, 'the source sweep found no files to read').toBeGreaterThan(20)
    // ...and it must have reached the resolver under the name the exemption uses, or
    // the exemption is dead and every other assertion here is measuring the wrong set.
    expect(sawResolver, `the sweep never saw ${RESOLVER} — path normalisation is wrong`).toBe(true)
    expect(offenders, 'these modules compose the AI halves themselves').toEqual([])

    // ...and the one module that is allowed to must really contain it, or the
    // assertion above is satisfied by the condition having vanished entirely.
    const gate = await readFile(join(srcRoot, 'ai/gate.ts'), 'utf8')
    expect(gate).toMatch(/&&\s*AI_ENDPOINT_CONFIGURED/)
  })
})
