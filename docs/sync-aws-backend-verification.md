# Sync backend (AWS Lambda) — manual verification runbook

One-time, end-to-end manual check that the deployed serverless backend
(`server/`) and the extension's poll-based sync actually work together —
covering the ground that unit/dynalite tests can't (real AWS, real Google
OAuth consent, real cross-account sharing, real Drive edits). Needs an AWS
account and the one Google OAuth app from `server/README.md`'s setup
section. You'll need **two Google accounts** (or two test users on the OAuth
consent screen if it's in "Testing" mode) to exercise sharing.

Prerequisites: `server/README.md` completed through "Deploy" and "Set the 3
secret values" — you have a deployed `ApiUrl`, the Google OAuth redirect URI
matches `<ApiUrl>/api/auth/callback`, and all 3 SSM SecureString parameters hold
real values.

## 0. Deploy sanity

```sh
cd server/infra
npx cdk deploy --all
```

- [ ] The `RrequestStack` deploys with no errors.
- [ ] `RrequestStack`'s `ApiUrl` output is a
      `https://<id>.execute-api.<region>.amazonaws.com` URL — copy it.
- [ ] `curl -i <ApiUrl>/api/auth/start?cb=http://localhost:1` returns
      `302` with a `location` header pointing at `accounts.google.com`
      (confirms the API Gateway → `apiFn` route and cold-start secrets
      fetch both work before touching a browser).

## 1. Point the extension at the deployment

- [ ] In VS Code settings, set `rrequest.syncServerUrl` to `<ApiUrl>/api`
      (the `/api` suffix is required — see `server/README.md`'s "Point the
      extension" section for why).
- [ ] Reload the window (or restart the Extension Development Host) so the
      setting takes effect.

## 2. Sign in (loopback OAuth → Google → JWT)

- [ ] Open the rrequest sidebar; find the account row / "Sign in to sync"
      entry (command `rrequest.signInToSync`).
- [ ] Trigger sign-in. A browser tab opens to the Google consent screen
      (via `GET /api/auth/start?cb=http://localhost:<ephemeral-port>`).
- [ ] Approve consent (first account, e.g. Account A). The tab redirects to
      `GET /api/auth/callback`, then to
      `http://localhost:<port>/?token=<jwt>`, landing on a plain "you can
      close this tab" page.
- [ ] Back in VS Code, the account row now shows Account A as signed in
      (confirms the extension's tiny loopback HTTP server captured the
      `token` query param and the sidebar re-rendered with it).
- [ ] `GET <ApiUrl>/api/me` with `Authorization: Bearer <jwt>` (e.g. via
      `curl` using the token from the VS Code output/log if visible, or
      trust the UI state) returns `{ id, email }` for Account A.

## 3. Enable sync on a workspace

- [ ] With a workspace open, run "rrequest: Enable sync for active
      workspace".
- [ ] In Google Drive (Account A), a folder named `<8-hex-hash>-rrequest`
      appears at the Drive root, containing a `<workspace-name>-<id>.json`
      file — confirms `folderNameForUser` + `ensureFolder`/`createFile` ran
      against the real Drive API.
- [ ] The extension shows the workspace as synced (role `owner`).

## 4. Cross-window pull (extension → extension, within a poll interval)

- [ ] Open a second VS Code window (or Extension Development Host instance)
      signed in as the **same** Account A, with the same
      `rrequest.syncServerUrl`.
- [ ] In window 1, edit something in the synced workspace (add/rename a
      request) and let it push (automatic on change, or run "rrequest: Sync
      now").
- [ ] In window 2, wait up to `rrequest.syncPollIntervalMs` (default 45s) —
      the change should appear without any manual action, once the client's
      poll loop calls `GET /api/workspaces`, notices the `revision` changed,
      and pulls.
- [ ] Reverse the edit direction (window 2 → window 1) and confirm the same
      pull-on-poll behavior.

## 5. Outside-Drive edit (pollFn detects it, then the client pulls)

- [ ] Directly in the Google Drive web UI (Account A), open the synced
      workspace's JSON file and edit it (e.g. Drive's "Open with Text
      Editor" or download-edit-reupload — any change that creates a new
      Drive revision of that file).
- [ ] Wait up to 1 minute (the `RrequestStack` EventBridge rule
      invokes `pollFn` on a 1-minute rate) — check CloudWatch Logs for the
      `PollFunction` Lambda to confirm it ran and bumped a revision
      (`PollService.pollAll`'s return count > 0, or just observe the
      workspace's stored `revision` change in the `Workspaces` DynamoDB
      table).
- [ ] Then, within the extension's own poll interval on top of that, the
      signed-in window(s) pull the Drive-edited content automatically.

## 6. Share by email

- [ ] In the extension (Account A, owner), open the workspace's sharing UI
      and add Account B's email with role **editor**.
- [ ] Confirm in the `Memberships` DynamoDB table (or via
      `GET /api/workspaces/:id/members`) a row was added; if Account B has
      never signed in before, it's `pending: true` (keyed by email until
      that email's first OAuth sign-in).
- [ ] In Google Drive, confirm Account B now has a permission on the
      workspace's file (owner's Drive → file → Share dialog).
- [ ] Sign in to the extension as Account B (repeat step 2 in a separate
      window/profile). The shared workspace appears in Account B's
      workspace list with role `editor` — confirms the pending membership
      resolved to Account B's real `userId` on first login.
- [ ] As Account B (editor), edit the workspace and push. Confirm Account A
      sees the change (within a poll interval).

## 7. Viewer is read-only

- [ ] As Account A (owner), change Account B's role to **viewer** (re-add
      with role `viewer`, or use whatever UI action changes role).
- [ ] As Account B (viewer), attempt to edit and push. Confirm the push is
      rejected (`403`) and the extension surfaces this as read-only /
      forbidden rather than silently failing or corrupting local state.
- [ ] Confirm Account B can still **pull** (see A's changes) as a viewer.

## 8. Remove a member

- [ ] As Account A (owner), remove Account B from the workspace.
- [ ] Confirm the `Memberships` row is gone and the Drive permission is
      revoked (Account B's copy of the file, if opened directly in Drive,
      no longer shows as shared, or a fresh `GET /api/workspaces` as
      Account B no longer lists the workspace).
- [ ] As Account B, confirm the workspace no longer appears in the synced
      workspace list, and a direct pull attempt (if the extension retains
      the stale entry) returns `403`.

## 9. Sign out

- [ ] Sign out of the extension (Account A and/or B). Confirm the account
      row reverts to "sign in" state and no further sync calls are made
      (no `Authorization` header / no poll requests) until signed in again.

## Notes / known limitations to keep in mind while testing

- There is no realtime push — every cross-window / cross-account update is
  discovered on the *next* poll, not instantly. Two client-side variables
  govern the worst-case delay: `rrequest.syncPollIntervalMs` (extension →
  server) and the fixed 1-minute EventBridge rate (server-side Drive-edit
  detection, only relevant for edits made outside the extension).
- `pollFn`'s cold start needs read access to the JWT secret param even though its
  own logic never uses it directly — `deps.ts` eagerly constructs
  `AuthService` on import (see the comment in
  `server/infra/lib/functions.ts`). If `pollFn` cold-starts fail with
  `AccessDenied` on the JWT secret param, that grant is the first place to check.
- Both Lambdas cache secret values for the lifetime of the warm container
  (`ensureSecretsLoaded`'s `loaded` flag) — after rotating a secret value,
  changes only take effect for *new* (cold-started) execution environments.
  If a test step behaves as though an old secret is still active, that's
  expected until Lambda recycles the container (or you force it, e.g. by
  updating the function's env/config to trigger a new version).
