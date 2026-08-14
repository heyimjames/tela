# Tela Design MCP server

A local **stdio** MCP server that gives an agent the full Tela authoring surface:
create and edit `.tela` designs, compose frames and layers, manage assets, fonts,
brand context and versions, and render or export finished artwork.

- Server name: `tela-design-mcp-server`
- Registered plugin/server id: `clickt-tela-design`
- Transport: local stdio only. **No network access of any kind.**

> The separately registered local `tela` server is Tela Wiki and is unrelated to
> this one. They do not share an identity, a process, or any state.

## Running it

```bash
npm ci
npm run build          # app + bridge build + compiled MCP server
node ./bin/tela-mcp.mjs
```

`npm run build` produces three artifacts:

| Script | Output | Purpose |
| --- | --- | --- |
| `build:app` | `dist/` | the interactive Vite application, unchanged |
| `build:bridge` | `dist-bridge/` | the same app built with a **relative base**, served to the private browser |
| `build:mcp` | `dist/mcp/tela-mcp.mjs` | the compiled server, ordinary ESM |

The launcher runs under plain `node`. There is no `tsx`, `ts-node`, `npx`, shell,
or TypeScript at runtime.

### Host configuration

Codex:

```json
{ "command": "node", "args": ["./bin/tela-mcp.mjs"], "cwd": "." }
```

Claude Code:

```json
{ "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/bin/tela-mcp.mjs"], "cwd": "${CLAUDE_PLUGIN_ROOT}" }
```

Both hosts execute the same launcher and see identical tool and resource schemas.

### Environment

| Variable | Meaning |
| --- | --- |
| `TELA_APPROVED_ROOT` | The directory every path is confined to. Defaults to `~/Library/Application Support/Clickt/AdStudio/tela` (macOS) or `%LOCALAPPDATA%\Clickt\AdStudio\tela` (Windows). |
| `TELA_BRIDGE_ROOT` | Location of the bundled application build. Defaults to `dist-bridge/` beside the compiled server. |
| `TELA_CHROMIUM_EXECUTABLE` | Path to the pinned Chromium shipped with the payload. Falls back to Playwright's own resolution. |
| `TELA_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error`. Default `info`. |

## Working model

Paths are **root-relative**; absolute paths are refused. A design is identified by
its path, which is also its session handle.

```
tela_open_design            → session_revision, disk_revision
tela_get_design_summary     → page and frame ids
tela_get_scene              → layer ids
tela_add_layers / …         → pass expected_session_revision, get the next one back
tela_render_preview         → look at it
tela_save_design            → pass expected_session_revision AND expected_disk_revision
```

Every mutation returns the next `session_revision`, so the value the next call
needs is always in the result you just received.

### Two revisions, two different questions

- **`session_revision`** — did anything change *in this process* since you looked?
  Required by every mutation. It is a monotonic counter.
- **`disk_revision`** — did the *file* change outside this process? Required by
  `tela_save_design` in addition to the session revision, and re-read from disk at
  save time rather than trusted from memory.

Neither implies the other, which is why both are required. A mismatch is refused
with an error naming the recovery step; re-read before retrying rather than
forcing the write.

### Nothing is deleted

Every `tela_archive_*` tool moves content into a managed trash at `.trash/` under
the approved root — whole designs as `.tela` files, excised pages/frames/layers as
JSON. Recovery is a file move.

## Tool surface

48 tools, all `tela_`-prefixed, each with strict Zod input **and** output schemas
and truthful `readOnlyHint` / `destructiveHint` / `idempotentHint` /
`openWorldHint` annotations. Read and list tools accept
`response_format: json | markdown`; lists paginate with a bounded `limit`, an
opaque `cursor`, `has_more`, and `total`.

| Group | Tools |
| --- | --- |
| Runtime & inspection | `get_status`, `get_capabilities`, `list_designs`, `get_design_summary`, `get_scene`, `validate_design`, `list_templates`, `list_layouts`, `list_assets`, `list_versions` |
| File lifecycle | `create_design`, `open_design`, `close_design`, `save_design`, `import_design`, `duplicate_design`, `archive_design` |
| Pages & frames | `add_page`, `update_page`, `reorder_pages`, `archive_page`, `add_frame`, `update_frame`, `duplicate_frame`, `reorder_frames`, `archive_frame`, `generate_format_variants` |
| Layers & structure | `add_layers`, `update_layers`, `duplicate_layers`, `reorder_layers`, `archive_layers`, `group_layers`, `ungroup_layers`, `set_auto_layout`, `apply_layout` |
| Assets, brand, versions, output | `import_asset`, `replace_asset`, `archive_asset`, `import_font`, `get_brand_context`, `set_brand_context`, `save_version`, `restore_version`, `render_preview`, `export_frames`, `open_editor`, `close_editor` |

Layer inputs cover all eight persisted types — background, text, image, svg,
shape, gradient, group, draw — and address layers by frame id and layer id.
**Nothing depends on editor selection state.**

There is deliberately **no** generic dispatch, eval, arbitrary-JavaScript, shell,
navigation, or URL-fetch tool. The editor's internal `window.tela.dispatch`
command bus stays behind the loopback server and is never exposed as a tool; a
test asserts this.

### Resources

`tela://status`, `tela://schema/portable/v1`, `tela://formats`, `tela://templates`,
`tela://layouts`.

Workflow prompts are **not** registered here — they live in the shared plugin
skill so Codex and Claude Code get the same orchestration from one source.

## Architecture

```
host (Codex / Claude Code)
   │  stdio, JSON-RPC only on stdout
   ▼
bin/tela-mcp.mjs → dist/mcp/tela-mcp.mjs
   │  serveStdio(() => buildServer())      ← factory is side-effect-free
   ├── authoring: pure ops on the canonical TelaDocument (no browser)
   │     per-source lock · session revision · disk revision · atomic write
   └── rendering only, lazily:
         private loopback server (127.0.0.1, OS port, random path token, CSP)
              ▼  serves the bundled production build — never Vite
         private Playwright Chromium
              ▼  page.evaluate(window.tela.dispatch)
         Tela renderer and export pipeline
```

**Authoring happens in Node, against the canonical document. The browser renders.**
The contract states canonical state lives on disk and the browser holds an editing
session only; doing mutations in Node rather than round-tripping each one through
the browser is what makes that true in practice, and it removes stale
active-frame copies, microtask-debounced write-back, and page-scoped frame lookup
from the authoring path entirely.

The browser is launched on the **first tool call that needs it**, never by
`buildServer()` — a modern client may build a disposable server just to read the
tool list, and launching Chromium to answer `tools/list` would be absurd. One
browser per process, a fresh context per bounded operation, cleanup in `finally`
including on cancellation.

### Security

- Approved-root confinement independent of MCP client roots; no `..`, no absolute
  or UNC paths, no symlink/junction/reparse traversal, no cross-device paths, no
  hardlinked write targets.
- Asset type decided by **sniffing content**, not extension. SVG is sanitized
  before it enters the document — scripts, event handlers, `foreignObject`,
  external references, DOCTYPE entities, and CSS `@import`/`url()` are refused
  rather than stripped.
- Fonts must be WOFF2 and carry an explicit licence string.
- Loopback server: OS-assigned port, per-process random path token, a matching
  request header, Host and Origin checks, strict CSP, and a route filter that
  aborts any request not aimed at its own origin.
- Errors are scrubbed of the approved root, home directory, and any remaining
  absolute path before they reach a client.
- Diagnostics are JSONL on **stderr**; stdout carries JSON-RPC only, enforced by
  a console guard installed at process start.

## Testing

```bash
npm run build
npx vitest run
```

| Suite | Covers |
| --- | --- |
| `tests/mcp/contract.test.ts` | tool surface, annotations, schemas, pagination, response formats, actionable errors, resources |
| `tests/mcp/stdio.test.ts` | spawned compiled artifact: legacy initialization, modern discovery, stdout purity, structured stderr, EOF and SIGTERM shutdown |
| `tests/mcp/authoring.test.ts` | every persisted layer type and an ABES fixture through create → open → mutate → save → reopen; revision gates; concurrency |
| `tests/mcp/security.test.ts` | path confinement, symlink refusal, SVG sanitization, content sniffing, no generic execution surface |
| `tests/mcp/render.test.ts` | real browser: PNG/JPG/WebP/SVG export, DPR, deterministic filenames, batching, progress, cancellation |

`render.test.ts` needs a launchable Chromium. It **skips with a warning** when
none is available rather than failing, because a missing browser is an
environment gap and a suite that goes red for that trains people to ignore red
suites. Point `TELA_CHROMIUM_EXECUTABLE` at the payload's pinned browser, or run
`npx playwright install chromium` during setup.

MCP Inspector smoke:

```bash
npx @modelcontextprotocol/inspector --cli node ./bin/tela-mcp.mjs --method tools/list
npx @modelcontextprotocol/inspector --cli node ./bin/tela-mcp.mjs --method resources/list
npx @modelcontextprotocol/inspector --cli node ./bin/tela-mcp.mjs --method tools/call --tool-name tela_get_status
```

## Provenance

The design and evaluation methodology follows Anthropic's **`mcp-builder`** skill:

- <https://github.com/anthropics/skills/tree/f6656c1256d5a8adfa37db9110046ef20bac644c/skills/mcp-builder>
- commit `f6656c1256d5a8adfa37db9110046ef20bac644c`
- licence **Apache-2.0**

It was used as **build-time guidance only** and is **not a dependency** of this
runtime — nothing from it is vendored or imported. The skill's pinned examples
use the older monolithic `@modelcontextprotocol/sdk`; this project deliberately
overrides them with the split v2 packages (`@modelcontextprotocol/server@2.0.0`,
`@modelcontextprotocol/client@2.0.0` for tests) on Node 22 with `zod@4.4.3` and
`playwright@1.61.1`. The same provenance is reported at runtime by
`tela_get_capabilities`.
