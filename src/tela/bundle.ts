/**
 * The `.tela` bundle: writer and fail-closed reader.
 *
 * A bundle holds exactly three kinds of entry, in exactly this order:
 *
 *     manifest.json
 *     document.json
 *     assets/<sha256>.<ext>        (ascending by hash)
 *
 * The reader is deliberately unforgiving. Every property the writer guarantees is
 * re-checked on the way in — entry set, entry order, canonical encoding, hashes,
 * sniffed MIME, asset/reference closure, schema version, semantic invariants — and
 * any deviation aborts the whole read before a single byte of state is applied.
 * There is no partial import: `readBundle` either returns a complete, coherent
 * document or throws.
 */

import { canonicalBytes, canonicalize } from './canonicalJson'
import { sha256Hex } from './sha256'
import { readZip, writeZip, DEFAULT_ZIP_LIMITS, ZipError, type ZipEntry, type ZipLimits } from './zip'
import {
  telaDocumentSchema,
  telaManifestSchema,
  BUNDLE_SCHEMA_ID,
  DOCUMENT_SCHEMA_ID,
  CURRENT_BUNDLE_SCHEMA_VERSION,
  CURRENT_DOCUMENT_SCHEMA_VERSION,
  type TelaDocument,
  type TelaManifest,
} from './schema'
import { assertDocumentInvariants } from './invariants'
import { computeContentRevision } from './contentRevision'
import { migrateDocument } from './migrations'
import {
  packAssets,
  unpackAssets,
  collectReferencedHashes,
  assertPortableReferences,
  type AssetBlob,
} from './assets'
import { sniffMime, extensionForMime } from './mime'
import { PRODUCER } from './producer'
import { TelaError, telaError } from './errors'

export const MANIFEST_ENTRY = 'manifest.json'
export const DOCUMENT_ENTRY = 'document.json'
const ASSET_ENTRY = /^assets\/([0-9a-f]{64})\.([a-z0-9]{1,8})$/

export interface WriteBundleOptions {
  limits?: ZipLimits
  producer?: typeof PRODUCER
}

export interface ReadBundleResult {
  document: TelaDocument
  manifest: TelaManifest
  assets: Map<string, AssetBlob>
  /** Ordered ids of migrations applied while reading; empty for a current-version bundle. */
  migrationsApplied: string[]
}

function assetEntryName(blob: AssetBlob): string {
  return `assets/${blob.sha256}.${blob.ext}`
}

function ascending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// --- Write --------------------------------------------------------------------

/**
 * Serialize a complete editing state to bundle bytes.
 *
 * `source` is the document as the editor holds it, with payloads still inline as
 * `data:` URLs; packing to content-addressed assets happens here so callers cannot
 * forget to do it.
 */
export function writeBundle(source: unknown, options: WriteBundleOptions = {}): Uint8Array {
  const limits = options.limits ?? DEFAULT_ZIP_LIMITS
  const producer = options.producer ?? PRODUCER

  const { document: packedRaw, assets } = packAssets(source)

  const parsed = telaDocumentSchema.safeParse(packedRaw)
  if (!parsed.success) {
    throw telaError('document_invalid', 'refusing to write a document that fails schema validation', formatIssues(parsed.error))
  }
  const document = parsed.data
  assertPortableReferences(document)
  assertDocumentInvariants(document)

  // Reference closure, both directions. A dangling reference would produce a file
  // that cannot be opened; an orphaned asset would silently bloat every future save.
  const referenced = collectReferencedHashes(document)
  const present = new Set(assets.map((a) => a.sha256))
  for (const hash of referenced) {
    if (!present.has(hash)) {
      throw telaError('asset_missing', 'document references an asset that was not collected', hash)
    }
  }
  for (const hash of present) {
    if (!referenced.has(hash)) {
      throw telaError('asset_orphaned', 'collected an asset that no part of the document references', hash)
    }
  }

  const documentBytes = canonicalBytes(document)

  const manifest: TelaManifest = {
    format: 'tela-bundle',
    schema: BUNDLE_SCHEMA_ID,
    schemaVersion: CURRENT_BUNDLE_SCHEMA_VERSION,
    documentSchema: DOCUMENT_SCHEMA_ID,
    documentSchemaVersion: document.schemaVersion,
    producer: { name: producer.name, version: producer.version, sourceCommit: producer.sourceCommit },
    document: { sha256: sha256Hex(documentBytes), size: documentBytes.length },
    assets: assets.map((a) => ({ sha256: a.sha256, size: a.bytes.length, mime: a.mime, ext: a.ext })),
    limits: {
      maxArchiveBytes: limits.maxArchiveBytes,
      maxEntryBytes: limits.maxEntryBytes,
      maxTotalEntryBytes: limits.maxTotalEntryBytes,
      maxEntries: limits.maxEntries,
      maxNameBytes: limits.maxNameBytes,
    },
    migration: { originalDocumentSchemaVersion: document.schemaVersion, applied: [] },
    contentRevision: computeContentRevision(document),
  }

  const manifestCheck = telaManifestSchema.safeParse(manifest)
  if (!manifestCheck.success) {
    throw telaError('manifest_invalid', 'internal error: produced an invalid manifest', formatIssues(manifestCheck.error))
  }

  const entries: ZipEntry[] = [
    { name: MANIFEST_ENTRY, data: canonicalBytes(manifest) },
    { name: DOCUMENT_ENTRY, data: documentBytes },
    ...assets.map((blob) => ({ name: assetEntryName(blob), data: blob.bytes })),
  ]

  try {
    return writeZip(entries, limits)
  } catch (cause) {
    if (cause instanceof ZipError) {
      throw telaError('container_invalid', `could not write the bundle container: ${cause.message}`, cause.code)
    }
    throw cause
  }
}

// --- Read ---------------------------------------------------------------------

export function readBundle(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ReadBundleResult {
  let entries: ZipEntry[]
  try {
    entries = readZip(bytes, limits)
  } catch (cause) {
    if (cause instanceof ZipError) {
      throw telaError('container_invalid', `not a valid .tela bundle: ${cause.message}`, cause.code)
    }
    throw cause
  }

  // --- entry set and order ---
  if (entries.length < 2) throw telaError('missing_entry', 'bundle is missing manifest.json or document.json')
  if (entries[0].name !== MANIFEST_ENTRY) {
    throw telaError('entry_order', `the first entry must be ${MANIFEST_ENTRY}`, entries[0].name)
  }
  if (entries[1].name !== DOCUMENT_ENTRY) {
    throw telaError('entry_order', `the second entry must be ${DOCUMENT_ENTRY}`, entries[1].name)
  }

  const assetEntries = entries.slice(2)
  let previousHash = ''
  const assetsByHash = new Map<string, AssetBlob>()
  for (const entry of assetEntries) {
    const match = ASSET_ENTRY.exec(entry.name)
    if (!match) {
      throw telaError('unexpected_entry', 'bundle holds an entry that is neither the manifest, the document, nor an asset', entry.name)
    }
    const [, declaredHash, declaredExt] = match
    if (ascending(declaredHash, previousHash) <= 0) {
      throw telaError('entry_order', 'asset entries are not in ascending hash order', entry.name)
    }
    previousHash = declaredHash

    // The entry *name* is a claim about the content. Verify it.
    const actualHash = sha256Hex(entry.data)
    if (actualHash !== declaredHash) {
      throw telaError('asset_hash_mismatch', `asset ${entry.name} does not hash to its own name`, actualHash)
    }
    const mime = sniffMime(entry.data)
    if (!mime) {
      throw telaError('asset_mime_invalid', `asset ${entry.name} is not an accepted content type`)
    }
    if (extensionForMime(mime) !== declaredExt) {
      throw telaError(
        'asset_mime_invalid',
        `asset ${entry.name} has extension .${declaredExt} but its content is ${mime}`,
      )
    }
    assetsByHash.set(declaredHash, { sha256: declaredHash, bytes: entry.data, mime, ext: declaredExt })
  }

  // --- manifest ---
  const manifestRaw = parseJsonEntry(entries[0], 'manifest_invalid')
  assertBundleVersionUnderstood(manifestRaw)
  const manifestParsed = telaManifestSchema.safeParse(manifestRaw)
  if (!manifestParsed.success) {
    throw telaError('manifest_invalid', 'manifest.json failed schema validation', formatIssues(manifestParsed.error))
  }
  const manifest = manifestParsed.data

  // The manifest is itself canonical JSON; if it is not, the bundle did not come
  // from a conforming writer and its byte-determinism claims are void.
  assertCanonical(entries[0], manifestRaw, 'manifest_invalid', MANIFEST_ENTRY)

  // A bundle may not ask the reader to raise its own ceilings.
  for (const key of ['maxArchiveBytes', 'maxEntryBytes', 'maxTotalEntryBytes', 'maxEntries', 'maxNameBytes'] as const) {
    if (manifest.limits[key] > limits[key]) {
      throw telaError(
        'manifest_invalid',
        `manifest declares ${key}=${manifest.limits[key]}, above this build's limit of ${limits[key]}`,
      )
    }
  }

  // --- document integrity ---
  const documentEntry = entries[1]
  if (documentEntry.data.length !== manifest.document.size) {
    throw telaError('document_hash_mismatch', 'document.json size does not match the manifest')
  }
  const documentHash = sha256Hex(documentEntry.data)
  if (documentHash !== manifest.document.sha256) {
    throw telaError('document_hash_mismatch', 'document.json does not match the hash recorded in the manifest', documentHash)
  }

  // --- asset table agrees with the entries actually present ---
  if (manifest.assets.length !== assetsByHash.size) {
    throw telaError('asset_table_invalid', `manifest lists ${manifest.assets.length} assets but the bundle holds ${assetsByHash.size}`)
  }
  let previousListed = ''
  for (const listed of manifest.assets) {
    if (ascending(listed.sha256, previousListed) <= 0) {
      throw telaError('asset_table_invalid', 'manifest asset table is not in ascending hash order', listed.sha256)
    }
    previousListed = listed.sha256
    const blob = assetsByHash.get(listed.sha256)
    if (!blob) throw telaError('asset_missing', 'manifest lists an asset that is not in the bundle', listed.sha256)
    if (blob.bytes.length !== listed.size) {
      throw telaError('asset_table_invalid', `asset ${listed.sha256} size disagrees with the manifest`)
    }
    if (blob.mime !== listed.mime) {
      throw telaError('asset_mime_invalid', `asset ${listed.sha256} sniffs as ${blob.mime}, manifest declares ${listed.mime}`)
    }
    if (blob.ext !== listed.ext) {
      throw telaError('asset_table_invalid', `asset ${listed.sha256} extension disagrees with the manifest`)
    }
  }

  // --- document shape, version, semantics ---
  const documentRaw = parseJsonEntry(documentEntry, 'document_invalid')
  const migration = migrateDocument(documentRaw)

  if (migration.applied.length === 0) {
    // Only meaningful for an un-migrated document: a migration legitimately
    // rewrites bytes, so re-canonicalizing a migrated document will not reproduce
    // what was stored.
    assertCanonical(documentEntry, documentRaw, 'document_invalid', DOCUMENT_ENTRY)
  }

  const documentParsed = telaDocumentSchema.safeParse(migration.document)
  if (!documentParsed.success) {
    throw telaError('document_invalid', 'document.json failed schema validation', formatIssues(documentParsed.error))
  }
  const document = documentParsed.data
  assertPortableReferences(document)
  assertDocumentInvariants(document)

  if (manifest.documentSchemaVersion !== migration.originalVersion) {
    throw telaError(
      'manifest_invalid',
      `manifest declares document schema v${manifest.documentSchemaVersion} but document.json declares v${migration.originalVersion}`,
    )
  }
  if (manifest.migration.originalDocumentSchemaVersion !== migration.originalVersion) {
    throw telaError('manifest_invalid', 'manifest migration metadata disagrees with the document schema version')
  }

  if (migration.applied.length === 0) {
    const revision = computeContentRevision(document)
    if (revision !== manifest.contentRevision) {
      throw telaError('content_revision_mismatch', 'manifest contentRevision does not match the document', revision)
    }
  }

  // --- reference closure ---
  const referenced = collectReferencedHashes(document)
  for (const hash of referenced) {
    if (!assetsByHash.has(hash)) {
      throw telaError('asset_missing', 'document references an asset that is not in the bundle', hash)
    }
  }
  for (const hash of assetsByHash.keys()) {
    if (!referenced.has(hash)) {
      throw telaError('asset_orphaned', 'bundle holds an asset that no part of the document references', hash)
    }
  }

  return { document, manifest, assets: assetsByHash, migrationsApplied: migration.applied }
}

/**
 * Read a bundle and resolve its assets back to inline `data:` URLs, which is what
 * the editing session consumes.
 */
export function readBundleForEditing(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): {
  document: TelaDocument
  manifest: TelaManifest
  migrationsApplied: string[]
} {
  const result = readBundle(bytes, limits)
  return {
    document: unpackAssets(result.document, result.assets),
    manifest: result.manifest,
    migrationsApplied: result.migrationsApplied,
  }
}

// --- helpers ------------------------------------------------------------------

function parseJsonEntry(entry: ZipEntry, code: 'manifest_invalid' | 'document_invalid'): Record<string, unknown> {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(entry.data)
  } catch {
    throw telaError(code, `${entry.name} is not valid UTF-8`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw telaError(code, `${entry.name} is not valid JSON`, cause instanceof Error ? cause.message : undefined)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw telaError(code, `${entry.name} must contain a JSON object`)
  }
  return value as Record<string, unknown>
}

function assertCanonical(
  entry: ZipEntry,
  parsed: unknown,
  code: 'manifest_invalid' | 'document_invalid',
  name: string,
): void {
  const expected = canonicalize(parsed)
  const actual = new TextDecoder().decode(entry.data)
  if (expected !== actual) {
    throw telaError(code, `${name} is not RFC 8785 canonical JSON`)
  }
}

function assertBundleVersionUnderstood(manifest: Record<string, unknown>): void {
  const version = manifest.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw telaError('unknown_schema_version', 'manifest.json does not declare a valid bundle schemaVersion', String(version))
  }
  if (version > CURRENT_BUNDLE_SCHEMA_VERSION) {
    throw telaError(
      'future_schema_version',
      `this bundle uses bundle format v${version}; this build understands up to v${CURRENT_BUNDLE_SCHEMA_VERSION}. Update Tela to open it.`,
      String(version),
    )
  }
}

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
}

export { TelaError, CURRENT_DOCUMENT_SCHEMA_VERSION }
