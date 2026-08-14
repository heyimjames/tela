/**
 * Crash safety of the save path.
 *
 * The claim under test is narrow and absolute: **a failed save cannot damage the
 * last valid master.** Each test forces a failure at a different point in the
 * sequence and then asserts two things — the previous file is byte-identical, and
 * no temporary file is left behind for a later save to trip over.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir, readFile, writeFile, stat, chmod, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import { saveTelaFile, readTelaFile, openTelaFile, writeFileAtomic } from './nodeIo'
import { writeBundle } from './bundle'
import { TelaError } from './errors'
import { makeFullCoverageDocument } from './__fixtures__/fullCoverage'

let directory: string
let target: string

const digest = (bytes: Uint8Array | Buffer) => createHash('sha256').update(bytes).digest('hex')

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tela-io-'))
  target = join(directory, 'campaign.tela')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function temporaryFiles(): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.endsWith('.tmp'))
}

describe('atomic save', () => {
  it('writes a readable bundle and leaves no temporary file', async () => {
    await saveTelaFile(target, makeFullCoverageDocument())
    expect(await temporaryFiles()).toEqual([])

    const { document, manifest } = await readTelaFile(target)
    expect(document.id).toBe('doc-full-coverage')
    expect(manifest.format).toBe('tela-bundle')
  })

  // POSIX-only, and deliberately not relaxed to a range: the save path asks for
  // 0644 and must get exactly that, so a stray 0666 or 0600 is a regression.
  // Windows has no POSIX mode bits — NTFS permissions are ACLs, and Node
  // synthesises `mode` from the read-only attribute alone, reporting 0666 for
  // every writable file no matter what mode `open()` was given. There is nothing
  // to assert there. This is a property of the file on disk, not of the bundle
  // bytes, so it is not part of the byte-determinism claim.
  it.skipIf(process.platform === 'win32')('writes the file with mode 0644', async () => {
    await saveTelaFile(target, makeFullCoverageDocument())
    expect((await stat(target)).mode & 0o777).toBe(0o644)
  })

  it('replaces an existing master atomically', async () => {
    await saveTelaFile(target, makeFullCoverageDocument())
    const first = await readFile(target)

    const edited = makeFullCoverageDocument()
    edited.name = 'Second revision'
    await saveTelaFile(target, edited)

    const second = await readFile(target)
    expect(digest(second)).not.toBe(digest(first))
    expect((await openTelaFile(target)).document.name).toBe('Second revision')
    expect(await temporaryFiles()).toEqual([])
  })

  it('produces byte-identical files for a no-op save cycle', async () => {
    await saveTelaFile(target, makeFullCoverageDocument())
    const first = await readFile(target)

    const reopened = await openTelaFile(target)
    await saveTelaFile(target, reopened.document)

    expect(digest(await readFile(target))).toBe(digest(first))
  })
})

describe('a failed save never damages the last valid master', () => {
  async function seedValidMaster(): Promise<string> {
    await saveTelaFile(target, makeFullCoverageDocument())
    return digest(await readFile(target))
  }

  it('refuses an invalid document before touching the file at all', async () => {
    const before = await seedValidMaster()

    const broken = makeFullCoverageDocument()
    ;(broken as Record<string, unknown>).schemaVersion = 99

    await expect(saveTelaFile(target, broken)).rejects.toBeInstanceOf(TelaError)
    expect(digest(await readFile(target))).toBe(before)
    expect(await temporaryFiles()).toEqual([])
  })

  it('refuses an unresolvable reference before touching the file', async () => {
    const before = await seedValidMaster()

    const broken = makeFullCoverageDocument()
    const pages = broken.pages as Array<{ frames: Array<{ layers: Array<Record<string, unknown>> }> }>
    pages[0].frames[0].layers[2].imageUrl = 'blob:http://localhost/dead-handle'

    await expect(saveTelaFile(target, broken)).rejects.toMatchObject({ code: 'unresolved_reference' })
    expect(digest(await readFile(target))).toBe(before)
    expect(await temporaryFiles()).toEqual([])
  })

  it('survives a crash after the temp file is written but before the sync', async () => {
    const before = await seedValidMaster()
    const bytes = writeBundle(makeFullCoverageDocument())

    await expect(
      writeFileAtomic(target, bytes, {
        hooks: {
          afterWrite: () => {
            throw new Error('simulated power loss during write')
          },
        },
      }),
    ).rejects.toThrow('simulated power loss')

    expect(digest(await readFile(target))).toBe(before)
    expect(await temporaryFiles()).toEqual([])
  })

  it('survives a crash after the sync but before the rename', async () => {
    const before = await seedValidMaster()
    const bytes = writeBundle(makeFullCoverageDocument())

    await expect(
      writeFileAtomic(target, bytes, {
        hooks: {
          beforeRename: () => {
            throw new Error('simulated crash before rename')
          },
        },
      }),
    ).rejects.toThrow('simulated crash before rename')

    // The whole point of writing to a temp file: the master still holds the last
    // committed bytes, and the abandoned temp file has been cleaned up.
    expect(digest(await readFile(target))).toBe(before)
    expect(await temporaryFiles()).toEqual([])
  })

  // POSIX-only. `chmod(directory, 0o500)` is not a portable way to deny a write:
  // Windows derives directory access from ACLs, ignores the mode bits Node maps
  // onto `chmod`, and the owning account keeps write access regardless — the save
  // simply succeeds and the test loses its premise. Rather than assert something
  // weaker on Windows, this case stays POSIX-only and the case below covers the
  // same guarantee everywhere.
  it.skipIf(process.platform === 'win32')('leaves the master intact when the directory is read-only', async () => {
    const before = await seedValidMaster()
    await chmod(directory, 0o500)
    try {
      await expect(saveTelaFile(target, makeFullCoverageDocument())).rejects.toMatchObject({ code: 'io_failed' })
    } finally {
      await chmod(directory, 0o700)
    }
    expect(digest(await readFile(target))).toBe(before)
    expect(await temporaryFiles()).toEqual([])
  })

  // The platform-independent counterpart to the read-only-directory case, so the
  // "a failed save never damages the last valid master" guarantee is exercised on
  // Windows too rather than only on POSIX.
  //
  // The failure injected here is not a thrown hook — the two cases above already
  // cover that. Removing the temporary file before the rename makes `rename(2)`
  // itself fail with a genuine operating-system error, so this drives the real
  // failure path inside `writeFileAtomic`: the catch block cleans up, and
  // `saveTelaFile` surfaces it as `io_failed`. The three assertions are the same
  // ones the read-only case makes.
  it('leaves the master intact when the operating system fails the rename', async () => {
    const before = await seedValidMaster()

    await expect(
      saveTelaFile(target, makeFullCoverageDocument(), {
        hooks: { beforeRename: (temporaryPath) => unlink(temporaryPath) },
      }),
    ).rejects.toMatchObject({ code: 'io_failed' })

    expect(digest(await readFile(target))).toBe(before)
    expect(await temporaryFiles()).toEqual([])
  })

  it('writes into the target directory, not a system temp directory', async () => {
    // A temp file on another filesystem could not be renamed atomically, so the
    // location is part of the guarantee, not an implementation detail.
    let observed = ''
    await writeFileAtomic(target, writeBundle(makeFullCoverageDocument()), {
      hooks: { afterWrite: (path) => void (observed = path) },
    })
    expect(observed.startsWith(directory)).toBe(true)
  })
})

describe('reading', () => {
  it('reports a missing file as an io failure rather than a corrupt bundle', async () => {
    await expect(readTelaFile(join(directory, 'nope.tela'))).rejects.toMatchObject({ code: 'io_failed' })
  })

  it('rejects a corrupted file on disk', async () => {
    await saveTelaFile(target, makeFullCoverageDocument())
    const bytes = await readFile(target)
    // Flip a byte inside the document payload.
    bytes[Math.floor(bytes.length / 2)] ^= 0xff
    await writeFile(target, bytes)

    await expect(readTelaFile(target)).rejects.toBeInstanceOf(TelaError)
  })
})
