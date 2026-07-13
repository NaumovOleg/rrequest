# restman — Phase 5 (WebSockets) Design

**Date:** 2026-07-12
**Status:** Approved (design), pending implementation plan
**Scope:** Phase 5 — a standalone WebSocket client surface: connect to a `ws://`/`wss://` endpoint (with custom handshake headers), send text messages, and see a live message log. Branch `phase5-websockets` (stacked on `ux-editor-entry`).

## Overview

A WebSocket panel in the editor lets the user open a WS connection, send text frames, and watch incoming frames + connection status in a live log. The connection lives in the extension host (via the `ws` npm library), consistent with HTTP-in-host — arbitrary `ws://`, custom handshake headers (like Postman), no webview CSP relaxation. The host streams WS events to the editor through the Hub.

Phases 1-4 + layout + editor-entry fixes are complete. Later: Phase 6 (backend + auth/sync).

## Decisions

- **Connection in host via `ws`:** add the `ws` runtime dependency; the host opens/owns connections and streams events to the editor. Custom handshake headers supported; the webview CSP stays `default-src 'none'`.
- **Standalone WS surface:** a WebSocket panel toggled from the editor top bar (a "WebSocket" button switches between the HTTP request editor and the WS panel). Not saved into collections in this phase (a later addition). One active WS connection at a time (MVP).
- **Streaming, not request/reply:** WS events (open/message/close/error) are asynchronous pushes from the host to the editor — delivered via a new `Hub.emitToEditor(msg)` (posts to the editor sink if registered, drops otherwise), NOT as router replies.
- **Sent-message logging:** the editor appends an `out` log entry locally when it sends; the host streams `in`/status events. This halves plumbing while keeping the log complete.
- **`ws` native optional deps** (`bufferutil`, `utf-8-validate`) are marked external in esbuild — `ws` runs pure-JS without them.

## Message protocol (additions)

```ts
// webview -> host
| { type: 'wsConnect'; connId: string; url: string; headers: KeyValue[] }
| { type: 'wsSend'; connId: string; data: string }
| { type: 'wsDisconnect'; connId: string }
// host -> webview (editor, streamed via emitToEditor)
| { type: 'wsOpen'; connId: string }
| { type: 'wsMessage'; connId: string; data: string; at: number }
| { type: 'wsClosed'; connId: string; code: number; reason: string }
| { type: 'wsError'; connId: string; message: string }
```

## Architecture

### Extension host

- **`ws-manager.ts`** (new) — `WsManager` holds `Map<connId, WebSocket>` and an `emit(msg: HostMessage) => void` (given at construction; wired to `Hub.emitToEditor`). A WebSocket factory is injectable for tests (`(url, opts) => WebSocket`), defaulting to `ws`'s `WebSocket`.
  - `connect(connId, url, headers)` — `factory(url, { headers })`; wires `on('open')` → `emit(wsOpen)`, `on('message', data)` → `emit(wsMessage{data: String(data), at: Date.now()})`, `on('close', code, reason)` → `emit(wsClosed)` + delete from map, `on('error', err)` → `emit(wsError{message})`; stores the socket.
  - `send(connId, data)` — if a socket exists, `socket.send(data)`.
  - `disconnect(connId)` — if a socket exists, `socket.close()`.
- **`hub.ts`** (modified) — add `emitToEditor(msg: HostMessage): void` (posts to the `'editor'` sink if present, else no-op). Used by the WsManager to stream events.
- **`messaging.ts`** (modified) — `RouterDeps` gains OPTIONAL `ws?: WsManager`. Routes `wsConnect`/`wsSend`/`wsDisconnect` call the manager and return `undefined` (no reply; events stream asynchronously). The post-dispatch snapshot broadcast still runs (harmless).
- **`panel.ts`** (modified, in `ensureBootstrap`) — construct `new WsManager(msg => hub.emitToEditor(msg))` and inject it into the router as `ws`.
- **`esbuild.js`** (modified) — add `bufferutil`, `utf-8-validate` to `external`.

### Webview (editor)

- **`store.ts`** (modified) — a WS slice:
  ```ts
  wsMode: boolean                  // editor shows the WS panel vs the HTTP editor
  wsUrl: string
  wsHeaders: KeyValue[]
  wsInput: string
  wsStatus: 'closed' | 'connecting' | 'open'
  wsConnId: string | null
  wsLog: { dir: 'in' | 'out' | 'status'; data: string; at: number }[]
  // actions: setWsMode, setWsUrl, setWsHeaders, setWsInput, wsStartConnect(connId),
  //          wsSetStatus(status), wsAppendLog(entry), wsClear
  ```
  All WS fields are cleared in `__reset`.
- **`WebSocketPanel.tsx`** (new) — URL input, a headers key/value table (reusing the KeyValue pattern), a Connect/Disconnect button, a message composer (input + Send), and a scrolling log (each entry shows direction, time, data). Connect posts `wsConnect{connId, url, headers}` and sets status `connecting`; Disconnect posts `wsDisconnect`; Send posts `wsSend` and appends an `out` log entry.
- **`EditorApp.tsx`** (modified) — a "WebSocket" toggle button in the top bar (flips `wsMode`); when `wsMode`, render `<WebSocketPanel/>` instead of Tabs/RequestPanel/ResponsePanel. The mount message handler gains WS cases: `wsOpen` → status `open` + a status log entry; `wsMessage` → append an `in` log entry; `wsClosed` → status `closed` + status log; `wsError` → an error status log entry.

## Data flow

```
Connect:  WebSocketPanel → wsConnect{connId,url,headers} → host router → WsManager.connect
          → ws opens → emit(wsOpen) → Hub.emitToEditor → EditorApp: status 'open' + log.
Message in: server frame → ws 'message' → emit(wsMessage) → editor appends 'in' log.
Send:     composer Send → wsSend{connId,data} → WsManager.send; editor appends 'out' log locally.
Close:    Disconnect → wsDisconnect → WsManager.disconnect → ws 'close' → emit(wsClosed)
          → editor: status 'closed' + log. (Server-initiated close same path.)
Error:    ws 'error' → emit(wsError) → editor: error log entry.
```

## Error handling & edge cases

- A connection failure (bad url, refused, handshake error) surfaces as `ws 'error'` then `ws 'close'` → an error log entry + status `closed`; never crashes the host.
- `wsSend` when no socket exists (already closed) → no-op (guarded in the manager).
- The connId is generated by the editor on Connect (`newId()`); the host keys the socket by it. A stale event for an unknown connId is still emitted to the editor (the editor ignores events for a connId it isn't tracking — MVP tracks a single `wsConnId`).
- Non-text (binary) frames → stringified best-effort (`String(data)`); a full binary viewer is out of scope.
- Only one active connection at a time; connecting a new one while open should Disconnect the previous first (the panel Connect button is disabled/relabeled while open — Connect only when `closed`).

## Testing (TDD)

- **`ws-manager`** — with an injected fake WebSocket: `connect` wires handlers and `open`/`message`/`close`/`error` emit the right `HostMessage`s; `send`/`disconnect` call the socket; `close` removes the socket from the map; send/disconnect on an unknown id are no-ops.
- **`hub`** — `emitToEditor` posts only to the editor sink (not the sidebar); no-op when the editor is not registered.
- **`messaging`** — `wsConnect`/`wsSend`/`wsDisconnect` call the injected `ws` manager; return undefined.
- **store** — WS slice actions + reset.
- **`WebSocketPanel`** — Connect posts `wsConnect` + sets connecting; Send posts `wsSend` + appends an out log; Disconnect posts `wsDisconnect`; the log renders in/out/status entries.
- **`EditorApp`** — the WebSocket toggle shows the panel; `wsOpen`/`wsMessage`/`wsClosed`/`wsError` update status + log.

## Files

New: `src/extension/ws-manager.ts`, `src/webview/components/WebSocket/WebSocketPanel.tsx`, plus tests.
Modified: `package.json` (+`ws`, +`@types/ws`), `esbuild.js`, `src/shared/types.ts`,
`src/extension/hub.ts`, `src/extension/messaging.ts`, `src/extension/panel.ts`,
`src/webview/state/store.ts`, `src/webview/editor/EditorApp.tsx`.

## Non-goals (Phase 5)

- Saving WS requests into collections; multiple simultaneous connections; Socket.IO / STOMP subprotocols; binary frame composing/viewing; message pinning/filtering; reconnect/backoff; `{{var}}` interpolation in the WS url/headers (could be a fast follow).

## Open questions

None blocking.
