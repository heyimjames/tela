/**
 * Adversarial tests for the hardening the delivery contract requires.
 *
 * These are deliberately written as attacks rather than as feature checks. A
 * test that asserts "the allowlist contains PATH" passes on a policy that also
 * lets `LD_PRELOAD` through; a test that asserts "`LD_PRELOAD` is not in the
 * child environment" does not. Each case below states the escape it is trying
 * and why that escape would matter if it worked.
 *
 * The two boundaries closed in this issue — the child environment allowlist and
 * the write-ahead journal — are covered here in full. The boundaries that
 * already existed keep their coverage in `security.test.ts` and
 * `src/tela/adversarial.test.ts`; the audit re-proof cases at the bottom of this
 * file assert the properties the *release* depends on, which is a different
 * question from whether each check works in isolation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CHILD_ENV_POLICY, childEnvironment } from '../../src/mcp/bridge/childEnv'
import { recoverPendingWrites, writeJournal } from '../../src/tela/journal'
import { writeFileAtomic } from '../../src/tela/nodeIo'
import { sha256Hex } from '../../src/tela/sha256'
import { call, connectInProcess, type Harness } from './harness'

describe('child environment allowlist', () => {
  /**
   * The headline case. A machine with a corporate proxy configured would, with
   * an inherited environment, route every request the browser makes through a
   * third party — in a runtime whose entire contract is that it makes none. And
   * proxy URLs routinely embed credentials, so the leak is not only of traffic.
   */
  it('strips proxy configuration in every spelling', () => {
    const child = childEnvironment({
      PATH: '/usr/bin',
      HTTP_PROXY: 'http://user:secret@proxy.internal:3128',
      http_proxy: 'http://user:secret@proxy.internal:3128',
      HTTPS_PROXY: 'http://proxy.internal:3128',
      ALL_PROXY: 'socks5://proxy.internal:1080',
      NO_PROXY: 'localhost',
    })
    expect(Object.keys(child).map((key) => key.toLowerCase())).not.toContain('http_proxy')
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy']) {
      expect(child[name]).toBeUndefined()
    }
    expect(JSON.stringify(child)).not.toContain('secret')
  })

  /**
   * Each of these loads chosen code into the browser process — the same process
   * that evaluates against the page holding the operator's designs. An inherited
   * `NODE_OPTIONS` with `--require` is the most ordinary version of this and the
   * easiest to set by accident.
   */
  it('strips preload, loader, and Node-option injection vectors', () => {
    const child = childEnvironment({
      PATH: '/usr/bin',
      NODE_OPTIONS: '--require /tmp/evil.js',
      LD_PRELOAD: '/tmp/evil.so',
      LD_LIBRARY_PATH: '/tmp/evil',
      LD_AUDIT: '/tmp/audit.so',
      DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
      DYLD_LIBRARY_PATH: '/tmp/evil',
      BASH_ENV: '/tmp/evil.sh',
      ELECTRON_RUN_AS_NODE: '1',
    })
    expect(Object.keys(child)).toEqual(expect.not.arrayContaining(['NODE_OPTIONS', 'LD_PRELOAD', 'LD_AUDIT', 'DYLD_INSERT_LIBRARIES', 'BASH_ENV']))
    expect(Object.keys(child).sort()).toEqual(['DO_NOT_TRACK', 'PATH', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', 'PLAYWRIGHT_SKIP_BROWSER_GC'])
  })

  it('strips credential-shaped variables whatever they are called', () => {
    const child = childEnvironment({
      PATH: '/usr/bin',
      AWS_SECRET_ACCESS_KEY: 'aws',
      GITHUB_TOKEN: 'gh',
      LINEAR_API_KEY: 'linear',
      SOME_VENDOR_PASSWORD: 'pw',
      MY_PRIVATE_KEY: 'pk',
      NPM_CONFIG_REGISTRY: 'https://registry.internal',
    })
    expect(Object.values(child)).not.toContain('aws')
    expect(Object.values(child)).not.toContain('gh')
    expect(Object.values(child)).not.toContain('linear')
    expect(Object.values(child)).not.toContain('pw')
    expect(Object.values(child)).not.toContain('pk')
  })

  /**
   * The allowlist has to fail *closed*. This is the property a blocklist cannot
   * have: an unfamiliar variable invented next year is absent by default rather
   * than present until somebody notices.
   */
  it('drops an unfamiliar variable rather than passing it through', () => {
    const child = childEnvironment({ PATH: '/usr/bin', SOME_FUTURE_THING: 'value', TELA_APPROVED_ROOT: '/somewhere/private' })
    expect(child.SOME_FUTURE_THING).toBeUndefined()
    // The server's own root is not the browser's business either.
    expect(child.TELA_APPROVED_ROOT).toBeUndefined()
  })

  it('keeps what a process genuinely needs to start on either platform', () => {
    const child = childEnvironment({
      PATH: '/usr/bin',
      HOME: '/home/op',
      TMPDIR: '/tmp',
      SYSTEMROOT: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      PLAYWRIGHT_BROWSERS_PATH: '/payload/browsers',
    })
    expect(child.PATH).toBe('/usr/bin')
    expect(child.HOME).toBe('/home/op')
    expect(child.SYSTEMROOT).toBe('C:\\Windows')
    expect(child.PLAYWRIGHT_BROWSERS_PATH).toBe('/payload/browsers')
  })

  /**
   * Telemetry off and downloads off are stated to the child rather than assumed
   * of it. The download flag is the load-bearing one: if Playwright decides a
   * browser is missing it will fetch one, and this runtime must never reach the
   * network — a missing browser is an operator-resolved setup failure.
   */
  it('forces telemetry and browser downloads off regardless of the parent', () => {
    const child = childEnvironment({ PATH: '/usr/bin', DO_NOT_TRACK: '0', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '0' })
    expect(child.DO_NOT_TRACK).toBe('1')
    expect(child.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBe('1')
  })

  it('refuses anything the stated deny policy names, independently of the allowlist', () => {
    for (const name of CHILD_ENV_POLICY.deniedExact) expect(CHILD_ENV_POLICY.isDenied(name)).toBe(true)
    expect(CHILD_ENV_POLICY.isDenied('anything_token')).toBe(true)
    expect(CHILD_ENV_POLICY.isDenied('PATH')).toBe(false)
  })
})

describe('write-ahead journal', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tela-journal-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const journalFiles = async () => (await readdir(directory)).filter((name) => name.endsWith('.journal'))
  const temporaryFiles = async () => (await readdir(directory)).filter((name) => name.endsWith('.tmp'))

  it('leaves no journal behind after a successful write', async () => {
    await writeFileAtomic(join(directory, 'design.tela'), new TextEncoder().encode('committed'))
    expect(await journalFiles()).toEqual([])
    expect(await temporaryFiles()).toEqual([])
    expect(await readFile(join(directory, 'design.tela'), 'utf8')).toBe('committed')
  })

  /**
   * A failure the process survives cleans up after itself, so it must not leave
   * a record either — a journal for a write that definitively did not happen
   * would be reported as an interrupted write on every subsequent open, forever.
   */
  it('clears the journal when a write fails and is cleaned up', async () => {
    await expect(
      writeFileAtomic(join(directory, 'design.tela'), new TextEncoder().encode('doomed'), {
        hooks: {
          beforeRename: () => {
            throw new Error('simulated failure')
          },
        },
      }),
    ).rejects.toThrow('simulated failure')
    expect(await journalFiles()).toEqual([])
    expect(await temporaryFiles()).toEqual([])
  })

  /**
   * The case the journal exists for: a `kill -9` between the temp write and the
   * rename, where no `catch` block runs. Simulated by writing a journal and a
   * matching temp file and then never committing — which is exactly the on-disk
   * state such a kill leaves.
   */
  it('recovers a complete-but-uncommitted write, quarantines it, and never applies it', async () => {
    const target = join(directory, 'design.tela')
    await writeFile(target, 'previous master')
    const pending = new TextEncoder().encode('pending bytes that never committed')
    const temporaryPath = join(directory, '.design.tela.deadbeef.tmp')
    await writeFile(temporaryPath, pending)
    await writeJournal(target, 'deadbeef', {
      target: 'design.tela',
      temp: '.design.tela.deadbeef.tmp',
      bytes: pending.length,
      sha256: sha256Hex(pending),
      startedAt: '2026-08-14T00:00:00.000Z',
    })

    const quarantined: string[] = []
    const found = await recoverPendingWrites(directory, {
      quarantine: async (path, suggested) => {
        quarantined.push(suggested)
        await rm(path)
        return `.trash/${suggested}`
      },
    })

    expect(found).toHaveLength(1)
    expect(found[0].outcome).toBe('pending_complete')
    expect(found[0].quarantinedAs).toMatch(/^\.trash\//)
    expect(quarantined).toHaveLength(1)
    // The master is untouched. Recovery reports; it does not replay, because
    // replaying resurrects stale content over whatever happened since.
    expect(await readFile(target, 'utf8')).toBe('previous master')
    expect(await journalFiles()).toEqual([])
  })

  it('distinguishes a truncated write from a complete one', async () => {
    const target = join(directory, 'design.tela')
    const intended = new TextEncoder().encode('the full intended contents')
    await writeFile(join(directory, '.design.tela.abc123.tmp'), 'the full inten')
    await writeJournal(target, 'abc123', {
      target: 'design.tela',
      temp: '.design.tela.abc123.tmp',
      bytes: intended.length,
      sha256: sha256Hex(intended),
      startedAt: '2026-08-14T00:00:00.000Z',
    })

    const found = await recoverPendingWrites(directory, { quarantine: async (path) => (await rm(path), '.trash/partial') })
    expect(found[0].outcome).toBe('pending_partial')
  })

  /**
   * The rename committed but the process died before the record was cleared.
   * Nothing is pending, so this must not be reported as an interrupted write —
   * a recovery system that cries wolf gets ignored.
   */
  it('treats a record with no temp file as settled', async () => {
    const target = join(directory, 'design.tela')
    await writeFile(target, 'committed')
    await writeJournal(target, 'cafe01', {
      target: 'design.tela',
      temp: '.design.tela.cafe01.tmp',
      bytes: 9,
      sha256: sha256Hex(new TextEncoder().encode('committed')),
      startedAt: '2026-08-14T00:00:00.000Z',
    })
    const found = await recoverPendingWrites(directory)
    expect(found).toHaveLength(1)
    expect(found[0].outcome).toBe('settled')
    expect(await journalFiles()).toEqual([])
  })

  it('discards an unreadable record rather than reporting it forever', async () => {
    await writeFile(join(directory, '.design.tela.bad.journal'), 'not json at all')
    expect(await recoverPendingWrites(directory)).toEqual([])
    expect(await journalFiles()).toEqual([])
  })

  it('does not report a directory with nothing pending', async () => {
    await writeFile(join(directory, 'design.tela'), 'fine')
    expect(await recoverPendingWrites(directory)).toEqual([])
  })
})

describe('interrupted writes surface through the server', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await connectInProcess()
  })

  afterEach(async () => {
    await harness.close()
  })

  it('reports an interrupted write on open and moves the bytes to the managed trash', async () => {
    await call(harness.client, 'tela_create_design', { design: 'campaign.tela', name: 'Campaign' })
    await call(harness.client, 'tela_close_design', { design: 'campaign.tela' })

    // Stage the exact on-disk state a killed process leaves behind.
    const pending = new TextEncoder().encode('bytes from a save that never committed')
    await writeFile(join(harness.root, '.campaign.tela.feed01.tmp'), pending)
    await writeJournal(join(harness.root, 'campaign.tela'), 'feed01', {
      target: 'campaign.tela',
      temp: '.campaign.tela.feed01.tmp',
      bytes: pending.length,
      sha256: sha256Hex(pending),
      startedAt: '2026-08-14T00:00:00.000Z',
    })

    await call(harness.client, 'tela_open_design', { design: 'campaign.tela' })

    const status = await call<{ interrupted_writes: number }>(harness.client, 'tela_get_status')
    expect(status.structured.interrupted_writes).toBe(1)

    // Quarantined, not deleted: nothing this server touches is ever destroyed.
    const trashed = (await readdir(join(harness.root, '.trash'))).filter((name) => name.includes('interrupted'))
    expect(trashed).toHaveLength(1)
    expect(await readFile(join(harness.root, '.trash', trashed[0]), 'utf8')).toBe('bytes from a save that never committed')

    // And the design itself opened normally from its committed bytes.
    const summary = await call<{ name: string }>(harness.client, 'tela_get_design_summary', { design: 'campaign.tela' })
    expect(summary.structured.name).toBe('Campaign')
  })
})

describe('no installation or download on an import or status path', () => {
  /**
   * The contract is explicit: no app, dependency, or browser download occurs
   * during import or doctor. The realistic failure is not malice but a
   * module-level side effect — an `await chromium.launch()` or an install check
   * at import time — which would make merely *listing tools* download a browser
   * on a metered connection.
   *
   * Checked structurally rather than by watching the network: the module graph
   * must contain no install-shaped call at all, which is a stronger statement
   * than "it did not download anything this time".
   */
  it('has no process-spawning or installer capability at all in the compiled server', async () => {
    const compiled = await readFile(join(import.meta.dirname, '../../dist/mcp/tela-mcp.mjs'), 'utf8').catch(() => null)
    expect(compiled, 'run `npm run build` before this suite').not.toBeNull()
    const source = compiled as string

    // No shell, no subprocess, no installer — the capability is absent rather
    // than merely unused, so no future code path can reach it by accident.
    expect(source).not.toMatch(/child_process/)
    expect(source).not.toMatch(/\bexecSync\b|\bexecFileSync\b|\bspawnSync\b/)
    expect(source).not.toMatch(/downloadBrowser|installBrowser/i)

    // "playwright install" does appear — but only inside the recovery guidance
    // the operator reads when the browser is missing. Every occurrence must be
    // in that sentence, which is what makes it advice rather than an action.
    for (const match of source.matchAll(/playwright install/gi)) {
      const window = source.slice(match.index, match.index + 200)
      expect(window).toMatch(/during setup, never at runtime/)
    }
  })

  it('answers status without starting the bridge', async () => {
    const harness = await connectInProcess()
    try {
      const status = await call<{ bridge_running: boolean; ready: boolean }>(harness.client, 'tela_get_status')
      expect(status.structured.bridge_running).toBe(false)
      expect(status.structured.ready).toBe(true)

      // The whole read surface, still with no browser.
      await call(harness.client, 'tela_get_capabilities')
      await call(harness.client, 'tela_list_designs')
      await call(harness.client, 'tela_list_templates')
      const after = await call<{ bridge_running: boolean }>(harness.client, 'tela_get_status')
      expect(after.structured.bridge_running).toBe(false)
    } finally {
      await harness.close()
    }
  })

  it('leaves no browser cache or payload directory behind in the approved root', async () => {
    const harness = await connectInProcess()
    try {
      await call(harness.client, 'tela_get_status')
      await call(harness.client, 'tela_list_designs')
      const entries = await readdir(harness.root)
      expect(entries).toEqual([])
      await expect(stat(join(harness.root, 'ms-playwright'))).rejects.toThrow()
    } finally {
      await harness.close()
    }
  })
})
