# Drive Sync DS-Phase 6 — manual verification (resilience & edge cases)

Prereq: the serverless backend deployed (or running locally) with a real Google OAuth client; sign in and enable sync on a workspace (earlier phases). Two Google accounts (OWNER, MEMBER) for the share/delete cases.

## A. Token revoked → re-auth prompt
1. Sign in and enable sync on a workspace. Confirm the sidebar account row shows your email.
2. Revoke rrequest's access from your Google account security page (or wait for the 30-day app JWT to expire, or delete `rrequest.syncToken` from SecretStorage to simulate).
3. On the next auto-push / poll tick, the backend's Google refresh fails → returns **401**. Expected in the extension:
   - an error toast: *"Sync sign-in expired — please sign in again."*
   - the account row returns to **"Sign in with Google"** (the stored token + email are cleared).
   - **local data is untouched** — collections/environments remain, editable locally.
4. Click **Sign in with Google** again → OAuth completes → sync resumes; a subsequent edit auto-pushes.

## B. Sync server down / offline → local-first + throttled toast + auto-retry
1. Stop the backend (or disconnect the network).
2. Edit collections/requests in rrequest. Edits **apply locally immediately** (local-first) — nothing is lost or blocked.
3. Within ~15s of a failed push/poll a single throttled toast appears: *"Could not reach the sync server; will retry."* A flurry of failures shows **at most one** such toast per 15s (not one per workspace/attempt).
4. Restart the backend. On the next poll tick / next edit's debounced push, the pending local changes sync up automatically (no manual action, no data lost). No re-auth needed (the JWT is still valid).

## C. Owner deletes a shared workspace → members keep a local copy
1. OWNER shares a synced workspace with MEMBER (editor or viewer); confirm it appears synced in MEMBER's rrequest.
2. OWNER deletes that workspace in rrequest. Expected on the OWNER side: the Drive file is trashed, the workspace + its memberships are removed server-side, and the local workspace is permanently deleted (as before).
3. On MEMBER's next poll/push, the server returns **404** (`SyncGoneError`). Expected in MEMBER's rrequest:
   - an info toast: *"This workspace was deleted by its owner; your local copy was kept."*
   - the workspace is **dropped from sync** (`synced: false`) but the local collections/environments **remain intact and editable** locally.
4. (If MEMBER is a non-owner and somehow triggers a delete: the backend returns 403 → the local delete still proceeds, the sync-delete is a no-op.)

## D. Member removed mid-edit (regression from DS-Phase 5b-core)
1. With MEMBER actively synced (editor) on a workspace, OWNER removes MEMBER.
2. MEMBER's next push returns **403** → sync silently drops (`synced: false`) but the local copy is kept and stays editable. (No toast for this case — it's a role change, not an error.)

## E. Drive rate limit / transient Google error (backend)
Hard to force manually. The backend's `GoogleDriveClient` now retries `429` and `5xx` responses (and network errors) with exponential backoff + jitter, honoring `Retry-After`, up to 4 attempts — so a transient Google Drive rate-limit or blip is absorbed server-side and the client sees a normal success instead of a failure. Verify indirectly: sustained heavy sync activity does not surface spurious "could not reach sync server" toasts caused by Drive throttling.

## Local-first guarantee (applies to all of the above)
No error path — 401, 404, 403, network, 5xx — ever deletes or overwrites the local collections/environments. 401 clears the sign-in and prompts re-auth; 404/403 drop sync but keep the local copy; a transient failure just retries on the next tick. The only intentionally destructive action is an **owner** deleting their **own** workspace.
