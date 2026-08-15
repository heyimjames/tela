# Vendored: `@performance-clickt/design-api-client@1.0.0`

This directory is a **verbatim copy** of the generated v1 API client frozen by CLI-516.
It is vendored rather than installed, and it is not edited here.

| | |
| --- | --- |
| Package | `@performance-clickt/design-api-client` |
| Version | `1.0.0` |
| Source repo | `performance-clickt/hivemind-design-server` |
| Source commit | `cbad2b00db66ce675e7f12a34df8665211afc5e9` (short `cbad2b0`) |
| Source path | `packages/api-client/` |
| Vendored on | 2026-08-15 (CLI-517) |

## Why vendored, and why the source rather than `dist/`

The package publishes to GitHub Packages, which would make `npm ci` in this repo
require a registry credential. `tela-design` ships inside the certified
`clickt-tela` MCP payload and its install must stay credential-free and
reproducible, so the client is vendored instead. This was ratified by the
coordinator for CLI-517.

Only the **committed source** is vendored. Upstream's `dist/` is gitignored, so
its bytes exist only on a machine that happened to run the package's build — they
cannot be hashed against anything. CLI-516's own lesson names this trap directly:

> A package resolved through its `exports` map to a gitignored `dist/` typechecks
> only on a machine that happens to have built it.

Vendoring the source and resolving it by alias means the same bytes are
typechecked, bundled and tested, and every one of them is verifiable against the
upstream commit.

## Resolution

The bare specifier `@performance-clickt/design-api-client` is aliased to
`vendor/design-api-client/src/index.ts` in three places, which must stay in
agreement:

- `tsconfig.json`, `tsconfig.app.json` and `tsconfig.tela-node.json` —
  `compilerOptions.paths`. All three: `tsconfig.tela-node.json` reaches
  `src/storage/` through its `tests/**/*.ts` include, so omitting it there leaves
  `npm run typecheck` red while `tsc -p tsconfig.app.json` is green.
- `vite.config.ts` — `resolve.alias`
- `vitest.config.ts` — `resolve.alias`

`eslint.config.js` ignores `vendor/`: this is generated code copied verbatim, and
lint-driven edits here would break the byte-for-byte provenance claim below.

## Integrity manifest

sha256 of every vendored file. Each hash equals the corresponding blob at the
source commit — verified at vendoring time with
`git show cbad2b0:packages/api-client/<path> | shasum -a 256`.

`src/workspace/__tests__/vendoredClient.test.ts` re-checks this table on every test run, so
an edit to a vendored file, or a version bump away from `1.0.0`, fails a test
instead of silently invalidating the provenance recorded here.

| sha256 | file |
| --- | --- |
| `b4b2b8262a24bc0a0dafcd4ca6a8ac8c3a849bbeee3f12f134292c3234d18f42` | `package.json` |
| `89ca7bd7c51ba7b9246e3d400f4cfafce448f7d3dccbd2d34215b5a4c0977f86` | `tsconfig.json` |
| `ec5ef6582ab3ff2d0566c7896fc678714dd584df9daea63cde851a42ffab67ee` | `README.md` |
| `87a1ff3f2973d76a98f4e7db2872b94f0a5ee2b345cdf1186a87d8e000880fc5` | `src/client.ts` |
| `3b87d6ad74ff7cc767cc0d7857ce1b63cd23b7fa23a076730de701a9973862ae` | `src/errors.ts` |
| `55e9ab277b19225cf5ccf1a9086aad43230c66ecf2530632f5ecb06adc4b1cec` | `src/index.ts` |
| `db1544c2cedd93701cb95fa93bd676222018831dbc0c9115a56d15f40778abcb` | `src/types.ts` |

## Updating

Do not hand-edit. To take a newer client: re-copy from the upstream commit,
re-run the hashes, and update both this file and the pinned commit above in one
change.
