# Workspace-mode deployment contract

This document is the copy, in this repo, of the one deployment fact the compiled
app cannot discover for itself: **where the hosted API is mounted**. It exists
because `src/workspace/endpoint.ts` bakes that path into the artifact at build
time, and a build cannot ask the reverse proxy what it does.

`src/workspace/__tests__/deploymentContract.test.ts` parses the mount out of the
Caddy block below and asserts the compiled default equals it. Edit one without
the other and that test fails — which is the point. This file is not decoration;
it is one half of a pinned pair.

## The mount

The production site (`design.gethivemind.co`) is served by Caddy. The app and the
API share one origin — the session cookie is first-party, so there is no CORS
preflight and no `SameSite=None` — but they do **not** share a path. `/api/*` is
proxied to the API container with the prefix stripped, and everything else is the
single-page app:

```caddyfile
design.gethivemind.co {
    # handle_path is the stripping form of handle, so the backend sees /healthz
    # and /v1/... exactly as it does in every test.
    handle_path /api/* {
        reverse_proxy hmd-api:3000
    }

    handle {
        # the SPA: root / try_files / file_server
    }
}
```

Authored by CLI-519; the operator runbook that installs it lives in the
`hivemind-design-server` repo at `deploy/production/README.md`. If that block ever
moves the API to a different prefix, this file and the compiled default move with
it, in the same change.

## Build flags

| Flag | Value in a hosted build | Meaning |
| --- | --- | --- |
| `VITE_WORKSPACE_MODE` | `true` | Documents live in the hosted workspace instead of this browser. Unset (or empty) is local mode, which is what the certified offline payload ships as. |
| `VITE_WORKSPACE_API_BASE_URL` | unset | Override for a dev server proxied onto another port, or a harness that mounts the API elsewhere. **Unset is the supported production shape**: the compiled default is the mount above. Empty and whitespace-only are read as unset, not as "the origin root" — a harness that means the root passes `/` explicitly. |

So a production build is:

```bash
VITE_WORKSPACE_MODE=true npm run build
```

## Why the pin exists (CLI-559)

The compiled default used to be `/`, with a comment claiming relative *was* the
deployment. It was not, and nothing anywhere went red:

1. the app POSTed a login to `/v1/auth/login` at the origin root;
2. no `handle_path` matched, so the SPA fallback answered `index.html` — with
   **HTTP 200**;
3. the generated client expects `200` from login, so it raised nothing;
4. `response.json()` threw a `SyntaxError`, which is not an `ApiError`, so the
   login screen's catch-all rendered *"Email or password is incorrect."*

A correct password looked wrong, and the server logs showed a healthy 200. Two
things came out of it. This document plus the contract test, so the default
cannot drift back silently. And `src/workspace/responseShape.ts`, which refuses a
response that is not shaped like this API's *at the fetch seam* — every endpoint,
not just login — so a misrouted call can never again wear the costume of a
rejected credential.

The production redeploy of 2026-08-15 already carries `/api` baked in: it was
built with `VITE_WORKSPACE_MODE=true VITE_WORKSPACE_API_BASE_URL=/api` as the
immediate fix. With the default corrected, that explicit flag is
belt-and-suspenders rather than the thing holding the deployment up.
