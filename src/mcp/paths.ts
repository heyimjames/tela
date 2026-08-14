/**
 * Approved-root confinement.
 *
 * Every filesystem path this server touches is expressed by the *caller* as a
 * root-relative POSIX-ish path and resolved here. The rules, and why each one is
 * not optional:
 *
 *  - **Relative only.** An absolute path from the client is refused outright.
 *    Accepting one would make the approved root advisory.
 *  - **No `..`, no drive letters, no UNC, no NUL.** Checked on the *input*
 *    string before any resolution, because `resolve()` happily normalizes an
 *    escape into a legitimate-looking path.
 *  - **Containment re-checked after resolution**, with a separator-terminated
 *    prefix so `/root/../rootjacked` cannot pass as `/root`.
 *  - **No symlink following.** `lstat` on every existing component: a symlink,
 *    junction, or reparse point anywhere on the path is refused even when its
 *    target would itself be inside the root — the target can be swapped between
 *    the check and the open.
 *  - **Same device.** A component on a different device than the root is a
 *    mount (or a network filesystem) and is refused; the atomic-rename
 *    guarantee the writer depends on does not cross devices.
 *  - **No hardlinked targets.** A regular file with `nlink > 1` is refused for
 *    writes: the "atomic replace" would leave the other link pointing at the
 *    old content, which is exactly the confusion this confinement exists to
 *    prevent.
 *
 * This confinement is deliberately independent of MCP client roots. Client
 * roots are a hint from a peer; this is policy.
 */

import { lstat, mkdir, stat } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { isAbsolute, join, normalize, resolve, sep, dirname, relative } from 'node:path'

import { toolError } from './errors'

/** Default runtime roots from the architecture contract. */
export function defaultApprovedRoot(): string {
  if (platform() === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (local) return join(local, 'Clickt', 'AdStudio', 'tela')
    return join(homedir(), 'AppData', 'Local', 'Clickt', 'AdStudio', 'tela')
  }
  return join(homedir(), 'Library', 'Application Support', 'Clickt', 'AdStudio', 'tela')
}

/**
 * The approved root for this process.
 *
 * Read once per call rather than memoized at import time: `buildServer()` must
 * stay side-effect-free, and tests set the variable per case.
 */
export function approvedRoot(): string {
  const configured = process.env.TELA_APPROVED_ROOT
  const root = configured && configured.trim() ? resolve(configured.trim()) : defaultApprovedRoot()
  assertUsableRoot(root)
  return root
}

/**
 * Roots that are refused on sight. A volume root or a bare user profile as the
 * approved root would make confinement meaningless — every subsequent check
 * would pass while the blast radius is the whole machine.
 */
function assertUsableRoot(root: string): void {
  const normalized = normalize(root)
  const parent = dirname(normalized)
  if (parent === normalized) {
    throw toolError(
      'policy_refused',
      'the approved root is a volume or drive root',
      'point TELA_APPROVED_ROOT at a dedicated directory (for example <home>/Library/Application Support/Clickt/AdStudio/tela) and restart the server',
    )
  }
  let home: string | undefined
  try {
    home = homedir()
  } catch {
    home = undefined
  }
  if (home && normalize(home) === normalized) {
    throw toolError(
      'policy_refused',
      'the approved root is the user profile directory',
      'point TELA_APPROVED_ROOT at a dedicated subdirectory rather than the home directory, then restart the server',
    )
  }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/** Validate the caller-supplied shape of a relative path, before it touches the filesystem. */
export function assertRelativePathShape(input: string, field: string): void {
  if (!input || !input.trim()) {
    throw toolError('invalid_input', `${field} is empty`, `pass ${field} as a path relative to the approved root, e.g. "campaigns/spring.tela"`)
  }
  if (input.includes('\0')) {
    throw toolError('invalid_input', `${field} contains a NUL byte`, `pass ${field} as a plain relative path with no control characters`)
  }
  if (isAbsolute(input) || /^[A-Za-z]:/.test(input) || input.startsWith('\\\\') || input.startsWith('//')) {
    throw toolError(
      'policy_refused',
      `${field} is an absolute, drive-qualified, or UNC path`,
      `pass ${field} relative to the approved root instead; call tela_get_status to see the root this server is confined to`,
    )
  }
  const segments = input.split(/[\\/]/)
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      throw toolError('policy_refused', `${field} escapes the approved root with ".."`, `pass ${field} as a path that stays inside the approved root`)
    }
    if (WINDOWS_RESERVED.test(segment)) {
      throw toolError('policy_refused', `${field} uses a reserved device name ("${segment}")`, `rename the file so no path segment is a reserved Windows device name`)
    }
    if (segment.endsWith(' ') || segment.endsWith('.')) {
      throw toolError('policy_refused', `${field} has a segment ending in a space or dot`, `rename the file so no path segment ends in a space or a dot`)
    }
  }
}

export interface ResolveOptions {
  /** The path is being opened for writing; run the write-only checks too. */
  forWrite?: boolean
  /** Create the containing directory when missing (write paths only). */
  createParents?: boolean
}

export interface ResolvedPath {
  /** The absolute path on disk. Never returned to a client. */
  absolute: string
  /** The root-relative POSIX form. This is the only form that crosses the wire. */
  relative: string
}

/**
 * Resolve a caller-supplied relative path inside the approved root, refusing
 * every escape route. Async because the filesystem checks are.
 */
export async function resolveInRoot(input: string, field: string, options: ResolveOptions = {}): Promise<ResolvedPath> {
  assertRelativePathShape(input, field)
  const root = approvedRoot()
  const absolute = resolve(root, input)

  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (absolute !== root && !absolute.startsWith(rootWithSep)) {
    throw toolError(
      'policy_refused',
      `${field} resolves outside the approved root`,
      `pass ${field} as a path inside the approved root; call tela_get_status to confirm the root`,
    )
  }

  if (options.createParents) {
    await mkdir(dirname(absolute), { recursive: true })
  }

  await assertNoEscapingComponents(root, absolute, field, options.forWrite === true)

  return { absolute, relative: toPosix(relative(root, absolute)) }
}

/** Root-relative POSIX form, the only path shape that is ever returned to a client. */
export function toPosix(input: string): string {
  return input.split(sep).join('/')
}

async function assertNoEscapingComponents(root: string, absolute: string, field: string, forWrite: boolean): Promise<void> {
  let rootDevice: number
  try {
    rootDevice = (await stat(root)).dev
  } catch {
    // The root does not exist yet. Nothing under it exists either, so there is
    // no component to check and no device to compare against.
    return
  }

  const suffix = relative(root, absolute)
  const segments = suffix.split(sep).filter(Boolean)
  let current = root
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index])
    let info
    try {
      info = await lstat(current)
    } catch {
      // Missing component: nothing to follow, and everything below it is also
      // missing. A later create lands inside an already-verified chain.
      return
    }
    if (info.isSymbolicLink()) {
      throw toolError(
        'policy_refused',
        `${field} passes through a symlink or reparse point`,
        `resolve the link yourself and pass a real path inside the approved root; links are refused because their target can change between the check and the open`,
      )
    }
    if (info.dev !== rootDevice) {
      throw toolError(
        'policy_refused',
        `${field} crosses a mount point or network filesystem`,
        `keep ${field} on the same device as the approved root; atomic replacement is not available across devices`,
      )
    }
    const isLast = index === segments.length - 1
    if (isLast && forWrite && info.isFile() && info.nlink > 1) {
      throw toolError(
        'policy_refused',
        `${field} names a hardlinked file`,
        `copy the file to a fresh path inside the approved root and write to that instead`,
      )
    }
  }
}

/** Trash location for archive operations. Nothing is ever permanently deleted. */
export function trashDirectory(): string {
  return join(approvedRoot(), '.trash')
}
