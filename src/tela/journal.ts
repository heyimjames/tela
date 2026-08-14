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

export async function writeJournal(targetPath: string, id: string, entry: Omit<JournalEntry, 'v'>): Promise<string> {
  const path = join(dirname(targetPath), journalName(basename(targetPath), id))
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

    const temporaryPath = join(directory, basename(entry.temp))
    let bytes: Buffer | undefined
    try {
      bytes = await readFile(temporaryPath)
    } catch {
      bytes = undefined
    }

    if (bytes === undefined) {
      found.push({ target: entry.target, outcome: 'settled', bytes: entry.bytes, startedAt: entry.startedAt })
      await clearJournal(journalPath)
      continue
    }

    const complete = bytes.length === entry.bytes && sha256Hex(new Uint8Array(bytes)) === entry.sha256
    const record: PendingWrite = {
      target: entry.target,
      outcome: complete ? 'pending_complete' : 'pending_partial',
      bytes: bytes.length,
      startedAt: entry.startedAt,
    }

    if (options.quarantine) {
      try {
        record.quarantinedAs = await options.quarantine(temporaryPath, `${entry.target}.interrupted-${entry.startedAt.replace(/[:.]/g, '-')}`)
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
