# Evaluations

Ten questions asked of the Tela Design MCP server over immutable fixture
designs, in the style of Anthropic's `mcp-builder` skill (commit
`f6656c1256d5a8adfa37db9110046ef20bac644c`, Apache-2.0 — build-time methodology
only, not a dependency of anything here).

```bash
npm run build        # the runner drives the compiled artifact, not the sources
npm run test:evals   # or: npx vitest run tests/mcp/evaluations.test.ts
```

## Why this exists alongside Anthropic's harness

Anthropic's harness answers "how does Claude do with this server". That is worth
knowing and it is explicitly supplemental. It cannot answer "is the server
correct", because when a harness run fails you cannot tell from inside whether
the server, the host, or the harness was wrong.

So this runner spawns the compiled artifact exactly as a host manifest does —
`node ./bin/tela-mcp.mjs` — and drives it with the official MCP client SDK over
stdio. No Claude, no Codex, no skill, no test framework in the transport path.
A failure here is attributable to the server.

## The properties, and how each is enforced rather than asserted

| Property | How it is enforced |
| --- | --- |
| Independent | A fresh server process and a fresh copy of the fixtures per question |
| Read-only | Every call is checked against `READ_ONLY_TOOLS` *before* it is issued |
| Non-destructive | Fixture digests re-verified against `DIGESTS.json` after the run |
| Multi-tool | Distinct tools counted; fewer than two fails the question |
| Realistic | Questions a person actually asks of a campaign library mid-production |
| Stable | Fixtures are committed and hash-pinned; answers can only move if the server does |
| One verifiable answer | Every expected value is a scalar, compared exactly |

## Fixtures

`fixtures/designs/*.tela` are committed binaries with their SHA-256 digests
pinned in `fixtures/DIGESTS.json`. They were produced once by
`fixtures/generate.mjs`, which is **not** part of a run: fixtures regenerated on
every run would measure the generator and the server agreeing with each other,
which they will do even when both are wrong.

Three designs, chosen to make the questions require composition rather than a
single lookup:

- `spring-launch.tela` — a live campaign: an approved feed frame, two generated
  format variants, a second page holding a banner, two saved versions, brand
  context, one imported asset.
- `hiring-q3.tela` — a smaller square brief with a logo asset and brand voice.
- `legacy-promo.tela` — a minimal old file; the control.

Regenerating them deliberately (a format migration, say) means re-running the
generator and re-deriving every expected answer in `questions.mjs`. That friction
is the point.

## Adding a question

Add it to `questions.mjs` with an `expected` scalar, a `why` that says what would
break if the question failed, and a `resolve` that uses at least two tools. If it
needs a tool outside `READ_ONLY_TOOLS`, it is not an evaluation question — it is
an acceptance test, and it belongs in `tests/mcp/authoring.test.ts`.
