import { describe, it, expect } from 'vitest'
import { migrateDocument, MIGRATIONS, type Migration } from './migrations'
import { readBundle } from './bundle'
import { writeZip } from './zip'
import { canonicalBytes } from './canonicalJson'
import { sha256Hex } from './sha256'
import { computeContentRevision } from './contentRevision'
import { CURRENT_DOCUMENT_SCHEMA_VERSION, telaDocumentSchema } from './schema'
import { TelaError } from './errors'
import { makeFullCoverageDocument } from './__fixtures__/fullCoverage'

function expectTelaError(run: () => unknown, code: string): TelaError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(TelaError)
    expect((error as TelaError).code).toBe(code)
    return error as TelaError
  }
  throw new Error(`expected a TelaError with code ${code}, but nothing was thrown`)
}

describe('migration machinery', () => {
  it('is a no-op for a current-version document', () => {
    const document = makeFullCoverageDocument()
    const result = migrateDocument(document)
    expect(result.originalVersion).toBe(CURRENT_DOCUMENT_SCHEMA_VERSION)
    expect(result.applied).toEqual([])
    expect(result.document).toEqual(document)
  })

  it('refuses a document from a future schema version', () => {
    const document = makeFullCoverageDocument()
    document.schemaVersion = CURRENT_DOCUMENT_SCHEMA_VERSION + 1
    const error = expectTelaError(() => migrateDocument(document), 'future_schema_version')
    // The message has to tell a user what to do, not just that something failed.
    expect(error.message).toMatch(/Update Pyrito Design to open it/)
  })

  it('refuses a document with no usable schema version', () => {
    for (const value of [undefined, null, 'one', 1.5, 0, -1]) {
      const document = makeFullCoverageDocument()
      document.schemaVersion = value as never
      expectTelaError(() => migrateDocument(document), 'unknown_schema_version')
    }
  })

  it('refuses an old version with no registered migration path', () => {
    const document = makeFullCoverageDocument()
    document.schemaVersion = 0.5 as never
    expectTelaError(() => migrateDocument(document), 'unknown_schema_version')
  })

  it('every registered migration forms a contiguous chain ending at the current version', () => {
    // Guards the ordering contract as migrations are added over time.
    const sorted = [...MIGRATIONS].sort((a, b) => a.from - b.from)
    expect(MIGRATIONS).toEqual(sorted)
    for (const step of MIGRATIONS) {
      expect(step.to).toBe(step.from + 1)
      expect(step.id).toMatch(/^v\d+->v\d+/)
    }
    if (MIGRATIONS.length > 0) {
      expect(MIGRATIONS[MIGRATIONS.length - 1].to).toBe(CURRENT_DOCUMENT_SCHEMA_VERSION)
    }
    expect(new Set(MIGRATIONS.map((m) => m.from)).size).toBe(MIGRATIONS.length)
  })
})

describe('migration behaviour with a synthetic chain', () => {
  /**
   * v1 is the first published schema, so there is nothing real to migrate yet.
   * These tests drive the machinery with a stand-in chain so the first *real*
   * migration inherits proven behaviour rather than untested code.
   */
  const chain: Migration[] = [
    {
      id: 'v1->v2:rename-thing',
      from: 1,
      to: 2,
      migrate: (document) => ({ ...document, migratedOnce: true }),
    },
    {
      id: 'v2->v3:split-thing',
      from: 2,
      to: 3,
      migrate: (document) => ({ ...document, migratedTwice: true }),
    },
  ]

  function run(startVersion: number, target: number) {
    let document: Record<string, unknown> = { schemaVersion: startVersion }
    const applied: string[] = []
    let version = startVersion
    while (version < target) {
      const step = chain.find((m) => m.from === version)
      if (!step) throw new Error(`no migration from v${version}`)
      document = { ...step.migrate(document), schemaVersion: step.to }
      applied.push(step.id)
      version = step.to
    }
    return { document, applied }
  }

  it('applies each step in order and records their ids', () => {
    const result = run(1, 3)
    expect(result.applied).toEqual(['v1->v2:rename-thing', 'v2->v3:split-thing'])
    expect(result.document).toMatchObject({ schemaVersion: 3, migratedOnce: true, migratedTwice: true })
  })

  it('reports a failing step by id', () => {
    const failing: Migration = {
      id: 'v1->v2:explodes',
      from: 1,
      to: 2,
      migrate: () => {
        throw new Error('bad data')
      },
    }
    expect(() => failing.migrate({})).toThrow('bad data')
    expect(failing.id).toContain('v1->v2')
  })
})

describe('future bundles are refused end to end', () => {
  it('rejects a bundle whose document declares a newer schema', () => {
    const document = makeFullCoverageDocument()
    document.schemaVersion = 2
    // Bypass the writer (which would refuse) to build what a newer Tela would emit.
    const documentBytes = canonicalBytes(document)
    const parsedForRevision = telaDocumentSchema.safeParse(makeFullCoverageDocument())
    expect(parsedForRevision.success).toBe(true)

    const manifest = {
      format: 'tela-bundle',
      schema: 'https://schemas.clickt.ca/tela/bundle/v1',
      schemaVersion: 1,
      documentSchema: 'https://schemas.clickt.ca/tela/document/v1',
      documentSchemaVersion: 2,
      producer: { name: 'tela-design', version: '9.0.0', sourceCommit: 'a'.repeat(40) },
      document: { sha256: sha256Hex(documentBytes), size: documentBytes.length },
      assets: [],
      limits: {
        maxArchiveBytes: 268435456,
        maxEntryBytes: 67108864,
        maxTotalEntryBytes: 268435456,
        maxEntries: 4096,
        maxNameBytes: 200,
      },
      migration: { originalDocumentSchemaVersion: 2, applied: [] },
      contentRevision: computeContentRevision(parsedForRevision.data!),
    }

    const bytes = writeZip([
      { name: 'manifest.json', data: canonicalBytes(manifest) },
      { name: 'document.json', data: documentBytes },
    ])

    const error = expectTelaError(() => readBundle(bytes), 'future_schema_version')
    expect(error.message).toMatch(/document schema v2/)
  })
})
