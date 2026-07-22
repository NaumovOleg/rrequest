# Drive Sync DS-Phase 5a — manual verification (backend sharing)

Prereq: backend running with a real Google OAuth client + Drive API; two Google accounts (OWNER and MEMBER); OWNER has signed in and enabled sync on a workspace (`w1`).

## A. Share with an existing account
1. As OWNER: `POST /workspaces/w1/members { email: <MEMBER email>, role: "editor" }` (via the extension in 5b, or curl with the OWNER JWT).
2. Confirm Google emails MEMBER (Drive share notification) and the file shows under MEMBER's Drive "Shared with me".
3. As MEMBER (signed in): `GET /workspaces` includes `w1` with `role: "editor"`; `GET /workspaces/w1` returns the snapshot + `role: "editor"`.
4. MEMBER edits + pushes (`PUT /workspaces/w1`) → 200; OWNER's connected client receives `workspace-changed` over WS and pulls.

## B. Viewer is read-only
1. Add a second account as `role: "viewer"`.
2. Viewer `GET /workspaces/w1` → 200 (can read); viewer `PUT /workspaces/w1` → **403**.

## C. Pending invite (no account yet)
1. As OWNER, add `role: "editor"` for an email with no restman account → 201 `{ pending: true }`.
2. That person signs in with the same email (`/auth/start` → consent → `/auth/callback`). Afterwards their `GET /workspaces` includes `w1` (the pending membership resolved to their new user id).

## D. Remove a member
1. As OWNER: `GET /workspaces/w1/members` → owner + members list; `DELETE /workspaces/w1/members/<membershipId>`.
2. The member's Drive permission is revoked and their next `GET/PUT /workspaces/w1` → 403.

## E. Member fan-out
1. With OWNER and a MEMBER both connected via WebSocket, an edit by either (or a Drive outside-edit) broadcasts `workspace-changed` to BOTH — confirm both windows pull.
