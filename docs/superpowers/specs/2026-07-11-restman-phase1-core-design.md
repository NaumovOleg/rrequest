# restman — Phase 1 (Core) Design

**Date:** 2026-07-11
**Status:** Approved (design), pending implementation plan
**Scope:** Phase 1 only — local core REST client. No backend, no sync.

## Overview

`restman` is a VS Code extension: a full-featured REST client in the style of
Postman. It runs entirely inside VS Code, with a React-based UI in a webview and
HTTP execution in the extension host (Node).

The complete product is split into phases. Each phase is its own spec → plan →
implementation cycle. This document specs **Phase 1** only.

### Full phase roadmap (context, not scope)

1. **Phase 1 — Core (this doc):** tabs, request builder (method / headers /
   params / body), response viewer, collections (tree + local save), basic
   history.
2. **Phase 2 — Environment manager:** `{{var}}` substitution, environment
   switching.
3. **Phase 3 — Import/export:** Postman collection format conversion; file
   upload (multipart `form-data`).
4. **Phase 4 — Scripts (hooks):** pre-request / post-request sandbox; Tests tab.
5. **Phase 5 — WebSockets.**
6. **Phase 6 — Backend + login/sync + OAuth helper:** own server + DB;
   Google/GitHub login for cloud sync of collections/envs; OAuth helper to
   authorize outgoing requests.

## Goals (Phase 1)

- Send HTTP requests (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) and view responses.
- Postman-like layout (see `design.png`): icon rail, collection tree, request
  tabs, request panel with sub-tabs, response panel.
- Build requests: method, URL, query params, headers, body (none / raw / urlencoded).
- Save requests into collections, stored locally as JSON.
- Basic request history.
- Theme follows VS Code: UI colors come from `--vscode-*` CSS variables so the
  extension re-themes automatically when the VS Code theme changes.

## Non-goals (Phase 1)

Explicitly deferred to later phases (YAGNI here):

- Environments / `{{var}}` substitution (Phase 2).
- Import/export and Postman-format conversion; multipart file upload (Phase 3).
- Authorization tab, Pre-request Script, Tests tabs (Phases 4 / 6).
- WebSockets (Phase 5).
- Backend, login, cloud sync, OAuth helper (Phase 6).
- Postman rail items not needed: APIs, Mock Servers, Monitors, Flows — dropped
  entirely.
- Full binary/image response viewer.

## Stack

- **Extension host:** TypeScript, bundled with esbuild.
- **Webview:** React + TypeScript, bundled with Vite.
- **HTTP:** native `fetch` (Node 18+ / undici) — no external HTTP client.
- **State (webview):** Zustand (lightweight).
- **Tests:** Vitest (unit); `@vscode/test-electron` for e2e is minimal in Phase 1.

## Architecture

Two processes, the standard split for VS Code REST extensions:

```
┌─────────────────────────────────────────────┐
│ Extension Host (Node + TS)                    │
│  - activate(), command restman.open           │
│  - WebviewPanel lifecycle (editor area)       │
│  - HttpClient: executes requests (native      │
│    fetch) — no CORS, real HTTP                 │
│  - CollectionStore: CRUD JSON in globalStorage │
│  - HistoryStore: last N requests               │
│  - Message router (postMessage protocol)       │
└───────────────▲───────────────┬───────────────┘
                │ responses      │ commands
                │ (postMessage)  ▼ (postMessage)
┌───────────────┴───────────────────────────────┐
│ Webview (React + TS, Vite build)               │
│  - All UI: rail, tree, tabs, request panel,     │
│    response viewer                              │
│  - Does NOT send HTTP itself — asks host via    │
│    postMessage                                  │
│  - Theme from --vscode-* CSS variables          │
└─────────────────────────────────────────────────┘
```

### Rationale

- **HTTP in host, not webview:** avoids CORS, allows arbitrary headers/methods,
  yields real status codes and timing. The webview is a browser context and
  cannot make unrestricted HTTP calls.
- **Thin message interface:** the webview is pure React and talks to the host
  only through a typed message protocol. Both sides are independently testable.
- **Theme:** the webview inherits `--vscode-editor-background`,
  `--vscode-foreground`, etc. As the VS Code theme changes, the extension
  re-themes automatically. No custom color palette.

### Webview placement

The webview is an editor-area `WebviewPanel` (full-window, matching the Postman
layout in `design.png`), not a sidebar view.

## Components

Each module has one responsibility and is testable in isolation.

### Extension host — `src/extension/`

- **`extension.ts`** — `activate` / `deactivate`; registers the `restman.open`
  command; creates or reveals the `WebviewPanel`.
- **`panel.ts`** — `WebviewPanel` lifecycle; loads the built webview assets;
  owns the message channel; serializes/restores state on hide/reveal.
- **`messaging.ts`** — typed router. Parses inbound `WebviewMessage` commands,
  dispatches to the right service, posts back a `HostMessage` response. Unknown
  message types are logged and ignored (no crash).
- **`http-client.ts`** — `sendRequest(req: RestRequest): Promise<HttpResponse>`.
  Uses native `fetch` only. Measures timing around the call. Maps
  network/timeout errors into a structured result (`error` field), never throws
  raw into the webview.
- **`collection-store.ts`** — CRUD for collections/requests. Reads/writes
  `globalStorage/collections/<id>.json`. Atomic writes (temp file + rename).
- **`history-store.ts`** — appends the last N (default 50) sent requests to
  `globalStorage/history.json`.

### Webview — `src/webview/`

- **`App.tsx`** — layout: rail + tree + tab bar + active tab.
- **`components/Sidebar/`** — icon rail (Collections, History) + collection tree.
- **`components/Tabs/`** — open request tabs, `+`, close.
- **`components/RequestPanel/`** — method dropdown, URL bar, Send; sub-tabs
  Params / Headers / Body.
- **`components/ResponsePanel/`** — Body / Headers / Cookies sub-tabs +
  Status / Time / Size.
- **`state/`** — Zustand store: open tabs, active request, tree, response cache.
- **`ipc.ts`** — `postMessage` / `onMessage` wrapper; typed request/response to
  the host.

### Shared — `src/shared/`

- **`types.ts`** — domain types (`RestRequest`, `HttpResponse`, `Collection`,
  `HistoryEntry`) and message types. Imported by both host and webview — single
  source of truth.

## Data flow

### Send request (main flow)

```
1. User clicks Send in RequestPanel.
2. Webview assembles RestRequest from UI state.
3. ipc.request({ type: 'sendRequest', payload: RestRequest }) -> postMessage host.
4. messaging.ts -> http-client.sendRequest().
5. fetch executes in Node (timing measured around it).
6. host -> postMessage HttpResponse (status/headers/body/timeMs/sizeBytes).
7. Webview stores it in the active tab's response cache.
8. ResponsePanel renders.
9. In parallel, host appends to history-store.
```

### Save / load collections

```
Save:   webview -> { type: 'saveRequest', collectionId, request }
        -> collection-store writes <id>.json -> ok -> webview refreshes tree.
Load:   panel open -> host reads all collections/*.json -> sends tree to webview.
```

Export / import are Phase 3 (they build on the same store), not Phase 1.

## Data model (`shared/types.ts`)

```ts
type RestRequest = {
  id: string
  name: string
  method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'|'HEAD'|'OPTIONS'
  url: string
  params:  KeyValue[]        // query, enabled via checkbox
  headers: KeyValue[]
  body: RequestBody          // none | raw(json/text/xml) | urlencoded
}

type KeyValue = { key: string; value: string; enabled: boolean }

type RequestBody =
  | { mode: 'none' }
  | { mode: 'raw'; type: 'json'|'text'|'xml'; text: string }
  | { mode: 'urlencoded'; items: KeyValue[] }

type HttpResponse = {
  status: number
  statusText: string
  headers: KeyValue[]
  body: string               // raw text; webview formats JSON for display
  timeMs: number
  sizeBytes: number
  cookies: KeyValue[]
  error?: { kind: 'dns'|'connection'|'timeout'|'unknown'; message: string }
}

type Collection = { id: string; name: string; requests: RestRequest[] }

type HistoryEntry = { id: string; request: RestRequest; status: number; at: number }
```

### Model notes

- `params` and the URL query string are kept in sync in the webview: enabled
  key/values build the final URL before sending.
- Body `form-data` with files (multipart) is Phase 3, not here.
- The schema is restman's own (not Postman v2.1) for simplicity. Postman-format
  conversion is Phase 3.

## Error handling & edge cases

### HTTP (`http-client.ts`)

- DNS / connection refused / timeout → returns an `HttpResponse` with the
  `error` field set, not a thrown exception. Webview shows a red error banner in
  ResponsePanel; it does not crash.
- Timeout: default 30s via `AbortController` (configurable later).
- Non-2xx (4xx/5xx) is a normal response, not an error — rendered as-is.
- Binary or large body: if not text, or larger than a limit (default 5 MB), the
  body is not parsed as a string; ResponsePanel shows "binary / too large" plus
  the byte size. A full binary viewer is a later phase.

### Storage (`collection-store` / `history-store`)

- Corrupt JSON on read → skip that file, log to the output channel, load the
  rest. One bad collection never breaks the whole tree.
- Atomic writes: temp file + rename — no half-written JSON.
- (Import of invalid JSON is a Phase 3 concern.)

### Webview

- Empty or invalid URL → Send is disabled with a hint.
- Webview eviction (VS Code unloads hidden webviews) → state is serialized via
  the webview `getState`/`setState` API and restored on reveal.
- Unknown message type in the router → logged and ignored (no crash).

### Timing / size

Measured by the host (real network), not the webview.

## Testing (TDD, Vitest)

- **`http-client`** — unit: mock fetch; verify status/headers/timing mapping;
  connection/timeout errors produce a structured result (not a throw); body-size
  limit. Core logic, covered thoroughly.
- **`collection-store` / `history-store`** — unit against a temp dir: CRUD,
  atomic write, skip corrupt JSON.
- **`messaging` router** — unit: command → correct service; unknown type ignored.
- **webview `state` (Zustand)** — unit: params⇄URL sync, tab open/close,
  response cache.
- **React components** — smoke tests (Testing Library): RequestPanel /
  ResponsePanel render without crashing.
- **e2e** via `@vscode/test-electron` (real VS Code) — minimal in Phase 1.

## Project structure

```
restman/
  package.json          // extension manifest + scripts (build, watch, test)
  src/
    extension/          // host: extension, panel, messaging, http-client, *-store
    webview/            // React: App, components/, state/, ipc
    shared/             // types
  media/                // built webview (Vite output)
  test/                 // *.test.ts
  esbuild.js            // host bundle
  vite.config.ts        // webview bundle
```

Two bundles: host (esbuild → `dist/`), webview (Vite → `media/`).

## Open questions

None blocking. Timeout duration and body-size limit are hard-coded defaults in
Phase 1, made configurable in a later phase.
