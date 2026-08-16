# MCP payload non-interference

The application, then named Tela, ships **inside** the certified `clickt-tela` MCP payload. Milestone 2
("HiveMind | Design Workspaces") added a storage-adapter seam, workspace-mode UX, a vendored
API client and a dormant AI panel to that application — all gated off by default. This
document records how we prove those additions did not disturb the payload, and what
"undisturbed" is defined to mean.

Issue: **CLI-520**, baseline re-recorded on **CLI-561**, **PYR-11**, and **PYR-17**. Harness:
`scripts/verify-payload-noninterference.mjs`, `scripts/lib/payload-noninterference.mjs`.
Baseline record: `tests/baselines/mcp-payload-a269442.json`.
CI: `.github/workflows/payload-noninterference.yml`.

## The baseline

| | |
|---|---|
| Baseline commit | `a2694423f66fad8f716e88b5253a60221b0054ca` |
| Why this commit | the corrected Pyrito Design v0.1.1 release state: Pyrito product identity and clean-break runtime root, with the existing `.tela` producer family and unrelated Tela Wiki identity preserved |
| Baseline archive sha256 | `2068988a28f48c839bc0cbb9f288ff6f4a30da3bb34c2c427686f6c78532a044` |
| Baseline manifest sha256 | `fbd9d51193701432204439a3a4cb533d8f7f66bb58bc7d5e9ad7d0d35373215b` |
| Files in the payload | 136 (135 manifested + `SHA256SUMS`) |

The baseline is **committed**, not re-derived. `scripts/record-payload-baseline.mjs` produces
the record from a release artifact built at the baseline commit; CI compares against the
record rather than rebuilding an old commit on two operating systems every pull request.

Note the record is necessarily committed *after* the commit it describes: the checker refuses
a run where `baseline_commit` equals the commit under test ("this run would compare a payload
with itself"), so a record taken at `X` lands in `X+1`. That refusal is deliberate and was not
weakened to make the re-record convenient.

### Why the baseline moved (CLI-561)

The original baseline was `df44d15`, chosen as the last pre-Milestone-2 state so that the
gate read "Milestone 2's additions did not disturb the payload". **CLI-561 changed the
certified payload on purpose**, and the baseline was re-recorded rather than the check
weakened.

The change is a rebrand. `src/tela/session.ts` imports `BRAND_PALETTE` to answer
`tela_set_brand_context`, so the palette and the `BRAND` config compile into
`dist/mcp/tela-mcp.mjs`; renaming the brand necessarily renames what the MCP server reports.
The delta was bounded before it was accepted — a line diff of the two bundles is **68 lines,
all of them brand data** (palette labels and hexes, `productName`, `socialHandle`,
`displayName`, `productDescription`), with no change to logic, tool schemas, transport, or
dependencies, and a size delta of +166 bytes. Every palette *key* is unchanged, and
`session.ts` still exposes every entry, so no `.tela` document and no MCP caller loses a
colour it addresses by name.

Leaving the old baseline in place was not a neutral option: `df44d15` is itself a CLI-508
commit, so the retired record has `"HiveMind | Design"` and `"Hive 50"` baked into it. A gate
comparing against it would have gone on certifying the retired identity as the correct one.

Two things were explicitly **not** done. `APP_CHROME_PATTERNS` was not extended to absorb the
two new `dist-bridge/assets/pyrito-design-register-*.svg` files — teaching the instrument a
new exception is the failure mode this document's own "test-of-the-test" section exists to
prevent, and under the new baseline those assets sit in the byte-identical set where they
belong. And the self-comparison refusal above was not relaxed.

The previous record (`tests/baselines/mcp-payload-df44d15.json`, manifest `d75854c7…`,
136 files) is removed rather than kept alongside: two baselines invite a comparison against
whichever one passes. It remains reviewable in this file's git history.

### Why the baseline moved a second time (PYR-10)

The `bb59912` record certified a payload that still contained `d20-flat-bold.svg`,
`d20-bold-16.png`, and `favicon.ico` — the bold D20 *redraw* the brand kit forbids
(`identity.fixed-mark-colors`), plus the `.ico` whose 16px entry is that redraw. They were
unlinked from `index.html` but `public/` is copied verbatim into the build, so the forbidden
art shipped inside the certified payload and was addressable by URL. Deleting them
(`a92383c`) is the second deliberate change of certified state on this issue, and the
baseline was re-recorded at it by the same procedure: built at `a92383c`, recorded from that
artifact, committed at the following commit because the checker refuses to compare a payload
with itself. **No detector was modified** — `verify-payload-noninterference.mjs` changed by
one line (the default baseline path) and `APP_CHROME_PATTERNS` was again left alone.

The record went from 138 manifested files to 135: the three deleted assets, exactly. One
further difference is expected and permitted — the hashed app bundle
(`dist-bridge/assets/index-*.js`) is renamed, because `2bed73a` changed `cardGradient.ts`
and `index.css` after the `bb59912` record was taken. That is the invariant working as
designed rather than an anomaly: the application may change, the certified MCP payload may
not, and the app bundle lives in the chrome set for precisely this reason. Re-recording here
folds that already-permitted drift into the certified state.

### Why the baseline moved for v0.1.1 (PYR-11)

The release cut intentionally changes certified payload identity rather than application
chrome alone. It advances the package, MCP handshake, and document-producer version to
`0.1.1`, records `Pyrito-ai/pyrito-design` as repository provenance, moves the default
approved root from the retired Clickt AdStudio directory to `Pyrito/Design` under the
operator's PYR-17 clean-break decision, and replaces current user-facing Tela labels with
Pyrito Design. The `.tela` extension, `tela_*` tools, `tela-mcp` launcher, schema URLs,
registered external id, `TELA_*` environment variables, and the existing `tela-design`
producer-family name remain unchanged compatibility contracts. Existing data is never
inspected, copied, moved, rewritten, or deleted automatically; the manual move is documented.

Because `package.json`, `package-lock.json`, the JSON schemas, and compiled MCP server all
change deliberately, treating the previous record as authoritative would reject the release
for the exact identity changes PYR-11 requires. The new record was generated—not
hand-edited—from the verified artifact built at `a269442`; the previous baseline remains in
Git history and is removed from the working tree so there is only one active trust anchor.

## What the invariant is, and why it is not whole-artifact hash equality

CLI-520 originally required the current artifact's sha256 to **equal** the baseline's. That
is unmeetable, and not because of Milestone 2. `scripts/build-release.mjs` stamps the release
commit into the compiled output (the `TELA_SOURCE_COMMIT` define) and writes it into
`provenance.json`, `sbom.json` and `NOTICES`, by design — an unstamped release would make
every `.tela` bundle it ever writes claim provenance from commit `000…0`. **Any two distinct
commits therefore produce distinct artifacts, even across an empty source diff.**

Asserting the impossible does not make a check strict; it forces whoever inherits it to
weaken it until it passes, which is how an evidence harness starts minting false records.
The criterion was amended by coordinator ruling on CLI-520 to a **surface-scoped invariant**:

1. **Byte-identical, no normalisation of any kind** — `bin/`, `schemas/`, `package-lock.json`,
   and every other payload file including the bridge's fonts and images.
2. **Stamp-normalised** — `dist/mcp/tela-mcp.mjs`, `provenance.json`, `sbom.json`, `NOTICES`
   may differ *only* at occurrences of the pipeline's own 40-character commit stamp.
3. **Enumerated expected delta** — the application chrome (`dist-bridge/index.html` and the
   content-hashed `dist-bridge/assets/index-*.js|css` entry chunks). This is where the
   gated-off Milestone 2 code lives.
4. **Structural** — no payload file may appear or disappear, and the chrome may not grow a
   second entry chunk. Either fails the check rather than being absorbed.
5. **`package.json`** — every key the payload's install and launch depend on is pinned;
   only `scripts` may differ, and the difference is reported.

### Why the stamp normalisation cannot hide anything

The stamped files are **not** compared after erasing everything hex-shaped. A
`[0-9a-f]{40}` regex would also erase a moved asset hash or a lockfile integrity value —
exactly the drift this check exists to catch. Instead the baseline record pins, per file:
its byte length, the exact offsets at which the baseline commit occurred, and the sha256 of
the file with *only* those ranges blanked. A current file passes only when it is the same
length, its own commit occurs at exactly those offsets and nowhere else, and the identically
blanked bytes hash to the recorded value. The mask is bounded by the record, so a byte that
moved anywhere else changes the normalised hash and fails.

## Result (CLI-520, against the retired `df44d15` baseline)

Kept as the historical record of what the gate proved about Milestone 2. The numbers below
are measurements against the **previous** baseline and are not re-derivable from the current
record; the section after it carries the current state.

Comparison of the Milestone 2 integration state against the baseline record:

```
payload-noninterference: baseline commit  df44d15b0c18cf98c2ef72050c42552555ad633e  (136 files)
payload-noninterference: current  commit  c5f2a89fcf782871f6d3d85e82eda3bc6a484998  (136 files)
payload-noninterference: RESULT identical=128/136 byte-for-byte  stamped=4  app-chrome=3  metadata=1
payload-noninterference: PASS: the certified MCP payload is unchanged; the delta is confined
                              to the enumerated application chrome.
```

**128 of 136 files are byte-identical.** The complete delta:

| Path | Class | Difference |
|---|---|---|
| `dist/mcp/tela-mcp.mjs` | stamped | identical apart from 1 commit-stamp site at offset 28025; both builds 302,494 bytes |
| `provenance.json` | stamped | 1 stamp site at offset 1732 |
| `sbom.json` | stamped | 1 stamp site at offset 397298 |
| `NOTICES` | stamped | 1 stamp site at offset 26 |
| `dist-bridge/assets/index-*.js` | app chrome | 1,796,816 → 1,825,007 bytes (+28,191) — gated-off Milestone 2 code |
| `dist-bridge/assets/index-*.css` | app chrome | 93,292 → 94,459 bytes (+1,167) |
| `dist-bridge/index.html` | app chrome | the two content-hashed asset filenames it references |
| `package.json` | metadata | `scripts.test:network` added (`playwright test`, CLI-528); inert inside the payload — the launcher runs no script |

Byte-identical, with no normalisation, on the certified surfaces:

| Path | sha256 |
|---|---|
| `bin/tela-mcp.mjs` | `a5aeb462aad2dfb0421b74712d40e634727d6b16e0b9914c063ffc8d543628ce` |
| `schemas/tela-document-v1.schema.json` | `57680b07e2b22d614e591cbfc1f370c85b1d33443815fe984be2afea34fc1cc6` |
| `schemas/tela-manifest-v1.schema.json` | `4e9c04a3e49cb95d8c6427d7f3f86f5cc842da27e77efa5be40bf141eb8a0c96` |
| `package-lock.json` | `1817e5a123fb65ea18ae360bf44c45929b7247fcdff99bd9b5ba9f4c90a6afff` |

…plus 124 further payload files (fonts, avatars, bridge assets).

## Determinism

Three independent clean builds at `c5f2a89`, the third and second into different temporary
directories (so a build that leaked its own output path would fail):

| Build | manifest sha256 | archive sha256 |
|---|---|---|
| 1 — `npm run release:build` | `9cd92ecbf0d7167f6f9935a434e3efaf7281c4633fda2c10779958536ce6cbf4` | `5067fc4648df265d717e1583fc241629f07510f37415210b9d255895f6baf9fd` |
| 2 — `npm run release:reproduce` (build-a) | `9cd92ecbf0d7167f6f9935a434e3efaf7281c4633fda2c10779958536ce6cbf4` | `5067fc4648df265d717e1583fc241629f07510f37415210b9d255895f6baf9fd` |
| 3 — `npm run release:reproduce` (build-b) | `9cd92ecbf0d7167f6f9935a434e3efaf7281c4633fda2c10779958536ce6cbf4` | `5067fc4648df265d717e1583fc241629f07510f37415210b9d255895f6baf9fd` |

`release:reproduce` also verified both artifacts without executing them
(`manifest.digests — 136 files match SHA256SUMS`, `sbom.matches_lock — 612 components`).

## Offline proof

The payload is copied out of the repository, installed from its own lockfile
(`npm ci --omit=dev --ignore-scripts`) and launched — then launched again with the network
denied. The denial is itself proved, in the same denied context, immediately before the
payload runs (`scripts/assert-network-denied.mjs`): it *attempts* outbound TCP and DNS and
fails the job if either succeeds. Without that control, a wrapper that silently stopped
denying anything would leave every offline assertion green and meaningless.

- **Linux** (`ubuntu-latest`): `sudo unshare --net`, with loopback brought up — the private
  bridge talks to itself, so denying loopback would test the harness rather than the contract.
- **macOS** (`macos-latest`): `sandbox-exec` with `(version 1) (allow default) (deny network*)`,
  which is stricter still — loopback is denied there too.

Measured locally on macOS:

```
network-denied: ok: 1.1.1.1:443 unreachable — refused at the OS level (EPERM)
network-denied: ok: 8.8.8.8:53 unreachable — refused at the OS level (EPERM)
network-denied: ok: DNS resolution fails — ENOTFOUND
network-denied: PASS: outbound TCP and DNS are both denied
payload-launch: initialize ok: tela-design-mcp-server 0.1.0, protocol 2025-06-18
payload-launch: tools/list ok: 48 tools
payload-launch: resources/list ok: 5 resources
payload-launch: tools/call tela_get_status ok: server_name=tela-design-mcp-server
payload-launch: PASS: the installed payload starts and serves its MCP surface
```

A finer-grained macOS profile was tried first and **measured to be wrong**: allowing
`(remote unix-socket)` re-opened DNS through mDNSResponder, so a "network-denied" run still
resolved names. It is recorded here because the failure mode is invisible without the control.

## Suites run

| Suite | File | Result |
|---|---|---|
| Release determinism / canonical output / checksum manifest / deterministic archive | `tests/release/release.test.ts` | 15 passed |
| Browser-bridge render and export | `tests/mcp/render.test.ts` | 16 passed, against the pinned Chromium (`chromium-1228`) — not skipped |
| Payload non-interference analyser (negative controls) | `tests/release/payloadNonInterference.test.ts` | 25 passed |
| Zero-network runtime gate | `tests/network/zero-network.spec.ts` | 3 passed (`external_requests=0`, recorder self-test classified its own 6 deliberate calls) |
| Full suite | `npm test` | 40 files, 523 tests passed |

## The baseline record is checked against itself

The record is the trust anchor: every comparison is made against it rather than against a
rebuilt months-old commit, so a record edited to match a drifted payload would launder the
change this whole document exists to catch. `recorded_from.artifact_manifest_sha256` is the
digest of the baseline artifact's own `SHA256SUMS` — the value the baseline release build
printed (`303f6b21…`). Because `SHA256SUMS` is a pure function of the per-file hashes, the
checker **recomputes that digest from the record's own `files` map** and refuses to compare
anything if it does not match. Editing any one of the 135 recorded hashes breaks it.

Residual, and stated rather than papered over: the four `stamped` entries (offsets and
normalised hashes) cannot be reconstructed from anything else available at check time, so
they remain a trust anchor established when the record was generated. They are reviewable in
the record file's git history, and `tests/release/payloadNonInterference.test.ts` pins the
baseline commit and manifest digest absolutely so a wholesale record swap fails a test.

## Test-of-the-test

Every clause was mutation-proofed against a copy of the built payload. All seven went red:

| Mutation | Result |
|---|---|
| Flip one byte in `schemas/tela-document-v1.schema.json` | FAILED — `"…" moved: baseline 57680b07…, current b1b7f059…` (exit 1) |
| Flip one byte in `bin/tela-mcp.mjs` | FAILED — hash moved (exit 1) |
| Flip one byte in `dist/mcp/tela-mcp.mjs` **outside** the stamp | FAILED — `bytes outside the commit stamp moved` (exit 1) |
| Add `dist/mcp/extra-payload-file.mjs` | FAILED — `payload shape changed: … 0x in the baseline and 1x now` (exit 1) |
| Add a dependency to the payload `package.json` | FAILED — `pinned key "dependencies" changed` (exit 1) |
| Edit the baseline record to match a drifted `schemas/` hash | FAILED — `BASELINE RECORD REJECTED — nothing was compared`; `the record's file hashes do not reconstruct its recorded manifest digest` (exit 2) |
| Weaken the analyser to a hex-erasing regex | FAILED — `SELF-TEST FAILED — the comparison cannot be trusted, nothing was judged` (exit 2), before any payload was examined |

The instrument that proves the network is denied was given the same treatment: run
**without** a sandbox, `scripts/assert-network-denied.mjs` reports
`FAILED — 1.1.1.1:443 — the connection SUCCEEDED; this environment is NOT network-denied`
and exits 1. A denial check that cannot report a non-denied environment would make every
offline claim in this document worthless.

The analyser additionally runs its **own** self-test on every invocation, before it is
allowed to judge anything: it re-proves that it rejects non-stamp drift, a stamp site that
appeared or vanished, a length change, a file with no stamp, and — the load-bearing one — a
40-hex run that is not the build commit. A hex-erasing implementation passes that last input,
which is why the offsets are pinned. `tests/release/payloadNonInterference.test.ts` asserts
the self-test passes against the real implementation *and* demonstrates the permissive
implementation it is designed to catch.

## CI

`.github/workflows/payload-noninterference.yml`, on `ubuntu-latest` and `macos-latest`
(`fail-fast: false`, so a failure on one is never hidden by the other). Each job builds the
payload, runs the comparison against the committed baseline, installs the artifact outside
the checkout as a consumer would, launches it, and launches it again with the network denied.

The launch step is not a duplicate of `npm test`: a green source-tree suite is not evidence
that the shipped artifact starts on another platform. v0.3 r2 shipped a bare-path dynamic
`import()` that worked on every developer machine and failed to launch on every Windows host
while all local runs stayed green.

## CI evidence

Final run on the CLI-520 pull request (#11), commit `68448fb` — the last commit that changes
harness behaviour (anything after it is documentation only). These URLs replace the earlier
run's rather than sitting alongside them:

| Job | Result | Run |
|---|---|---|
| `payload non-interference (ubuntu-latest)` | pass | https://github.com/performance-clickt/tela-design/actions/runs/31876897178/job/94993870539 |
| `payload non-interference (macos-latest)` | pass | https://github.com/performance-clickt/tela-design/actions/runs/31876897178/job/94993870566 |
| `build`, `zero-network probe` | pass | https://github.com/performance-clickt/tela-design/actions/runs/31876897184 |
| `test-windows`, `test-macos` | pass | https://github.com/performance-clickt/tela-design/actions/runs/31876897234 |

Both payload jobs printed their own evidence rather than merely going green — the numbers
below are read from the logs, not restated from a local run:

```
ubuntu-latest  payload-noninterference: baseline record self-consistent: 136 file hashes reconstruct manifest digest d75854c7…
ubuntu-latest  payload-noninterference: RESULT identical=128/136 byte-for-byte  stamped=4  app-chrome=3  metadata=1
ubuntu-latest  payload-launch: tools/list ok: 48 tools          (node v22.23.2 on linux, /home/runner/work/_temp/installed)
ubuntu-latest  network-denied: ok: DNS resolution fails — EAI_AGAIN
macos-latest   payload-noninterference: baseline record self-consistent: 136 file hashes reconstruct manifest digest d75854c7…
macos-latest   payload-noninterference: RESULT identical=128/136 byte-for-byte  stamped=4  app-chrome=3  metadata=1
macos-latest   payload-launch: tools/list ok: 48 tools          (node v22.23.1 on darwin, /Users/runner/work/_temp/installed)
macos-latest   network-denied: ok: DNS resolution fails — ENOTFOUND
```

Note the two platforms deny the network by different mechanisms and report different errno
values (`EAI_AGAIN`/`ENETUNREACH` from an empty namespace routing table, `ENOTFOUND`/`EPERM`
from the macOS sandbox). That difference is the evidence that each platform's denial is real
and locally enforced, rather than one shared wrapper being trusted twice.

### Unrelated failure seen on an earlier run

`test-macos` in the **Windows/macOS Determinism** workflow failed once on this PR:
`src/ai/__tests__/entryPoints.test.ts > … > local mode` timed out at vitest's 5000 ms default
(7565 ms observed). It passed on re-run, `main` is green across its last eight runs, and the
same test failed once on CLI-517's own PR before passing. In isolation it completes in
0.7–1.0 s locally — the cost only appears under full-suite contention, so this is a
latent timing fragility in the CLI-517 module graph, not a defect introduced here. Filed as **CLI-546** rather than patched in this lane.
