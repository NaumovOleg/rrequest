# 09-02 SUMMARY — access gating + read tools

Done: every MCP read that touches your data now requires an explicit Allow, and
the agent gets a toolset to navigate collections.

- `src/extension/mcp/access.ts` (new): `McpAccess` — session-scoped grant store.
  `ResourceType`/`ResourceRef` (`workspace | collection | environment`, keyed
  `type:id`), `Grant {write, at}`, `AccessDecision` (`allow | allow-write |
deny`), `AccessResult` (`ok` | `reason: access_required|access_denied`).
  `require(ref, mode)` prompts only when the grant is missing or too weak:
  - write grant implies read; an existing write grant is **never downgraded**;
  - a denial is memoized for the session (`access_denied`, no re-prompt), and
    `revoke`/`revokeAll`/`clear` drop both grants and memo;
  - `onChanged` fires on every mutation (used to refresh the revoke picker).
    The Allow/Deny decision is injected (`AccessPrompt`) so the module stays
    `vscode`-free and unit-testable.
- `src/extension/mcp/tools.ts` (new): `registerTools(server, port, access, meta)`
  — reads first. **Gated:** `list_requests`, `get_request`, `get_environment`.
  **Ungated metadata** (names/counts only, no contents): `list_workspaces`,
  `list_collections`, `list_environments`, plus `about` and `request_access`.
  Helpers: `gated(...)` (require → structured `access_required` denial the model
  can act on), `errorOf(...)` (dispatch reply → message).
  `request_access` is the explicit recommended flow: it prompts, records the
  grant and returns `{ok, granted: 'read'|'write', resource}`; unknown ids fail
  with a candidate list; a name is accepted as an alias for an id.
- `src/extension/mcp/server.ts`: `createServer(port, access, meta)` now delegates
  to `registerTools` (the `about` tool moved out).
- `src/extension/mcp/runtime.ts`: owns one `McpAccess` wired to a native **modal**
  (`An AI agent requests read access to the collection "…" (RREQUEST MCP)` →
  Allow / Deny; a write prompt on a resource you already approved reads
  "upgrade to read & write"). Exposes `grants()`, `revoke(ref)`, `revokeAll()`;
  `stop()` calls `access.clear()` — **grants never persist**, which is what keeps
  "always ask" true across sessions.
- `src/extension/extension.ts` + `package.json`: `rrequest.mcpRevokeAccess` —
  QuickPick listing every live grant (`$(lock) collection: API — read & write`)
  plus "Revoke all", with a friendly "no grants" message.
- **Read-only/viewer workspaces** are refused by the extension's own guard
  (`messaging.ts:189` → `toast level:'error'`), and `errorOf` turns that toast
  into a proper tool error — the agent sees the same message a user would.

Deliberate deviations from the plan:

- `list_environments` is **ungated metadata** (no values at all) rather than a
  gated contents tool; `get_environment` is the gated one that returns the
  variables with secret values blanked. Navigation stays free, data stays gated.
- `list_workspaces` / `list_collections` likewise return names and counts only.

Tests: `test/mcp/access.test.ts` (8 — read-then-no-re-prompt, write grant,
single deny memo, upgrade prompt carries `alreadyRead`, no write downgrade,
`clear()` re-asks, revoke re-asks, resource independence) and
`test/mcp/tools.test.ts` (7 — ungated metadata never calls the prompt, gated
`list_requests` → `access_required`, flatten nested folders after a grant,
`get_request` round trip, `get_environment` gated **and** secret-redacted,
`request_access` grants without a second prompt, resolve-by-name + unknown-id
candidates).

Verified: `test/mcp/` 33 green, full suite **620 green** (86 files),
`npx tsc --noEmit -p tsconfig.json` clean, `yarn test:all` green.

Known limitations (deliberate):

- Session-scoped grants only — `// ponytail: add persistence only if users ask`.
- A denial short-circuits the rest of the session until revoked; there is no
  "ask again" button inside the tool call.

Not committed (awaiting user request).
