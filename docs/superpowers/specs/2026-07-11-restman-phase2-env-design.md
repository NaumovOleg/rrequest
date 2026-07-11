# restman — Phase 2 (Environment Manager) Design

**Date:** 2026-07-11
**Status:** Approved (design), pending implementation plan
**Scope:** Phase 2 only — environments and `{{var}}` substitution. Builds on Phase 1.

## Overview

Phase 2 adds environments to restman: named sets of variables that the user can
switch between, with `{{var}}` placeholders in requests resolved against the
active environment at send time. This matches Postman's environment dropdown +
environment editor.

Phase 1 (local core REST client) is complete. This document specs Phase 2 only.
Later phases remain: 3 (import/export + file upload), 4 (scripts/hooks), 5
(WebSockets), 6 (backend + auth/sync).

## Goals

- Create/edit/delete environments, each a list of key/value variables.
- Select one active environment (or "No Environment"), persisted across restarts.
- `{{var}}` placeholders in a request's URL, query params, headers, and body are
  resolved against the active environment's enabled variables when the request
  is sent.
- The saved/history copy of a request keeps the raw `{{var}}` text — only the
  outgoing HTTP call is resolved.

## Non-goals (Phase 2)

- Secret/masked variable type (plain key/value/enabled only).
- Global variables, collection variables, dynamic variables (`{{$guid}}`), scripts.
- Import/export of environments (Phase 3, alongside collection import/export).
- Editing which environment a request "belongs to" — substitution always uses the
  single globally-active environment.

## Decisions

- **Substitution location:** in the extension host, at send time, across all
  fields. The webview sends the raw `RestRequest`; the host resolves `{{var}}`
  just before building the HTTP call. Single, testable place; saved requests stay
  raw.
- **Unresolved placeholders:** left as literal text (e.g. `{{missing}}` is sent
  as-is), matching Postman. Not replaced with empty string.
- **Active environment:** stored as an id in `context.globalState`
  (`restman.activeEnvId`), global and persistent. `null` = No Environment.
- **Variable model:** reuses the existing `KeyValue` type (`key`/`value`/`enabled`).
  Disabled variables are ignored during substitution.

## Data model

```ts
// shared/types.ts (additions)
type Environment = {
  id: string
  name: string
  variables: KeyValue[]   // KeyValue = { key; value; enabled } already exists
}
```

The active environment id is not part of any Environment file; it lives in
`globalState`.

## Architecture

Same two-process split as Phase 1. New pieces:

### Extension host

- **`interpolate.ts`** (new, pure) — `interpolate(text: string, vars: KeyValue[]): string`.
  Replaces `{{key}}` (and `{{ key }}` with surrounding whitespace, trimmed) with
  the value of the matching enabled variable. Unknown keys are left literal.
  Only enabled, non-empty-key variables participate.
- **`environment-store.ts`** (new) — `EnvironmentStore`, mirroring `CollectionStore`:
  `${baseDir}/environments/<id>.json`, atomic writes, corrupt-file skip.
  - `constructor(baseDir: string)`
  - `list(): Promise<Environment[]>`
  - `createEnvironment(name): Promise<Environment>`
  - `saveEnvironment(env: Environment): Promise<Environment>` (upsert by id)
  - `deleteEnvironment(id: string): Promise<void>`
- **`http-client.ts`** (modified) — `sendRequest(req, opts)` gains
  `opts.vars?: KeyValue[]`. Before building the URL/headers/body it runs
  `interpolate` over: `req.url`; each enabled param's key and value; each header's
  key and value; raw body text; each urlencoded item's key and value. When `vars`
  is absent or empty, behavior is identical to Phase 1.
- **`messaging.ts`** (modified) — the router gains an `environments: EnvironmentStore`
  dep and access to `globalState` (via two accessor callbacks
  `getActiveEnvId()`/`setActiveEnvId(id)`). On `sendRequest`, the router loads the
  active environment's variables and passes them to `sendRequest`. New routes for
  the environment messages below.
- **`panel.ts`** (modified) — constructs the `EnvironmentStore` (globalStorage) and
  wires the active-env accessors to `context.globalState`.

### Message protocol (additions)

```ts
// webview -> host (WebviewMessage)
| { type: 'loadEnvironments' }
| { type: 'createEnvironment'; name: string }
| { type: 'saveEnvironment'; environment: Environment }
| { type: 'deleteEnvironment'; id: string }
| { type: 'setActiveEnv'; id: string | null }

// host -> webview (HostMessage)
| { type: 'environments'; environments: Environment[]; activeId: string | null }
```

Each mutating environment route responds with a fresh `environments` message
(the full list + current activeId), the same pattern collections use with `tree`.

### Webview

- **`store.ts`** (modified) — add `environments: Environment[]`, `activeEnvId: string | null`,
  actions `setEnvironments(list)`, `setActiveEnvId(id)`; include both in `__reset`.
- **`ipc`/`App.tsx`** (modified) — App handles the `environments` HostMessage
  (→ setEnvironments + setActiveEnvId) and posts `loadEnvironments` on mount.
- **Env dropdown** (new, in the top bar) — a `<select>` listing "No Environment"
  (value `""` → null) plus each environment; changing it posts
  `{ type:'setActiveEnv', id }`.
- **Environments view** (new, in the Sidebar) — list environments; create/delete;
  a variable editor (reusing the KeyValue table pattern from RequestPanel) that
  posts `saveEnvironment` with the edited environment.

## Data flow (send with active environment)

```
1. User picks an environment in the top-bar dropdown -> setActiveEnv -> host
   updates globalState -> host returns environments{activeId}.
2. User clicks Send. Webview posts the RAW RestRequest (still contains {{var}}).
3. Router: read activeEnvId from globalState -> load that Environment from
   EnvironmentStore -> pass env.variables to sendRequest(req, { vars }).
4. http-client interpolates {{var}} into url/params/headers/body, then fetches.
5. Response returns as in Phase 1. The request stored in history stays raw.
```

## Error handling & edge cases

- No active environment (`null`) or the active id no longer exists → `vars` is
  empty; `{{var}}` placeholders pass through literally (Phase 1 behavior).
- Deleting the active environment → active id is cleared to `null` and an
  `environments` message with `activeId: null` is returned.
- Corrupt environment JSON → skipped on read (same as collections); never fatal.
- Recursive/self-referential values (`a = {{b}}`, `b = {{a}}`) → single-pass
  substitution only; no recursion. A value that itself contains `{{...}}` is
  substituted once and whatever remains is left literal. (Documented, not a bug.)
- Empty `{{}}` or malformed braces → left literal.

## Testing (TDD)

- **`interpolate`** — unit: single/multiple replacements; whitespace `{{ key }}`;
  unknown key left literal; disabled/empty-key variable ignored; no-vars passthrough;
  single-pass (value containing `{{x}}` not re-expanded).
- **`environment-store`** — unit on temp dir: CRUD, upsert, delete, corrupt-skip
  (mirrors collection-store tests).
- **`http-client` with vars** — unit: `{{var}}` resolved in url, params, headers,
  body; unknown left literal; raw request object not mutated.
- **`messaging`** — env routes return `environments`; sendRequest pulls active env
  vars and passes them to send; deleting the active env clears activeId.
- **webview `store`** — env slice actions + reset.
- **components** — env dropdown change posts setActiveEnv; Environments editor
  posts saveEnvironment; App routes `environments` into the store and posts
  loadEnvironments on mount.

## Files

New: `src/extension/interpolate.ts`, `src/extension/environment-store.ts`,
`src/webview/components/EnvDropdown/EnvDropdown.tsx`,
`src/webview/components/Environments/Environments.tsx`, plus their tests.
Modified: `src/shared/types.ts`, `src/extension/http-client.ts`,
`src/extension/messaging.ts`, `src/extension/panel.ts`,
`src/webview/state/store.ts`, `src/webview/App.tsx`,
`src/webview/components/Sidebar/Sidebar.tsx` (or top-bar host for the dropdown).

## Open questions

None blocking. Secret variables and cross-scope variables are explicit Phase-2
non-goals, revisitable later.
