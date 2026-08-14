/**
 * Public surface of the `.tela` portable-source layer.
 *
 * Node-only I/O (`nodeIo.ts`) is intentionally *not* re-exported here: importing it
 * from this barrel would pull `node:fs` into the browser bundle. Import it directly
 * where a Node context is guaranteed.
 */

export { canonicalize, canonicalBytes, CanonicalJsonError, type JsonValue } from './canonicalJson'
export { sha256Hex, sha256HexUtf8, sha256Bytes, isSha256Hex, toHex } from './sha256'
export {
  writeZip,
  readZip,
  crc32,
  assertSafeEntryName,
  ZipError,
  DEFAULT_ZIP_LIMITS,
  type ZipEntry,
  type ZipLimits,
} from './zip'
export {
  telaDocumentSchema,
  telaManifestSchema,
  layerSchema,
  CURRENT_DOCUMENT_SCHEMA_VERSION,
  CURRENT_BUNDLE_SCHEMA_VERSION,
  BUNDLE_SCHEMA_ID,
  DOCUMENT_SCHEMA_ID,
  SUPPORTED_ASSET_MIME,
  ASSET_REF_PATTERN,
  type TelaDocument,
  type TelaManifest,
  type TelaPage,
  type TelaFrame,
  type TelaLayer,
  type TelaAssetRecord,
  type TelaFontRecord,
  type TelaBrandContext,
  type TelaSavedVersion,
  type SupportedAssetMime,
} from './schema'
export { assertDocumentInvariants } from './invariants'
export { computeContentRevision, semanticProjection } from './contentRevision'
export { migrateDocument, MIGRATIONS, type Migration, type MigrationResult } from './migrations'
export {
  packAssets,
  unpackAssets,
  collectReferencedHashes,
  makeAssetBlob,
  assetRefFor,
  hashFromRef,
  base64Encode,
  base64Decode,
  REFERENCE_KEYS,
  type AssetBlob,
} from './assets'
export { sniffMime, isSupportedMime, extensionForMime } from './mime'
export {
  writeBundle,
  readBundle,
  readBundleForEditing,
  MANIFEST_ENTRY,
  DOCUMENT_ENTRY,
  type ReadBundleResult,
  type WriteBundleOptions,
} from './bundle'
export { TelaError, telaError, type TelaErrorCode } from './errors'
export { PRODUCER, PRODUCER_NAME, PRODUCER_VERSION, SOURCE_COMMIT, UNKNOWN_SOURCE_COMMIT } from './producer'
