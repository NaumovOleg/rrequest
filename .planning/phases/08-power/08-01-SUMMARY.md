# 08-01 SUMMARY — OAuth2

Done: OAuth2 Authorization Code (PKCE) + Client Credentials grants.

- `src/extension/net/oauth2.ts` (new): pkceChallenge, loopback callback server
  (node:http), token exchange (fetch, form-encoded), refresh flow,
  resolveOAuthToken / fetchOAuthToken / oauthTokenStatus. Tokens stored in VS
  Code Secret Storage keyed `rrequest.oauth.<requestId>` — never in workspace
  JSON / sync snapshots / exports.
- `types.ts`: `oauth2` variant on Auth + `OAuthToken` + 2 message pairs.
- `messaging.ts`: token resolution in sendRequest (after cascade scripts,
  injects `Authorization: Bearer` unless the user set one) + oauthGetToken /
  oauthStatus cases.
- `panel.ts`: oauth deps wired (secrets + vscode.env.openExternal).
- `RequestPanel.tsx` AuthEditor: OAuth2 option, grant selector, fields,
  "Get token" button with status line (uses request id for the message loop).
- `http-client.ts`: oauth2 branch in applyAuth (no-op — header pre-injected).

Tests: test/extension/oauth2.test.ts — 8 tests (PKCE shape, client-cred mint +
store, cached reuse, expiry refresh, no-token error, status). 525 total green,
tsc clean, build green.

Known limitations (deliberate):
- WS/gRPC don't get OAuth tokens (manual headers only) — HTTP-only, noted.
- client-credentials mints fresh per send; cache window not implemented (cheap
  stateless grant; add in-memory cache if perf matters).
- No token-revoke button; overwrite via "Get token" is the flow.
