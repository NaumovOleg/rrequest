# State

Position: Phase 09 (MCP server) — code complete (uncommitted), 01/02/03 all
executed. Remaining: manual F5 verification with a real MCP client, then commit.

## Phase 09 — MCP server (local AI-agent bridge)

- 09-01 core: opt-in loopback Streamable-HTTP MCP server bundled in the extension —
  `rrequest.mcpEnabled` checkbox + `rrequest.mcpPort`, `McpPort` (secret-redacting
  reads, router-backed writes), hardened `McpHttpServer` (loopback + bearer token +
  Origin/Host guard), `McpRuntime` lifecycle, `rrequest.mcpStatus` command, `about`
  tool. Summary: `.planning/phases/09-mcp/09-01-SUMMARY.md`.
- 09-02 access: `McpAccess` session grants (write implies read, denial memo,
  never downgrade), native Allow/Deny modal, `rrequest.mcpRevokeAccess`, gated
  reads (`list_requests`, `get_request`, `get_environment`) + free navigation
  metadata, `request_access`. Summary:
  `.planning/phases/09-mcp/09-02-SUMMARY.md`.
- 09-03 manage: 9 write tools (collection/folder/request create·rename·delete,
  `update_request`, `move_request`), created-id diff resolution, `serial()`
  write queue, read-only toast → tool error, **no `send_request`**; request
  markdown docs readable/writable via `description`; `docs/usage.md` "Connect an
  AI agent (MCP)" section. Summary:
  `.planning/phases/09-mcp/09-03-SUMMARY.md`.

Deviations worth remembering: `create_request` dispatches `saveRequest` (not
`createRequest`) to avoid editor-tab spam; `list_workspaces` /
`list_collections` / `list_environments` stay ungated metadata (contents gated);
grants are in-memory only (cleared on server stop).

Post-summary changes (requested):

- **Static bearer token** — minted once into Secret Storage instead of per
  server start (`src/extension/mcp/token.ts`, `ensureToken`), so a pasted client
  config survives restarts. New commands: `rrequest.mcpCopyToken`,
  `rrequest.mcpRegenerateToken` (confirm modal → new token → copied); the status
  notification gained a "Copy token" button.
- **Request documentation** is readable/writable via MCP (`description` on
  `create_request`, `patch.description` on `update_request`).

## Phase 08 — executed

- 08-01 OAuth2 (PKCE + client-credentials, token cache in Secret Storage) — commit 0a4bdba
- 08-02 Variables in WS/gRPC, env secrets in Secret Storage, timeout setting — commit 941b857
- 08-03 SSE streaming panel + WS polish — commit 8391e53
- 08-04 Save response examples, reopen + diff — commit da27d18
- 08-06 Markdown docs on requests/collections/folders + export — commit ef90186
- 08-07 Method combobox, read-only banner, onboarding sample — commit 83c770a
- 08-08 Bulk multi-select in sidebar (delete/duplicate/move) — commit 49cd94e
- 05-graphql: **deferred, not executed** — plan kept, moved to Future in ROADMAP.
  Summaries: `.planning/phases/08-power/08-0{1..4,6,7,8}-SUMMARY.md`.

## Post-phase additions (2026-08-09, beyond roadmap)

- Dynamic values: `{{$uuid}}`, `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`,
  `{{$randomInt}}`, `{{$randomHex}}` in `interpolate` — work with zero env vars,
  everywhere interpolation runs (HTTP/WS/gRPC/SSE).
- Save history entry to a collection: save icon on history rows -> pick
  collection/folder; reuses `saveRequest` flow.
- Auth callback pages (Google sign-in, OAuth2) restyled: logo, card, "Done"
  pill — `src/extension/callback-page.ts`.

## Sync session fix (2026-10-15, beyond roadmap)

Bug: after ~30 days a signed-in user's Drive sync silently stopped — the server
401'd an expired JWT, the client never checked `exp`, and the UI kept showing
"connected"/"Sync completed." Root cause: `server/src/domain/jwt.ts` signed a
30-day `expiresIn` and nothing refreshed it.

- Server: access token (30d, `typ:"access"`) + new refresh token (365d,
  `typ:"refresh"`); OAuth callback returns `refresh`; unauthenticated
  `POST /api/auth/refresh` mints a new access token. Legacy typ-less tokens
  still verify.
- Extension: `SyncClient` refreshes once on 401 (`onAuth`) and retries;
  `account-store` stores the refresh token (Secret Storage) and gains
  `isExpired`/`hasFreshToken`/`setToken`; `signIn` returns `{token, refreshToken}`.
- Fallback: when an account's access **and** refresh tokens are both dead, a
  one-time startup warning offers "Sign in again"; `syncNow` now says what's
  actually wrong instead of a false "Sync completed."
- `sync-manager` unchanged — auto-refresh self-heals push/pull/adopt. Refresh
  token is **not** rotated. Remaining: manual F5 verification of the expiry →
  renew → re-login path.

## Test status

- `yarn test`: 88 files / 640 tests green (33 of them MCP); `yarn test:server`
  21 files / 144 tests green.
- `tsc --noEmit` (extension) + `yarn typecheck:server` clean; `yarn build`
  (vite + esbuild) green.

## Key facts from codebase revision (2026-08-08)

- Sidebar + history already have search/filter; request/folder duplicate; OpenAPI
  import/export; Cmd/Ctrl+Enter send; Copy-as-cURL — all pre-existing, not re-planned.
- Confirmed gaps that Phase 07 closed: keyboard shortcuts, run-last, codegen,
  no-code assertions, collection/folder scripts.
- Future (unplanned): mock servers, git-native collections, GraphQL schema
  explorer (deferred 08-05), collection runner, resend-from-history.
