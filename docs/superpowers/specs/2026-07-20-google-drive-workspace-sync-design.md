# Google Drive Workspace Sync — Design

Date: 2026-07-20
Status: Approved (brainstorming) — ready for implementation planning

## Goal

Give restman a **Postman-like sync experience** where the data lives in the
user's **Google Drive**. A user signs in with Google, opts a workspace into
sync, and its collections + environments are stored as one JSON file in Drive.
Owners can share a workspace with other people by email (with a role); Google
notifies them, and the workspace **just appears** in their restman when they
sign in with the same email. Edits propagate between members in near-real-time.

Non-goals: syncing history; syncing secret environment values; a Postman-clone
backend that stores data itself (data lives in the user's Drive, not our DB).

## Key decisions (from brainstorming)

- **Scope:** full system — auth + Drive storage + realtime sync + sharing.
- **Auth:** backend broker (holds Google client secret + refresh tokens);
  extension holds only an app-session JWT.
- **Backend does everything Google-facing:** full Drive **proxy** (extension
  never calls Google directly), watch channels, realtime relay.
- **Realtime:** Drive `files.watch` webhooks → backend → WebSocket → clients pull.
- **Sync content:** collections + environments (secret values stripped);
  **history stays local**.
- **Granularity:** one JSON file per workspace, `{hash}-restman/<name>-<id>.json`.
- **Conflicts:** last-write-wins with a revision guard + merge-by-id.
- **Roles:** Owner / Editor / Viewer.
- **UX:** Postman-feel — silent background sync (no manual push/pull buttons),
  shared workspaces appear on login, live updates. Local-only workspaces keep
  working offline; sync is opt-in per workspace.

## Architecture

Three parts.

### Backend (new hosted service)

The hub. Holds the Google client secret and each user's Google **refresh
token** (encrypted at rest). Owns its database.

Responsibilities:
- OAuth exchange + token refresh; mints app-session JWTs.
- **Drive proxy:** all read/write/share of workspace files.
- **Watch channels:** registers Drive `files.watch` per synced workspace file;
  receives change webhooks; renews before expiry (cron) with a periodic poll
  fallback.
- **Realtime relay:** JWT-authed WebSocket server; pushes `workspace-changed`
  events to connected members.
- Membership / roles / sharing (Drive `permissions.create` + membership rows),
  including **pending** memberships for emails without an account yet.

Database:
- `users(id, email, google_sub, refresh_token)`
- `workspaces(id, name, owner_user_id, drive_file_id, hash_folder_id, revision, updated_at)`
- `memberships(workspace_id, user_id | pending_email, role)` — owner|editor|viewer
- `watch_channels(workspace_id, channel_id, resource_id, expiration)`

### Extension (restman host)

Talks **only** to the backend (REST + one WebSocket) — never to Google.

- New `SyncClient`: login, list-my-workspaces, push, pull, member management,
  plus the WebSocket for change events.
- App-session JWT stored in VS Code **SecretStorage**.
- Local `sync-state` store (not synced): per workspace
  `{ driveFileId, ownerEmail, role, lastRevision, synced }`, plus local secret
  values kept separately.
- On `workspace-changed` → pull → merge into local stores → rebroadcast to
  webviews via the existing Hub snapshot.

### Webview — Workspace panel

- Signed-out → "Sign in with Google"; signed-in → email + Sign out.
- Per workspace: **Sync** toggle (on → create Drive folder+file), status
  (synced · last-updated · by whom), owner/role badge.
- **Members** list + roles; add by email + role; remove (owner only).
- Error/conflict toasts.

## Auth flow

1. User clicks **Sign in with Google**.
2. Extension opens a temp loopback listener `http://localhost:<port>`, then
   opens the browser to `backend /auth/start?cb=localhost:<port>`.
3. Backend runs Google OAuth (client secret server-side), scopes
   `drive.file` + `email`/`profile`. User consents.
4. Google → backend `/auth/callback` → backend stores the refresh token,
   upserts `users`, mints an app-session **JWT**, redirects to
   `http://localhost:<port>?token=…`.
5. Extension captures the JWT → **SecretStorage** → closes the listener.
6. WebSocket connects with the JWT; backend returns the user's workspaces
   (owned + shared) → they appear in the sidebar.

JWT expiry → silent re-auth; the Google refresh token never leaves the backend.

## Data model & Drive layout

Drive (owner's Drive): folder `{hash}-restman/` (hash = stable per-owner id
from the backend). One file per workspace `<name>-<workspaceId>.json` (id in the
name survives renames). Shared to members via Drive permissions; backend records
each `driveFileId`.

Sync file JSON:
```json
{ "version": 1, "workspaceId": "...", "name": "...",
  "collections": [ /* full tree: folders, requests (http/grpc/ws) */ ],
  "environments": [ /* secret vars have value "" */ ],
  "updatedAt": 0, "updatedBy": "editor@email" }
```
No history. Secret env values stripped on push; on pull a secret var appears with
an **empty value** the user fills locally — real secrets stay only in the local
env store, never uploaded.

## Sync engine

**Push (local → Drive):** change to a synced workspace's collections/
environments → debounce ~1.5s → `PUT /workspaces/:id { snapshot, baseRevision }`.
- Revision matches → backend writes the Drive file, bumps revision, broadcasts
  `workspace-changed {id, revision, updatedBy}` to other members over WS.
- Mismatch → `409` + latest snapshot/revision → extension **merges by id**
  (remote as base, re-apply local adds/renames/deletes) → retry once.

**Pull (Drive → local):** triggers = WS `workspace-changed`, on login, on
workspace open. `GET /workspaces/:id` → snapshot+revision → merge into local
stores → set `lastRevision` → rebroadcast to webviews.

**Outside edits:** file edited directly in Drive → Drive fires `/webhook` →
backend re-reads, bumps revision, broadcasts → members pull.

**Merge-by-id:** union collections/folders/requests/envs by id; remote is the
base and local adds/renames/deletes are re-applied; a true same-field clash
resolves remote-wins (last-write-wins).

**Secret preservation on pull:** match env var by key — if the incoming secret
value is empty but a local value exists, keep local.

**Loop prevention:** tag pushes with an origin client id; ignore echoes of our
own write.

## Realtime

One JWT-authed WebSocket (extension ↔ backend), subscribed to all the user's
workspace ids; reconnect with backoff; on reconnect, pull all synced workspaces
to catch up. Backend fans `workspace-changed` out to members from both push and
Drive webhook paths.

## Sharing

Add a member (owner/editor):
1. Panel → Members → email + role (editor/viewer).
2. `POST /workspaces/:id/members {email, role}`.
3. Backend: Drive `permissions.create` (writer/reader, `sendNotificationEmail=true`
   → Google emails them) + membership row; if the email has no account, a
   **pending** membership resolved on their first sign-in.
4. They sign in with the same email → backend returns the workspace → it appears
   in their sidebar, synced.

Roles enforced both sides: viewer = read-only (extension disables edits + backend
rejects their `PUT`). Owner can remove members (Drive permission + row) and delete
the workspace.

## Security

- Google refresh tokens only on the backend, encrypted at rest.
- Extension holds only the app-session JWT (SecretStorage).
- Secret env values never uploaded (stripped client and server-side).
- `drive.file` scope = least privilege (app touches only its own files).
- Every write/share re-checks role; webhook validates Drive's channel token.

## Edge cases

- **Offline:** queue local changes; push (merge) on reconnect. Local-first always.
- **Token revoked:** backend refresh fails → mark sync-error → prompt re-auth.
- **Member removed mid-edit:** next push `403` → drop sync, keep local copy.
- **Owner deletes workspace:** Drive file trashed + members notified → offer
  "keep a local copy".
- **Watch expiry:** cron renew + periodic poll fallback so sync survives a miss.
- **First sync:** backend creates folder+file at revision 0.
- **Rate limits / large workspace:** debounce + Drive API backoff.

## Testing

- **Backend:** unit — merge-by-id, revision guard, role checks, sharing;
  integration — OAuth stub, Drive API mocked, webhook handling.
- **Extension:** `SyncClient` (mock backend), merge + secret-preservation,
  WS reconnect, sync-state store (vitest, existing patterns).
- **E2E:** two clients + test backend + mocked Drive — A edits → B receives over WS.

## Build order (phased, full scope)

1. Backend skeleton + Google OAuth + JWT + `users`.
2. Drive proxy: folder/file create, push/pull one workspace (owner), panel login
   + sync toggle + `sync-state` store.
3. Realtime: WebSocket + revision + merge-by-id + debounced push/pull.
4. Watch channels + webhook + renewal (outside-edit sync).
5. Sharing: members, roles, Drive permissions + notify, pending memberships,
   viewer read-only enforcement.
6. Polish: offline queue, error toasts, remaining edge cases.

## Open items (decide during planning)

- Backend stack + host (needs a DB, persistent process for watch renewal, public
  HTTPS for the Drive webhook).
- Exact rename policy (rename Drive file vs. keep id-in-name only).
- Whether `hash` folder is per-owner or per-workspace-owner-pair.
