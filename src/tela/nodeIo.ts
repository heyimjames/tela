/**
 * Durable, atomic `.tela` writes on Node.
 *
 * Node-only by design, and never imported from the React app — the browser editor
 * hands bytes to a download or a File System Access handle instead. Keeping this in
 * its own module means `node:fs` never reaches the Vite bundle.
 *
 * The save sequence is the standard crash-safe one, and every step is load-bearing:
 *
 *   1. write to a temporary file **in the same directory** — a temp file on another
 *      filesystem cannot be renamed atomically onto the target;
 *   2. `fsync` the temp file — a rename is atomic with respect to *ordering*, not
 *      to durability; without this the rename can land before the data does and a
 *      power loss leaves a valid directory entry pointing at a zero-length file;
 *   3. `rename` over the target — atomic replacement, so a reader sees either the
 *      whole old file or the whole new one, never a half-written one;
 *   4. `fsync` the directory — makes the rename itself durable.
 *
 * If anything fails, the temp file is removed and the previous master is left
 * byte-identical. A failed save can never destroy the last good version.
 *
 * Wrapped around all of it is the write-ahead journal (`journal.ts`): a record
 * written and fsynced *before* step 1 and cleared after step 3, so that a
 * process killed outright — where none of the cleanup above runs — leaves an
 * explicable, recoverable trace rather than an anonymous temp file.
 */

import { open, rename, unlink, readFile, mkdir } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { randomBytes } from 'node:crypto'

import { telaError } from './errors'
import { clearJournal, writeJournal } from './journal'
import { sha256Hex } from './sha256'
import { readBundle, readBundleForEditing, writeBundle, type ReadBundleResult } from './bundle'
import type { TelaDocument, TelaManifest } from './schema'

/** Seam for fault-injection tests: lets a test fail a specific step. */
export interface AtomicWriteHooks {
  afterWrite?: (temporaryPath: string) => void | Promise<void>
  afterSync?: (temporaryPath: string) => void | Promise<void>
  beforeRename?: (temporaryPath: string) => void | Promise<void>
}

export interface AtomicWriteOptions {
  hooks?: AtomicWriteHooks
  /** Create the containing directory if it is missing. Off by default. */
  createDirectory?: boolean
  /**
   * Write a journal entry before the data and clear it after the rename, so a
   * process killed mid-write leaves an explicable record instead of an
   * anonymous temp file. On by default; see `journal.ts` for why.
   */
  journal?: boolean
}

export async function writeFileAtomic(
  targetPath: string,
  data: Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const directory = dirname(targetPath)
  if (options.createDirectory) await mkdir(directory, { recursive: true })

  // A random suffix rather than a pid or a timestamp: two processes saving the
  // same design at once must not collide on the temp name, and `wx` below turns
  // any collision into an error rather than a silent overwrite.
  const id = randomBytes(8).toString('hex')
  const temporaryPath = join(directory, `.${basename(targetPath)}.${id}.tmp`)

  // Journal first, and fsynced, so the record can never reach disk *after* the
  // temp file it describes. The digest is of the bytes we are about to write,
  // which is what lets recovery tell a complete pending write from a truncated
  // one without trusting the file size alone.
  let journalPath: string | undefined
  if (options.journal !== false) {
    journalPath = await writeJournal(targetPath, id, {
      target: basename(targetPath),
      temp: basename(temporaryPath),
      bytes: data.length,
      sha256: sha256Hex(data),
      startedAt: new Date().toISOString(),
    })
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporaryPath, 'wx', 0o644)
    // A short write is legal for `write(2)` and does happen near quota limits and on
    // some network filesystems. Unchecked, the truncated temp file would be fsynced
    // and renamed over the previous master, destroying the last good version.
    let written = 0
    while (written < data.length) {
      const { bytesWritten } = await handle.write(data, written, data.length - written, written)
      if (bytesWritten <= 0) {
        throw new Error(`short write: ${written} of ${data.length} bytes reached the temporary file`)
      }
      written += bytesWritten
    }
    await options.hooks?.afterWrite?.(temporaryPath)
    await handle.sync()
    await options.hooks?.afterSync?.(temporaryPath)
    await handle.close()
    handle = undefined

    await options.hooks?.beforeRename?.(temporaryPath)
    await rename(temporaryPath, targetPath)
  } catch (cause) {
    if (handle) {
      await handle.close().catch(() => {})
    }
    await unlink(temporaryPath).catch(() => {})
    // The temp file is gone, so there is nothing left to recover and the record
    // would only be noise on the next open. A crash that skips this line is
    // precisely the case the journal is kept for.
    if (journalPath) await clearJournal(journalPath)
    throw cause
  }

  // Committed. The record has done its job.
  if (journalPath) await clearJournal(journalPath)

  // Durability of the rename itself. Best-effort: some platforms and filesystems
  // refuse to open a directory for sync, and failing the whole save over that
  // would be worse than the weaker guarantee.
  let directoryHandle: Awaited<ReturnType<typeof open>> | undefined
  try {
    directoryHandle = await open(directory, 'r')
    await directoryHandle.sync()
  } catch {
    // ignore
  } finally {
    await directoryHandle?.close().catch(() => {})
  }
}

/** Serialize an editing state and durably replace the file at `path`. */
export async function saveTelaFile(
  path: string,
  source: unknown,
  options: AtomicWriteOptions = {},
): Promise<Uint8Array> {
  // Serialize first, on purpose. If the document is invalid, this throws before
  // any file is touched — the existing master is not even opened.
  const bytes = writeBundle(source)
  try {
    await writeFileAtomic(path, bytes, options)
  } catch (cause) {
    throw telaError('io_failed', `could not save ${basename(path)}`, cause instanceof Error ? cause.message : String(cause))
  }
  return bytes
}

export async function readTelaFile(path: string): Promise<ReadBundleResult> {
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (cause) {
    throw telaError('io_failed', `could not read ${basename(path)}`, cause instanceof Error ? cause.message : String(cause))
  }
  return readBundle(new Uint8Array(bytes))
}

/** Read a file and resolve its assets to inline `data:` URLs for an editing session. */
export async function openTelaFile(path: string): Promise<{
  document: TelaDocument
  manifest: TelaManifest
  migrationsApplied: string[]
}> {
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (cause) {
    throw telaError('io_failed', `could not read ${basename(path)}`, cause instanceof Error ? cause.message : String(cause))
  }
  return readBundleForEditing(new Uint8Array(bytes))
}
