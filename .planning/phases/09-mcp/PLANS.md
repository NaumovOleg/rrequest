# Phase 09 — MCP server (local AI-agent bridge)

Goal: ship an MCP (Model Context Protocol) server **inside** the extension so an
AI agent (Claude Desktop, Cursor, VS Code Copilot, any MCP client) can **discover
and manage** the user's collections/folders/requests/environments — creating and
editing them in RREQUEST. The agent does **not** send requests.

Constraints:

- **Ships with the extension** — bundled into `dist/extension.js`, no separate
  binary, `.vsix` stays node_modules-free.
- **Disabled by default** — off until the user opts in.
- **Enabled via a checkbox** in the extension settings (a `boolean` contribution
  renders as a checkbox where the gear already opens `workbench.action.openSettings 'rrequest'`).
- **Started/stopped by that checkbox** at runtime; survives reloads when left on.
- **No request sending over MCP** (v1). Local resource management only.
- **Every collection access is granted explicitly.** The agent must go through
  `request_access`; a native modal asks the user to Allow/Deny per collection.
  No tool touches a collection without a live grant.

| Plan      | File                           | Wave | Depends on | Tasks                                                                                    |
| --------- | ------------------------------ | ---- | ---------- | ---------------------------------------------------------------------------------------- |
| 01-core   | [09-01-PLAN.md](09-01-PLAN.md) | 1    | —          | settings checkbox, `McpPort` (+write dispatch), HTTP transport, lifecycle, status, token |
| 02-access | [09-02-PLAN.md](09-02-PLAN.md) | 2    | 01         | `request_access` + modal, session grant store, gating gate, read tools                   |
| 03-manage | [09-03-PLAN.md](09-03-PLAN.md) | 3    | 02         | create/rename/move/delete collection·folder·request·environment, tests, docs             |

## Key decisions (see plans for detail)

- **Transport = Streamable HTTP on `127.0.0.1`.** An extension can't be spawned
  as a stdio child by an MCP client (the host is already running), so HTTP is the
  only transport that fits. Client config points at `http://127.0.0.1:<port>/mcp`.
- **Official SDK, not hand-rolled JSON-RPC.** `@modelcontextprotocol/sdk` + `zod`,
  bundled by esbuild. Re-implementing initialize/capabilities/tools/session rules
  is a protocol bug farm.
- **Stateless server, one transport per request** (`sessionIdGenerator: undefined`,
  `enableJsonResponse: true`). State lives in our port + access store, not sessions.
- **Loopback bind + per-session bearer token + Host/Origin check.** The server can
  read/write collection data, so `127.0.0.1` is the baseline, the token stops
  other local processes, and rejecting browser-origin requests stops
  DNS-rebinding from a web page.
- **Explicit per-collection grants, session-scoped.** Enforced in the tool layer,
  not merely described to the model. Cleared on stop/reload → "always asks".
- **Writes reuse the existing router.** `hub.dispatch('mcp', msg)` runs the same
  code path as the webview: read-only (viewer) guard, sync push (`schedulePush`),
  trash, and snapshot broadcast — so the sidebar updates live and synced
  workspaces push. No second write path.
- **Secrets never leave the boundary.** Env variables flagged `secret` are
  redacted on read and never echoed on write.

## Explicitly out of scope (YAGNI)

- Sending requests / sending OAuth2 flows over MCP.
- WS/SSE/gRPC tools; resources/prompts; remote (non-loopback) access.
- Persisting grants across sessions (session-scoped by design for v1).
