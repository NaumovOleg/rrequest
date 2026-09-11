# Extension host audit — 2026-09-11

## Scope
`src/extension/**` (host-side code only, ~5300 lines: panel/messaging/hub, net/*, sync/*, stores/*, formats/*, scripting/*). Webview UI (`src/webview/**`) excluded — separate concern, mostly React rendering.

## Method
1. Read every file in `src/extension/` grouped by area: core wiring (extension.ts, panel.ts, hub.ts, messaging.ts) → net (http-client, oauth2, sse-client, ws-manager, grpc-client) → sync/* (client, manager, merge, poll-loop, account-store, login, snapshot) → stores/* → formats/* → scripting/* (sandbox, interpolate, pm-expect).
2. For each file: check error handling, resource cleanup (timers/listeners/sockets), race conditions, input validation at trust boundaries (network responses, user scripts, imported files), and obvious logic bugs.
3. Cross-check against existing tests in `test/extension/` to see what's already covered vs. gaps.
4. Note findings inline, ranked by severity (crash/data-loss/security > correctness > cleanliness).
5. Fix real bugs directly (small, targeted diffs — no refactors). Re-run `yarn test` after.
6. Give a production-readiness verdict.

## Out of scope
- Webview/React code, server/ backend, infra/ (CDK) — not "the extension" proper.
- Style/architecture opinions that aren't bugs (this project already went through several review passes per memory).
