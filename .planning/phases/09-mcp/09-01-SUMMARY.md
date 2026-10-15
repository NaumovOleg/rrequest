# 09-01 SUMMARY — MCP server foundation

Done: opt-in local MCP (Streamable HTTP) server bundled in the extension.

- `package.json`: `rrequest.mcpEnabled` (boolean, default **false**) and
  `rrequest.mcpPort` (number, 1024–65535, default 3333) settings; `rrequest.mcpStatus`
  command; `@modelcontextprotocol/sdk` + `zod` in devDependencies (bundled by esbuild).
- `src/extension/mcp/port.ts` (new): `McpPort` + `buildMcpPort(deps)`. Read methods hit
  the stores directly; `listEnvironments()` blanks `secret` variable values (keeps the
  flag). Writes go through `dispatch()`. No `sendRequest` — agent manages, the user sends.
- `src/extension/panel.ts`: `mcpPortRef` + `getMcpPort()`; `mcpDispatch()` capture-sink
  (`hub.register('mcp:<id>')` → `hub.dispatch` → collect posts) wired in `ensureBootstrap`
  so writes reuse the router (viewer guard, sync push, trash, snapshot broadcast).
- `src/extension/mcp/server.ts` (new): `createServer(port, meta)` registers the `about`
  tool. `McpHttpServer` — loopback `node:http`, POST `/mcp` only. Guards: Host must be
  loopback and any `Origin` header is rejected (403, DNS-rebinding); `Authorization: Bearer`
  constant-time compare (401); 8 MB body cap (413); JSON parse error 400; GET/DELETE 405;
  other paths 404. **Fresh transport + fresh `McpServer` per request** (stateless,
  `sessionIdGenerator: undefined`, `enableJsonResponse: true`) — the SDK's `connect()`
  refuses a second transport, and a fresh server also makes concurrent calls safe.
  `EADDRINUSE` → "port N in use". No `vscode` import (unit-testable).
- `src/extension/mcp/runtime.ts` (new): `McpRuntime` watches `mcpEnabled`/`mcpPort`
  (serialized `applyConfig`), lazily `ensurePort()`s, mints a per-start token
  (`randomBytes(24)`, stored in `context.secrets` key `rrequest.mcp.token`), starts/stops
  the HTTP server, shows a `$(radio-tower) MCP` status bar item (click → `rrequest.mcpStatus`),
  logs to the RREQUEST channel. Nothing runs until the box is checked.
- `src/extension/extension.ts`: constructs the runtime, `void applyConfig()` on activate,
  `onDidChangeConfiguration` → `applyConfig()`, registers `rrequest.mcpStatus` (offers to
  copy an `mcpServers` client-config snippet with URL + token). Runtime is in
  `context.subscriptions` so `deactivate` stops it and releases the socket.

Tests: `test/mcp/port.test.ts` (secret redaction; dispatch forwarding) and
`test/mcp/http.test.ts` (initialize handshake, `tools/list` has `about`, 401 on
missing/wrong token, 403 on Origin, 405 on GET, `stop()` frees the port). 595 total
green, `tsc -p tsconfig.json` clean, `yarn build` green (transport bundled into
`dist/extension.js`).

Extra verification: bundled the server standalone and ran it from a directory **with
no `node_modules`** — initialize + tools/list + tools/call succeed, confirming the
packaged `.vsix` needs no extra install. (Non-zod JSON-Schema validation / elicitation
would invoke ajv's `new Function` runtime `require("ajv/...")`; unused here, watch it
if a later tool ever passes a raw JSON Schema.)

Known limitations (deliberate):

- No access gating yet — every read tool lands in 09-02. `about` is the only tool and
  touches no collection.
- Add when 09-02 lands: clear session grants on stop.

Post-summary change: the token is no longer minted per start. It is now created
once and kept in Secret Storage (`src/extension/mcp/token.ts`, `ensureToken`), so
pasted client configs survive restarts; `RREQUEST: MCP copy token` /
`RREQUEST: MCP regenerate token` manage it.

Not committed (awaiting user request).
