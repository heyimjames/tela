/**
 * The write-ahead journal.
 *
 * `writeFileAtomic` already guarantees that a *failed* save leaves the previous
 * master byte-identical: it writes a temp file beside the target and renames it
 * over, and its `catch` removes the temp. That covers every failure the process
 * lives through.
 *
 * It does not cover the process not living through it. `kill -9`, an OOM kill,
 * or a power loss between "temp written" and "renamed" runs no `catch` block, so
 * the temp file survives with no record of what it was, what it was for, or
 * whether it is complete. From the outside it is indistinguishable from garbage,
 * which means the only safe thing to do with it is nothing — and a directory
 * slowly filling with unexplained `.tmp` files is exactly the state an operator
 * cannot reason about.
 *
 * The journal is that missing record. Before the temp file is opened, a small
 * JSON entry is written and fsynced naming the target, the temp file, the byte
 * count, and the digest of the bytes that are about to be written. After the
 * rename succeeds the entry is removed. So a journal entry on disk means exactly
 * one thing: **a write to this target was interrupted before it committed.**
 *
 * Recovery deliberately does not finish the write. A verified-complete temp file
 * is a write somebody intended at some point in the past; replaying it on the
 * next open would resurrect stale content over whatever has happened since, and
 * it would do so silently. Instead recovery *reports*, and hands the pending
 * bytes to a quarantine callback (the MCP layer routes that to the managed
 * trash) so nothing is lost and nothing is applied behind the operator's back.
 */

import { open, readdir, readFile, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { sha256Hex } from './sha256'

export const JOURNAL_VERSION = 1

export interface JournalEntry {
  v: number
  /** Basename only. A journal never records an absolute path. */
  target: string
  /** Basename of the temp file holding the pending bytes. */
  temp: string
  bytes: number
  sha256: string
  startedAt: string
}

/** `.<target>.<id>.journal`, beside the target, matching the temp file's naming. */
function journalName(targetBasename: string, id: string): string {
  return `.${targetBasename}.${id}.journal`
}

const JOURNAL_SUFFIX = '.journal'

/** The target a journal file name claims, or undefined if the name is not one of ours. */
function targetFromJournalName(name: string): string | undefined {
  const inner = name.slice(1, -JOURNAL_SUFFIX.length)
  const cut = inner.lastIndexOf('.')
  return cut <= 0 ? undefined : inner.slice(0, cut)
}

/**
 * Fsync a directory, best-effort.
 *
 * A file's own `fsync` makes its *contents* durable; it says nothing about the
 * directory entry that names it. Both the journal's creation and the target's
 * rename are directory-entry operations, so both need this to be ordered on
 * disk the way the code orders them in memory.
 *
 * Best-effort on purpose: some platforms and filesystems refuse to open a
 * directory for sync, and failing a save over that would be worse than the
 * weaker guarantee.
 */
export async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch {
    // ignore
  } finally {
    await handle?.close().catch(() => {})
  }
}

export async function writeJournal(targetPath: string, id: string, entry: Omit<JournalEntry, 'v'>): Promise<string> {
  const directory = dirname(targetPath)
  const path = join(directory, journalName(basename(targetPath), id))
  const payload = new TextEncoder().encode(JSON.stringify({ v: JOURNAL_VERSION, ...entry }))
  // `wx`: a colliding id means something is very wrong, and silently overwriting
  // another write's journal would destroy the record we are here to keep.
  const handle = await open(path, 'wx', 0o644)
  try {
    await handle.write(payload, 0, payload.length, 0)
    // Fsynced before the data write starts. A journal that reaches disk after the
    // temp file it describes is a journal that can be missing for exactly the
    // crash it exists to explain.
    await handle.sync()
  } finally {
    await handle.close().catch(() => {})
  }
  // The file's own fsync above makes its bytes durable but not the directory
  // entry naming it. Without this, a power loss can leave the temp file's entry
  // on disk and the record's entry lost — an anonymous temp file again.
  await syncDirectory(directory)
  return path
}

export async function clearJournal(journalPath: string): Promise<void> {
  await unlink(journalPath).catch(() => {})
}

export type PendingOutcome =
  /** Temp file gone: the rename either committed or was cleaned up. Only the record was left behind. */
  | 'settled'
  /** Temp present and its digest matches the journal: complete bytes that never committed. */
  | 'pending_complete'
  /** Temp present but truncated or corrupt: the crash landed mid-write. */
  | 'pending_partial'

export interface PendingWrite {
  target: string
  outcome: PendingOutcome
  bytes: number
  startedAt: string
  /** Where the pending bytes were moved, when a quarantine handler was supplied. */
  quarantinedAs?: string
}

export interface RecoverOptions {
  /**
   * Only consider records naming this target (a basename).
   *
   * Recovery quarantines the pending bytes of every record it inspects, and the
   * process-wide lock that serializes writes is keyed per *design*, not per
   * directory. Sweeping a whole directory would therefore let an open of `a.tela`
   * steal the in-flight temp file of a concurrent, perfectly healthy save of
   * `b.tela` sitting beside it — the save's `rename` then fails ENOENT and a
   * write that was never interrupted is reported as one. Callers sweeping on the
   * open path must scope the sweep to the design they hold the lock for.
   */
  target?: string
  /**
   * Move a recovered temp file somewhere durable and return a caller-facing
   * label for it. Without one, recovery reports and leaves every byte in place —
   * this module never deletes data it cannot describe.
   */
  quarantine?: (temporaryPath: string, suggestedName: string) => Promise<string>
}

/**
 * Inspect a directory for interrupted writes, clearing the records it resolves.
 *
 * Failures on individual entries are swallowed on purpose: recovery runs on the
 * open path, and a permission error on one stray file must not make a design
 * unopenable.
 */
export async function recoverPendingWrites(directory: string, options: RecoverOptions = {}): Promise<PendingWrite[]> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return []
  }

  const found: PendingWrite[] = []
  for (const name of names) {
    if (!name.startsWith('.') || !name.endsWith(JOURNAL_SUFFIX)) continue
    // Attribute by file name before opening anything: a scoped sweep must not
    // even clear the unreadable record of a design it does not hold the lock for.
    if (options.target !== undefined && targetFromJournalName(name) !== options.target) continue
    const journalPath = join(directory, name)

    let entry: JournalEntry
    try {
      entry = JSON.parse(await readFile(journalPath, 'utf8')) as JournalEntry
    } catch {
      // An unreadable or truncated journal is itself evidence of a crash, but it
      // names nothing actionable. Drop the record rather than leave a file that
      // will be re-reported forever.
      await clearJournal(journalPath)
      continue
    }
    if (entry.v !== JOURNAL_VERSION || typeof entry.temp !== 'string' || typeof entry.target !== 'string') {
      await clearJournal(journalPath)
      continue
    }

    // The record is data read off disk, so every path in it is untrusted: a
    // `target` of `../../../.ssh/authorized_keys` would otherwise be handed to
    // the quarantine callback and used to build a destination outside the
    // managed trash. A journal names basenames beside itself, nothing else.
    const target = basename(entry.target)
    if (target === '' || target === '.' || target === '..') {
      await clearJournal(journalPath)
      continue
    }
    if (options.target !== undefined && target !== options.target) continue

    const temporaryPath = join(directory, basename(entry.temp))
    let bytes: Buffer | undefined
    try {
      bytes = await readFile(temporaryPath)
    } catch {
      bytes = undefined
    }

    if (bytes === undefined) {
      found.push({ target, outcome: 'settled', bytes: entry.bytes, startedAt: entry.startedAt })
      await clearJournal(journalPath)
      continue
    }

    const complete = bytes.length === entry.bytes && sha256Hex(new Uint8Array(bytes)) === entry.sha256
    const record: PendingWrite = {
      target,
      outcome: complete ? 'pending_complete' : 'pending_partial',
      bytes: bytes.length,
      startedAt: entry.startedAt,
    }

    if (options.quarantine) {
      try {
        record.quarantinedAs = await options.quarantine(temporaryPath, `${target}.interrupted-${String(entry.startedAt).replace(/[:.]/g, '-')}`)
      } catch {
        // Quarantine failed: leave the temp file and the journal alone so the
        // next open reports it again rather than losing the only copy.
        found.push(record)
        continue
      }
      await clearJournal(journalPath)
    }

    found.push(record)
  }

  found.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
  return found
}
