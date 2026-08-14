# The release artifact

The Tela runtime ships as an immutable artifact that the Clickt plugin's setup
downloads, verifies, and installs. This document says what is in it, how to
check it, and why each rule is the way it is.

## What it contains

| Entry | What it is |
| --- | --- |
| `bin/tela-mcp.mjs` | The host-manifest entry point. Both Codex and Claude launch exactly this: `node ./bin/tela-mcp.mjs` |
| `dist/mcp/tela-mcp.mjs` | The compiled MCP server. Plain ESM — no TypeScript, no loader, no `npx` at runtime |
| `dist/mcp/tela-mcp.mjs.map` | Source map, **mappings only** — see below |
| `dist-bridge/` | The production Tela application the private loopback server serves to the private browser |
| `schemas/` | The portable `.tela` manifest and document JSON schemas |
| `package.json`, `package-lock.json` | The exact lockfile setup installs from, with lifecycle scripts disabled |
| `provenance.json` | Source commit, pinned toolchain, browser policy, methodology provenance |
| `sbom.json` | CycloneDX 1.5, derived from the shipped lockfile |
| `NOTICES` | Licence notices for the project and every locked package |
| `LICENSE` | The project licence |
| `SHA256SUMS` | `sha256sum`-compatible manifest covering every other file |

**Browser binaries are not included.** Setup downloads the exact
Playwright-matched Chromium after the operator approves the plan hash. An
artifact that carried a browser would bypass that approval, and the runtime
itself never downloads anything.

## Verifying it

```bash
node scripts/verify-release.mjs <artifact-directory>
```

The verifier **never executes any part of the artifact**: it does not import a
file from it, spawn `node` against one, launch a browser, or run an install. It
opens files, hashes bytes, and parses JSON. That constraint is what makes it
usable on an artifact you do not yet trust, which is the only interesting case.

It checks that every file matches `SHA256SUMS` with no extras and no omissions,
that the recorded source commit is real and is *actually present in the compiled
output*, that the lockfile covers every declared dependency, that the SBOM is the
one this lockfile produces, and that no browser or native binaries are bundled.

`SHA256SUMS` is also readable by coreutils, for a reviewer who would rather not
trust this repository's own verifier:

```bash
cd <artifact-directory> && sha256sum -c SHA256SUMS
```

## Source maps ship mappings, not sources

A source map does two separable things. The **mappings** translate a stack frame
in the compiled bundle back to a file, line, and column — that is what makes a
production crash report readable. **`sourcesContent`** additionally inlines the
full text of every source file.

In a distributed artifact those are very different. The mappings are
operationally valuable and disclose structure. `sourcesContent` publishes the
entire TypeScript codebase to everyone who downloads the release, inside a file
that reads as build metadata — a distribution decision that gets made by a
bundler default rather than by a person.

So the release build sets `TELA_SOURCEMAP_SOURCES_CONTENT=false` and keeps the
mappings. Ordinary `npm run build` is unaffected and still embeds sources for
local debugging; in a checkout the map's relative `sources` paths resolve to the
real files anyway.

The verifier enforces this on the artifact (`sourcemaps.no_source_text`),
structurally *and* by scanning the raw map text for source constructs — so
source smuggled in under some other key is caught too, and the guarantee cannot
regress silently if a bundler default changes.

## The source commit stamp

`src/tela/producer.ts` carries an all-zero `SOURCE_COMMIT` during development,
and that constant is written into the manifest of every `.tela` bundle the
runtime produces. A release built from the development constant would therefore
emit files claiming to originate from commit `000…0` forever — provenance that
exists but means nothing, which is worse than none, because it looks checked.

So `scripts/build-release.mjs` rewrites that one literal, builds, and restores
the file, verifying the restore byte-for-byte in a `finally`. The verifier then
confirms the stamp reached the compiled output rather than only the metadata.

## Reproducibility

```bash
npm run release:reproduce
```

Builds the same commit twice into two different directories and compares the
manifest digest — one hash over the manifest that covers every other byte. The
output directory differs deliberately between the runs, so a build that leaked
its own path into the artifact fails here.

The rules that make this hold are the ones the `.tela` format already
established: canonical (sorted-key) JSON, sorted manifest and SBOM entries, a
store-only archive with fixed 1980 timestamps, and no timestamps, hostnames,
usernames, or absolute paths anywhere in the artifact. Store-only rather than
deflate is deliberate — deflate output depends on the zlib build doing the
compressing, and an artifact whose hash depends on the compressor is not
reproducible.

The release build refuses a dirty working tree, because an artifact that cannot
be rebuilt from the commit it records is misdescribed in the most ordinary way
possible. `--allow-dirty` exists for throwaway local builds and must not be
published.
