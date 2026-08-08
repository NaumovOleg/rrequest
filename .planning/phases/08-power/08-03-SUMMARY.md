# 08-03-SUMMARY

## Server-Sent Events client (SSE) — DONE

Ad-hoc SSE debugging panel, mirroring the WebSocket panel: URL + headers +
Connect/Disconnect + live event log. No persistence (SSE sessions don't
belong in collections — a debugging scratchpad, unlike WS which is saved as
a request kind).

## Shipped

- `src/extension/net/sse-client.ts` (new): fetch + ReadableStream engine,
  line-buffered block parsing (`\n\n` / `\r\n\r\n`), `event:`/`data:`/`id:`
  fields, multi-line data join, comment-frame drop, CRLF, final unterminated
  block flush, abort via AbortController. No reconnection / Last-Event-ID —
  the UI re-connects manually.
- types.ts: `sseConnect`/`sseDisconnect` (webview→host), `sseEvent`
  (event/data/id/at), `sseClosed`, `sseError`, `showSse` (host→webview).
- messaging.ts: `sseConnect`/`sseDisconnect` cases with env-var interpolation
  of URL + headers (reuses the 08-02 `interpolateStr` pattern); RouterDeps.sse.
- panel.ts: SseClient instance (emits to hub sink `"sse"`), `showSse` →
  panel `sse`, reuse ws icon.
- hub.ts: `showSse` routed like `showWebSocket`.
- store.ts: sse slice (mode/url/headers/status/connId/log + actions).
- `src/webview/views/Sse/SsePanel.tsx` (new): URL bar + headers table + status
  pill + event log with JSON pretty-printing + clear button.
- EditorApp.tsx: `sseMode` panel branch, `sseEvent`/`sseClosed`/`sseError`
  handlers (connId-matched), title skip.
- package.json + extension.ts: `rrequest.newSse` command ("RREQUEST: New SSE
  Stream").

## Verification

- `test/extension/sse.test.ts`: 5 tests (named events + multi-line data,
  default-event name + comment-frame drop + empty-data event, CRLF + flush of
  unterminated block, HTTP 404 error path, disconnect abort).
- Full suite: 533 tests green (was 528). `tsc --noEmit` clean, build green.

## Known limitations

- No auto-reconnect and no Last-Event-ID resume — a debugging client should
  let the user re-run manually (ponytail: add EventSource-style reconnect
  only if a user asks for it).
- Panel shows a single stream at a time (like the WebSocket panel).