# The `.tela` portable source format

A `.tela` file is the **master** copy of a design. Browser localStorage is a cache.

That sentence is the whole design. Everything below follows from it.

---

## Why the format exists

Before this, the only durable copy of a design lived in four `localStorage` keys,
and the one path that wrote a design back to the library (`DesignFile`) rebuilt each
frame from an explicit list of ten fields. Anything not on that list — a frame's
background colour, its lock state, its visibility, and every loose element on the
canvas — was discarded on save, with no error and nothing in the UI to suggest it
had happened.

A format fixes that only if it makes the failure *impossible* rather than *fixed
once*. So the rules below are enforced by the writer, re-checked by the reader, and
covered by tests that fail when a field stops being exercised.

## Layout

A `.tela` file is a ZIP archive in **STORE mode** (no compression) containing
exactly these entries, in exactly this order:

```text
manifest.json
document.json
assets/<sha256>.<ext>      ← ascending by hash
```

Anything else — a `README`, a directory entry, a second manifest — is a hard
rejection, not a warning.

### `manifest.json`

Format identity, the schema version, the producing build and its source commit, the
document's hash and size, the sorted asset inventory, the reader limits, migration
metadata, and the semantic `contentRevision`.

It deliberately carries **no save-time timestamp**. A save time would make every
save produce different bytes for identical content, which would defeat the
determinism contract in the field intended to make bundles auditable.

### `document.json`

The complete editable Pyrito Design state, as RFC 8785 canonical JSON: all pages, all frames
(including `backgroundColor`, `locked`, and `visible`), loose elements, all eight
layer types with their full optional surface, auto-layout configs including nesting,
the active page and frame, workspace settings, document identity and timestamps,
saved versions, brand context, the asset registry, and imported licensed WOFF2
fonts.

### `assets/<sha256>.<ext>`

Content-addressed payloads. Every reference in the document is
`asset://<sha256>` — never a `data:`, `blob:`, `file:`, or `http(s):` URL. A payload
referenced from five places is stored once.

## Determinism

**The same document always produces the same bytes, on every machine.**

This is guaranteed by construction rather than by convention. There is no clock, no
locale, no path separator, no host identity, and no `process` anywhere in the
writer:

| Source of variation | How it is removed |
|---|---|
| JSON key order | RFC 8785 canonicalization, sorted by UTF-16 code unit |
| Number formatting | ECMAScript `Number::toString`; `-0` normalized; `NaN`/`Infinity` refused |
| ZIP timestamps | Fixed DOS epoch (1980-01-01 00:00:00) on every entry |
| File modes | Fixed `0644` regular-file external attributes |
| Entry order | manifest, document, then assets ascending by hash |
| Compression | STORE only, so no compressor version can change the bytes |
| Extra fields, comments, data descriptors | Never written; rejected on read |
| Save time | Not recorded anywhere |
| Locale | No locale-aware comparison anywhere; sorting is by code unit |

A no-op open → save → reopen produces a byte-identical file and an unchanged
semantic revision.

## Two revisions

- **`manifest.document.sha256`** covers the document byte for byte: *is this the
  same file?*
- **`manifest.contentRevision`** covers creative content only — pages, versions,
  brand, assets, fonts — excluding identity, timestamps, the active page/frame, and
  workspace settings: *is this the same design?*

Switching the active page changes the document hash but not the content revision.
Editing a headline changes both.

## Fail-closed reading

`readBundle` has no partial-success mode. Every one of these aborts the read before
anything is returned:

- a document or manifest that is not canonical JSON, or fails schema validation, or
  carries an unknown field;
- a document hash, content revision, asset hash, or CRC that does not match;
- an asset whose sniffed content type contradicts its extension or the manifest;
- an asset the document does not reference, or a reference with no asset;
- a schema version newer than this build understands;
- an entry name that is absolute, has a drive letter, a backslash, a `..` segment, a
  colon, or a trailing slash;
- a non-regular-file mode (symlink, directory, device) or a non-`0644` mode;
- DEFLATE or any method other than STORE, encryption flags, or a data descriptor;
- duplicate or case-colliding entry names;
- an entry above the size limit, a total above the total limit, or too many entries;
- a prepended stub, an interior gap, trailing bytes, or an archive comment;
- a semantic invariant failure — duplicate ids, a dangling active page or frame, an
  auto-layout with no members, a cycle in auto-layout nesting.

MIME is always determined by **content**, never by a declared type or an extension.

## Saving durably

On Node (`src/tela/nodeIo.ts`), a save is: write a temporary file **in the same
directory**, `fsync` it, `rename` it over the target, then `fsync` the directory.
Every step matters — a temp file on another filesystem cannot be renamed atomically,
and without the first `fsync` a power loss can leave a valid directory entry pointing
at a zero-length file.

The document is serialized *before* the target is opened, so an invalid document
fails without the existing master ever being touched. **A failed save cannot destroy
the last valid version**, and the tests force a failure at each step to prove it.

The browser cannot offer `fsync`, so it offers the other half: the same writer, so a
file saved from the editor is byte-identical to one saved by the MCP server.

## localStorage is not authoritative

The four persisted zustand slices (`tela-workspace`, `tela-design`, `tela-assets`,
`tela-files`) are a **recoverable editing-session cache**. They exist so a reload
does not lose in-progress work. They are not a backup, they are not portable, and
they are not the source of truth. Anything that must survive belongs in a `.tela`
file.

## Versioning

`document.json` carries a `schemaVersion`. Migrations are explicit, ordered, and
recorded in the manifest by id.

A document from a **newer** schema version is rejected with a message telling the
user to update Pyrito Design. It is never best-effort parsed: opening a v2 file with a v1
reader and saving it would write back a v1 file with the v2 fields deleted — a
data-loss bug that looks like a successful save.

## Published schemas

`schemas/tela-document-v1.schema.json` and `schemas/tela-manifest-v1.schema.json` are
generated from the zod schemas and kept in sync by a test. Regenerate with:

```sh
TELA_WRITE_SCHEMAS=1 npm test
```

## Map of the code

| File | Role |
|---|---|
| `src/tela/canonicalJson.ts` | RFC 8785 serializer |
| `src/tela/sha256.ts` | Synchronous SHA-256, identical in Node and the browser |
| `src/tela/zip.ts` | Deterministic STORE writer, hardened reader |
| `src/tela/schema.ts` | v1 document and manifest schemas (strict throughout) |
| `src/tela/invariants.ts` | Semantic coherence checks |
| `src/tela/migrations.ts` | Ordered migrations, future-version rejection |
| `src/tela/contentRevision.ts` | Semantic revision |
| `src/tela/assets.ts` | Content addressing, packing and unpacking |
| `src/tela/mime.ts` | Content-type sniffing |
| `src/tela/bundle.ts` | `writeBundle` / `readBundle` |
| `src/tela/session.ts` | Store ⇄ document capture and apply |
| `src/tela/nodeIo.ts` | Atomic, durable saves (Node only) |
| `src/tela/browserIo.ts` | Open and save from the editor |
