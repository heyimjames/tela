/**
 * Open designs, their revisions, and the lock that serializes writes.
 *
 * The concurrency model, and why it is the shape it is:
 *
 *  - **One session per source path.** Two MCP clients (a Codex session and a
 *    Claude session) may both be editing; they share the process, so they share
 *    the session. That is deliberate — two independent in-memory copies of one
 *    file is the lost-update bug, not a feature.
 *  - **A per-source lock.** Every operation on a design — session mutations,
 *    reads, saves, *and* the file-level lifecycle (create, import, duplicate,
 *    archive, close) — runs inside a promise chain keyed by the root-relative
 *    path, so work against one design is strictly serialized even though the
 *    server handles requests concurrently. The lock is keyed on the path rather
 *    than on the session, because an archive that renames the file out from
 *    under an in-flight save races just as badly as two saves do.
 *  - **Expected session revision on every mutation.** A monotonic counter that
 *    increments on each accepted change. A caller that read the design, then
 *    acted on what it read, passes the revision it saw; if anything landed in
 *    between, the mutation is refused instead of silently clobbering.
 *  - **Expected disk revision on save, additionally.** The session revision only
 *    knows about changes made through *this* process. The disk revision (the
 *    bundle's semantic `contentRevision`) catches the other case: the file
 *    changed underneath us. Save re-reads the file and compares before writing.
 *
 * Both gates are code-enforced. Neither is an annotation.
 */

import { copyFile, mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

import { readBundleForEditing, writeBundle } from '../tela/bundle'
import { computeContentRevision } from '../tela/contentRevision'
import { saveTelaFile } from '../tela/nodeIo'
import { makeAssetBlob, base64Encode } from '../tela/assets'
import { telaDocumentSchema, type TelaDocument } from '../tela/schema'
import { toolError } from './errors'
import { approvedRoot, resolveInRoot, toPosix, trashDirectory, type ResolvedPath } from './paths'
import { nowIso } from './documentOps'

export const TELA_EXTENSION = '.tela'

export interface Session {
  /** Root-relative POSIX path. This is the design handle callers use. */
  design: string
  absolutePath: string
  document: TelaDocument
  /** Increments on every accepted mutation. Starts at 0 on open. */
  sessionRevision: number
  /** Semantic content revision of the last persisted state. */
  diskRevision: string
  dirty: boolean
  openedAt: string
  migrationsApplied: string[]
}

type SessionEntry = Session

const sessions = new Map<string, SessionEntry>()

/**
 * Tail of the per-path serialization chain, keyed by root-relative path.
 *
 * Deliberately *not* stored on the session: a path with no open session still
 * has to serialize (create, import, duplicate, archive), and a session that is
 * closed and reopened mid-queue must not hand out a fresh, empty chain.
 */
const locks = new Map<string, Promise<unknown>>()

/** Test seam: drop all in-memory sessions without touching disk. */
export function resetSessions(): void {
  sessions.clear()
  locks.clear()
}

export function listOpenSessions(): Session[] {
  return [...sessions.values()].map(toPublic)
}

function toPublic(entry: SessionEntry): Session {
  return { ...entry }
}

export function getSession(design: string): Session | undefined {
  const entry = sessions.get(design)
  return entry ? toPublic(entry) : undefined
}

function requireEntry(design: string): SessionEntry {
  const entry = sessions.get(design)
  if (!entry) {
    throw toolError(
      'not_open',
      `no open session for "${design}"`,
      `call tela_open_design with design "${design}" first; tela_list_designs shows every design under the approved root`,
    )
  }
  return entry
}

export function requireSession(design: string): Session {
  return toPublic(requireEntry(design))
}

/**
 * Run `work` under the path's lock.
 *
 * The chain is advanced before awaiting so a second caller queues behind this
 * one rather than racing it, and the `catch` on the stored tail keeps one
 * failed operation from poisoning every later one.
 *
 * `work` must re-look-up the session itself (via `requireEntry`) rather than
 * closing over one captured before the await: by the time the queue reaches it,
 * a concurrent close or archive may have removed the session, and a stale entry
 * would either crash or apply a transform to a document nobody asked for.
 */
async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const tail = locks.get(key) ?? Promise.resolve()
  const result = tail.then(work, work)
  locks.set(key, result.catch(() => undefined))
  return result
}

/** Acquire several path locks in a fixed (sorted) order, so two callers taking
    the same pair cannot deadlock by taking them in opposite orders. */
async function withLocks<T>(keys: string[], work: () => Promise<T>): Promise<T> {
  const ordered = [...new Set(keys)].sort()
  const acquire = (index: number): Promise<T> =>
    index >= ordered.length ? work() : withLock(ordered[index], () => acquire(index + 1))
  return acquire(0)
}

function assertSessionRevision(entry: SessionEntry, expected: number): void {
  if (entry.sessionRevision !== expected) {
    throw toolError(
      'revision_mismatch',
      `expected_session_revision ${expected} does not match the design's current session revision ${entry.sessionRevision}`,
      `another change landed since you last read this design; call tela_get_design_summary for design "${entry.design}" to get the current session_revision, re-check your assumptions, and retry`,
    )
  }
}

// --- Open / close ------------------------------------------------------------

export interface OpenResult {
  session: Session
  reused: boolean
}

export async function openDesign(designPath: string): Promise<OpenResult> {
  const resolved = await resolveInRoot(designPath, 'design')
  assertTelaExtension(resolved.relative)
  return withLock(resolved.relative, async () => {
    const existing = sessions.get(resolved.relative)
    if (existing) return { session: toPublic(existing), reused: true }

    const { document, migrationsApplied } = await readBundleFile(resolved)
    const entry: SessionEntry = {
      design: resolved.relative,
      absolutePath: resolved.absolute,
      document,
      sessionRevision: 0,
      diskRevision: computeContentRevision(document),
      dirty: false,
      openedAt: nowIso(),
      migrationsApplied,
    }
    sessions.set(resolved.relative, entry)
    return { session: toPublic(entry), reused: false }
  })
}

async function readBundleFile(resolved: ResolvedPath): Promise<{ document: TelaDocument; migrationsApplied: string[] }> {
  let bytes: Buffer
  try {
    bytes = await readFile(resolved.absolute)
  } catch {
    throw toolError(
      'not_found',
      `no design at "${resolved.relative}"`,
      'call tela_list_designs to see what exists under the approved root, or tela_create_design to make a new one',
    )
  }
  const result = readBundleForEditing(new Uint8Array(bytes))
  return { document: result.document, migrationsApplied: result.migrationsApplied }
}

/**
 * Close under the lock, like every other operation on this path.
 *
 * Dropping the session outside the lock would let a close land between a queued
 * mutation's `await` and its session lookup — and worse, a close-then-reopen
 * would hand the queued transform a fresh session whose revision counter is back
 * at 0, so the revision gate would pass and a stale edit would be applied to a
 * freshly loaded document.
 */
export async function closeDesign(design: string, discardChanges: boolean): Promise<{ closed: boolean; discardedChanges: boolean }> {
  return withLock(design, async () => {
    const entry = sessions.get(design)
    if (!entry) return { closed: false, discardedChanges: false }
    if (entry.dirty && !discardChanges) {
      throw toolError(
        'conflict',
        `design "${design}" has unsaved changes`,
        'call tela_save_design first, or pass discard_changes: true to close and lose them',
      )
    }
    sessions.delete(design)
    return { closed: true, discardedChanges: entry.dirty }
  })
}

// --- Mutation ----------------------------------------------------------------

export interface MutationResult<T> {
  session: Session
  value: T
}

/**
 * Apply a pure document transform under the lock and the revision gate.
 *
 * `mutate` receives the current document and returns the next one. It is called
 * *inside* the lock and after the revision check, and its failure leaves the
 * session untouched — the new document is only installed once the transform has
 * returned successfully.
 */
export async function mutateSession<T>(
  design: string,
  expectedSessionRevision: number,
  mutate: (document: TelaDocument) => { document: TelaDocument; value: T } | Promise<{ document: TelaDocument; value: T }>,
): Promise<MutationResult<T>> {
  return withLock(design, async () => {
    // Looked up *after* the await, not before: the session may have been closed
    // or archived while this call sat in the queue, and `not_open` is the
    // contracted answer for that — not a TypeError surfaced as `internal`.
    const entry = requireEntry(design)
    assertSessionRevision(entry, expectedSessionRevision)
    const next = await mutate(entry.document)
    entry.document = next.document
    entry.sessionRevision += 1
    entry.dirty = true
    return { session: toPublic(entry), value: next.value }
  })
}

/** Read under the lock, so a read never observes a half-applied mutation. */
export async function readSession<T>(design: string, read: (document: TelaDocument) => T): Promise<T> {
  return withLock(design, async () => read(requireEntry(design).document))
}

// --- Save --------------------------------------------------------------------

export interface SaveResult {
  session: Session
  bytes: number
  diskRevision: string
  documentSha256: string
  unchanged: boolean
}

export async function saveDesign(
  design: string,
  expectedSessionRevision: number,
  expectedDiskRevision: string,
): Promise<SaveResult> {
  return withLock(design, async () => {
    const entry = requireEntry(design)
    assertSessionRevision(entry, expectedSessionRevision)

    // The disk gate. Re-read what is actually on disk rather than trusting the
    // revision we recorded at open: the whole point is to catch a writer we did
    // not go through.
    const onDisk = await currentDiskRevision(entry.absolutePath)
    if (onDisk !== null && onDisk !== expectedDiskRevision) {
      throw toolError(
        'revision_mismatch',
        `expected_disk_revision does not match the file on disk`,
        `the .tela file changed outside this session. Close the design with tela_close_design (discard_changes: true only if you accept losing your edits), reopen it, and reapply your changes.`,
      )
    }
    if (onDisk !== null && entry.diskRevision !== onDisk) {
      throw toolError(
        'conflict',
        'the design on disk no longer matches the state this session was opened from',
        'reopen the design with tela_open_design to pick up the on-disk state before saving',
      )
    }

    const bytes = await saveTelaFile(entry.absolutePath, entry.document, { createDirectory: true })
    const revision = computeContentRevision(entry.document)
    const unchanged = revision === entry.diskRevision
    entry.diskRevision = revision
    entry.dirty = false
    return {
      session: toPublic(entry),
      bytes: bytes.length,
      diskRevision: revision,
      documentSha256: await documentDigest(entry.document),
      unchanged,
    }
  })
}

async function documentDigest(document: TelaDocument): Promise<string> {
  const { canonicalBytes } = await import('../tela/canonicalJson')
  const { sha256Hex } = await import('../tela/sha256')
  return sha256Hex(canonicalBytes(document as never))
}

/** `null` when the file does not exist yet — a first save has nothing to conflict with. */
export async function currentDiskRevision(absolutePath: string): Promise<string | null> {
  let bytes: Buffer
  try {
    bytes = await readFile(absolutePath)
  } catch {
    return null
  }
  const result = readBundleForEditing(new Uint8Array(bytes))
  return computeContentRevision(result.document)
}

// --- Library operations ------------------------------------------------------

export interface DesignEntry {
  design: string
  name: string
  bytes: number
  modified: string
  open: boolean
}

/** Walk the approved root for `.tela` files. Bounded depth; the trash is skipped. */
export async function listDesigns(): Promise<DesignEntry[]> {
  const root = approvedRoot()
  const found: DesignEntry[] = []
  const seen = new Set<string>()

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 8) return
    let items
    try {
      items = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (item.name.startsWith('.')) continue
      const full = join(directory, item.name)
      // `withFileTypes` reports a symlink as a symlink, so this skips links
      // without following them — consistent with the path policy.
      if (item.isDirectory()) {
        await walk(full, depth + 1)
      } else if (item.isFile() && extname(item.name).toLowerCase() === TELA_EXTENSION) {
        const relative = toPosix(full.slice(root.length + 1))
        if (seen.has(relative)) continue
        seen.add(relative)
        let info
        try {
          info = await stat(full)
        } catch {
          continue
        }
        found.push({
          design: relative,
          name: basename(item.name, TELA_EXTENSION),
          bytes: info.size,
          modified: new Date(info.mtimeMs).toISOString(),
          open: sessions.has(relative),
        })
      }
    }
  }

  await walk(root, 0)
  found.sort((a, b) => (a.design < b.design ? -1 : a.design > b.design ? 1 : 0))
  return found
}

function assertTelaExtension(relative: string): void {
  if (extname(relative).toLowerCase() !== TELA_EXTENSION) {
    throw toolError('invalid_input', `"${relative}" is not a .tela path`, 'design paths must end in .tela')
  }
}

/** Refuse to write over an existing file rather than silently replacing someone's work. */
async function assertAbsent(resolved: ResolvedPath, field: string): Promise<void> {
  try {
    await stat(resolved.absolute)
  } catch {
    return
  }
  throw toolError(
    'conflict',
    `${field} "${resolved.relative}" already exists`,
    `choose a different path, or archive the existing design with tela_archive_design first`,
  )
}

export async function createDesignFile(designPath: string, document: TelaDocument): Promise<{ design: string; bytes: number; diskRevision: string }> {
  const resolved = await resolveInRoot(designPath, 'design', { forWrite: true, createParents: true })
  assertTelaExtension(resolved.relative)
  // Under the path lock: the exists-check and the write have to be one step, or
  // two concurrent creates both see "absent" and the second silently wins.
  return withLock(resolved.relative, async () => {
    await assertAbsent(resolved, 'design')
    const bytes = await saveTelaFile(resolved.absolute, document, { createDirectory: true })
    return { design: resolved.relative, bytes: bytes.length, diskRevision: computeContentRevision(document) }
  })
}

export async function duplicateDesignFile(sourcePath: string, targetPath: string): Promise<{ design: string; bytes: number }> {
  const source = await resolveInRoot(sourcePath, 'design')
  const target = await resolveInRoot(targetPath, 'target_design', { forWrite: true, createParents: true })
  assertTelaExtension(source.relative)
  assertTelaExtension(target.relative)

  // Both paths under lock: the source must not be saved or archived between the
  // read and the write, and the target must not be created by anyone else
  // between the exists-check and the write.
  return withLocks([source.relative, target.relative], async () => {
    await assertAbsent(target, 'target_design')
    // Copy the *saved* file, not the in-memory session: a duplicate of a design
    // with unsaved edits should be a duplicate of what is on disk, and any other
    // choice makes "duplicate" mean two different things depending on hidden state.
    const { document } = await readBundleFile(source)
    const bytes = writeBundle(document)
    await saveTelaFile(target.absolute, document, { createDirectory: true })
    return { design: target.relative, bytes: bytes.length }
  })
}

/**
 * Import an external `.tela` bundle into the library.
 *
 * The source must itself be inside the approved root — this server has no
 * mechanism, and no permission, to read arbitrary paths on the machine.
 */
export async function importDesignFile(sourcePath: string, targetPath: string): Promise<{ design: string; bytes: number; migrationsApplied: string[] }> {
  const source = await resolveInRoot(sourcePath, 'source')
  const target = await resolveInRoot(targetPath, 'design', { forWrite: true, createParents: true })
  assertTelaExtension(target.relative)

  return withLocks([source.relative, target.relative], async () => {
    await assertAbsent(target, 'design')
    // Read through the validating reader before writing anything: an invalid or
    // hostile bundle is refused at the boundary rather than copied in and
    // discovered later.
    const { document, migrationsApplied } = await readBundleFile(source)
    const bytes = await saveTelaFile(target.absolute, document, { createDirectory: true })
    return { design: target.relative, bytes: bytes.length, migrationsApplied }
  })
}

/**
 * Move a design into the managed trash.
 *
 * Nothing is ever permanently deleted by this server. The trashed name carries a
 * timestamp so repeated archives of the same design do not collide.
 */
export async function archiveDesignFile(designPath: string): Promise<{ design: string; archivedAs: string }> {
  const resolved = await resolveInRoot(designPath, 'design', { forWrite: true })
  assertTelaExtension(resolved.relative)
  // Whole thing under the path lock. Outside it, the dirty check, the stat, the
  // rename, and the session drop each sit on the other side of an await from a
  // concurrent save: the save's atomic rename would recreate the file after the
  // archive moved it, leaving the design both archived and present, with the
  // trashed copy holding pre-save content.
  return withLock(resolved.relative, async () => {
    const entry = sessions.get(resolved.relative)
    if (entry?.dirty) {
      throw toolError(
        'conflict',
        `design "${resolved.relative}" has unsaved changes`,
        'save it with tela_save_design or close it with tela_close_design and discard_changes: true before archiving',
      )
    }
    try {
      await stat(resolved.absolute)
    } catch {
      throw toolError('not_found', `no design at "${resolved.relative}"`, 'call tela_list_designs to see what exists under the approved root')
    }

    const trash = trashDirectory()
    await mkdir(trash, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const archivedName = `${basename(resolved.relative, TELA_EXTENSION)}.${stamp}${TELA_EXTENSION}`
    const archivedPath = join(trash, archivedName)
    try {
      await rename(resolved.absolute, archivedPath)
    } catch {
      // A rename can fail across devices even inside one root (a bind mount).
      // Copy-then-verify is the fallback; the original is left in place if the
      // copy did not land, so an archive never loses the file.
      await copyFile(resolved.absolute, archivedPath)
      const { unlink } = await import('node:fs/promises')
      await unlink(resolved.absolute)
    }
    sessions.delete(resolved.relative)
    return { design: resolved.relative, archivedAs: toPosix(`.trash/${archivedName}`) }
  })
}

/** Park an excised fragment (page, frame, layers) in the trash as JSON. */
export async function archiveFragment(design: string, kind: string, payload: unknown): Promise<string> {
  const trash = trashDirectory()
  await mkdir(trash, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `${basename(design, TELA_EXTENSION).replace(/[^\w.-]/g, '_')}.${kind}.${stamp}.json`
  const { writeFileAtomic } = await import('../tela/nodeIo')
  await writeFileAtomic(join(trash, name), new TextEncoder().encode(JSON.stringify(payload, null, 2)), { createDirectory: true })
  return toPosix(`.trash/${name}`)
}

// --- Asset ingestion ---------------------------------------------------------

export interface IngestedAsset {
  sha256: string
  mime: string
  bytes: number
  dataUrl: string
}

/**
 * Read a file from inside the approved root and turn it into an inline payload.
 *
 * `makeAssetBlob` sniffs the *content*, not the extension — a `.png` holding a
 * WOFF2 is identified as a font and a file that matches nothing is refused. The
 * session holds payloads as `data:` URLs, which is the form the editor and the
 * renderer both expect; `writeBundle` content-addresses them at save time.
 */
export async function ingestAsset(sourcePath: string, maxBytes: number): Promise<IngestedAsset> {
  const resolved = await resolveInRoot(sourcePath, 'source')
  let bytes: Buffer
  try {
    bytes = await readFile(resolved.absolute)
  } catch {
    throw toolError('not_found', `no file at "${resolved.relative}"`, 'place the asset inside the approved root and pass its root-relative path')
  }
  if (bytes.length > maxBytes) {
    throw toolError(
      'policy_refused',
      `the asset is ${bytes.length} bytes, over the ${maxBytes}-byte limit`,
      'compress or resize the asset before importing it',
    )
  }
  const blob = makeAssetBlob(new Uint8Array(bytes))
  return {
    sha256: blob.sha256,
    mime: blob.mime,
    bytes: bytes.length,
    dataUrl: `data:${blob.mime};base64,${base64Encode(blob.bytes)}`,
  }
}

/** Where a design's exports land by default: a sibling directory named after the design. */
export function defaultExportDirectory(design: string): string {
  const withoutExtension = design.slice(0, -TELA_EXTENSION.length)
  const parent = dirname(design)
  return toPosix(parent === '.' ? `${basename(withoutExtension)}-exports` : `${parent}/${basename(withoutExtension)}-exports`)
}

/** Validate an arbitrary object as a document. Used by the validation tool. */
export function validateDocument(candidate: unknown): { valid: boolean; issues: string[] } {
  const parsed = telaDocumentSchema.safeParse(candidate)
  if (parsed.success) return { valid: true, issues: [] }
  return {
    valid: false,
    issues: parsed.error.issues.slice(0, 50).map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`),
  }
}
