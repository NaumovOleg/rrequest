# Drive Sync — DS-Phase 6: Resilience & Edge Cases (re-auth, sync-error toasts, owner-delete, Drive backoff) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> Spec edge cases: `docs/superpowers/specs/2026-07-20-google-drive-workspace-sync-design.md` (`## Edge cases`). Architecture is now serverless (AWS Lambda + Helios + DynamoDB, `docs/superpowers/specs/2026-07-23-aws-lambda-backend-rewrite-design.md`) with client **polling** (no WebSocket).

**Goal:** Finish the sync feature's resilience/edge-case polish: recover gracefully when the app-session JWT expires or the Google refresh token is revoked (re-auth prompt), surface sync failures to the user instead of failing silently (throttled toasts + retry), let an owner delete a synced workspace so members keep a local copy, and make the backend's Drive calls survive Google's rate limits (retry + backoff).

**Architecture:** A typed error taxonomy on the client `SyncClient` — `SyncForbiddenError` (403, exists), new `SyncAuthError` (401 → re-auth) and `SyncGoneError` (404 → workspace deleted). `SyncManager` maps 401→auth-lost (clear token, prompt re-auth), 404→drop-sync-keep-local, and reports any other push/pull failure via an injected `onSyncError` (throttled toast, local data untouched). Backend: `GoogleDriveClient` retries 429/5xx with exponential backoff; a Google refresh failure surfaces as a typed error the controllers map to **401** (not 500); a new owner-only `DELETE /api/workspaces/:id` trashes the Drive file + deletes the workspace row + its memberships. The extension's local workspace-delete of a synced *owned* workspace also calls the sync delete.

**Tech Stack:** Backend (`server/`, Node 18+/22, TS, Helios, DynamoDB, vitest) + extension (`src/`, TS, vitest). All logic TDD'd against fakes (FakeDriveClient, in-memory stores, fake fetch).

## Global Constraints

- **Local-first, always:** no error path (401/404/network/5xx) ever deletes or overwrites local collections/environments. 401 clears the token + prompts re-auth; 404 drops sync but keeps the local copy; a transient failure just retries later. `applyPulled` must never run on an error.
- **Same security posture as before:** owner-only for delete; role checks unchanged; the JWT stays in SecretStorage; the Google refresh token never leaves the backend; secrets never logged.
- **Serverless-current:** no WebSocket (client polls), so "offline/reconnect" = the next poll tick or the next mutation's debounced push retries automatically. Phase 6 adds visibility + typed recovery, not a new transport.
- Reuse: client `SyncClient`/`SyncManager`/`sync-runtime`/`poll-loop`/`hub.toast`/`hub.authState`; backend `GoogleDriveClient`/`WorkspaceService`/`MemberService`/`services/authz`/controllers/`requireUser`.
- Every task ends green + typecheck clean.

---

### Task 1: `GoogleDriveClient` — retry 429/5xx with exponential backoff

**Files:** modify `server/src/domain/drive-client.ts`; test `server/src/domain/drive-client.backoff.test.ts`.

**Interfaces:**
- Produces: `GoogleDriveClient`'s internal fetch is wrapped by a retry helper `fetchWithRetry(input, init, opts?)` — on a `429` or `5xx` response (or a thrown network error), retry up to `maxRetries` (default 4) with exponential backoff (base delay, jitter), honoring a `Retry-After` header when present; give up → return the last response / rethrow. A `2xx`/`4xx` (except 429) returns immediately (no retry). The delay function is injectable (`sleep`) so tests use a fake (no real waiting). `FakeDriveClient` is unchanged.

- [ ] **Step 1: Write the failing test** — `server/src/domain/drive-client.backoff.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { GoogleDriveClient } from "./drive-client";

function res(status: number, body = "{}", headers: Record<string,string> = {}) {
  return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body), headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as any;
}

describe("GoogleDriveClient retry/backoff", () => {
  it("retries a 503 then succeeds, without real delay", async () => {
    const calls: number[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async () => { n++; calls.push(n); return n < 3 ? res(503) : res(200, JSON.stringify({ headRevisionId: "r1" })); });
    const sleep = vi.fn(async () => {});
    const d = new GoogleDriveClient(async () => "tok", fetchImpl as any, { maxRetries: 4, sleep });
    const rev = await d.getHeadRevision("f1");
    expect(rev).toBe("r1");
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 503, 503, 200
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it("does NOT retry a 404 (non-retryable 4xx)", async () => {
    const fetchImpl = vi.fn(async () => res(404));
    const sleep = vi.fn(async () => {});
    const d = new GoogleDriveClient(async () => "tok", fetchImpl as any, { maxRetries: 4, sleep });
    await expect(d.getHeadRevision("f1")).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("gives up after maxRetries on persistent 429", async () => {
    const fetchImpl = vi.fn(async () => res(429));
    const sleep = vi.fn(async () => {});
    const d = new GoogleDriveClient(async () => "tok", fetchImpl as any, { maxRetries: 2, sleep });
    await expect(d.getHeadRevision("f1")).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
```

- [ ] **Step 2: Run → fail** (`cd server && npx vitest run src/domain/drive-client.backoff.test.ts`) — the constructor doesn't accept a 3rd opts arg / no retry.

- [ ] **Step 3: Implement** — extend `GoogleDriveClient`'s constructor to `(getAccessToken, fetchImpl = fetch, opts?: { maxRetries?: number; baseDelayMs?: number; sleep?: (ms:number)=>Promise<void> })`. Add a private `fetchWithRetry(url, init)` used by ALL its methods (getHeadRevision/readFile/updateFile/createFile/ensureFolder/createPermission/deletePermission): call `fetchImpl`; if `res.status === 429 || res.status >= 500` and attempts remain → `await sleep(backoff(attempt, retryAfter))` and retry; else return res. Backoff = `min(baseDelayMs * 2**attempt, cap) + jitter`; honor `Retry-After` seconds if the header is present. On a thrown fetch error (network), also retry. Keep the existing per-method status→throw logic AFTER the retry wrapper returns the final response.

- [ ] **Step 4: Run → pass.** Full server suite + `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** `git commit -m "feat(server): GoogleDriveClient retry+backoff on 429/5xx"`

---

### Task 2: Backend — Google refresh failure → typed 401 (re-auth signal)

**Files:** modify `server/src/domain/drive-factory.ts` (typed error) + `server/src/services/{workspace-service,member-service,poll-service}.ts` + the controllers (map to 401); test `server/src/services/workspace-service.reauth.test.ts`.

**Interfaces:**
- Produces: `class DriveAuthError extends Error` (exported from `drive-factory.ts`; `name='DriveAuthError'`). The `getAccessToken` closure throws `DriveAuthError` when `oauth.getAccessToken()` fails (the refresh token was revoked/expired). `WorkspaceService.pull`/`push`/`enable` + `MemberService.add`/`remove` catch `DriveAuthError` and return `{ status: 401 }`. Controllers already map a service `{status}` to that HTTP code, so a revoked refresh token → the client gets **401** (not 500). `poll-service` swallows it per-item (already per-item try/catch — a revoked owner just gets skipped, logged).

- [ ] **Step 1: Failing test** — `server/src/services/workspace-service.reauth.test.ts`: a `driveFor` that returns a DriveClient whose `readFile`/`updateFile` throw `DriveAuthError`; assert `pull`/`push` return `{ status: 401 }` (not a thrown 500), and local stores untouched (no setRevision). Use in-memory fakes.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — add `DriveAuthError` to `drive-factory.ts`; wrap `oauth.getAccessToken()` so a failure throws `DriveAuthError`. In `WorkspaceService` + `MemberService`, wrap the Drive-calling sections in `try/catch (e) { if (e instanceof DriveAuthError) return { status: 401 }; throw e }`. Confirm the controllers map `{status:401}` → HTTP 401 (they map the discriminated result generically; if 401 isn't in the mapping switch, add it).

- [ ] **Step 4: Run → pass.** Full suite + typecheck clean.

- [ ] **Step 5: Commit** `git commit -m "feat(server): revoked Google refresh token -> 401 (re-auth signal)"`

---

### Task 3: Backend — owner-only `DELETE /api/workspaces/:id` (trash Drive file + rows)

**Files:** modify `server/src/domain/drive-client.ts` (`trashFile`), `server/src/services/workspace-service.ts` (`deleteSync`), `server/src/controllers/workspaces.controller.ts` (route) + `stores/types.ts` if a memberships bulk-delete helper is needed; test `server/src/services/workspace-service.delete.test.ts` + a controller check.

**Interfaces:**
- Produces:
  - `DriveClient.trashFile(fileId): Promise<void>` — `GoogleDriveClient` PATCHes `files/:id` with `{trashed:true}` (or DELETE); `FakeDriveClient` removes it from its map + a `trashed(fileId): boolean` test helper.
  - `WorkspaceService.deleteSync(user, id): Promise<{ ok: true } | { status: 403 | 404 }>` — 404 unknown; non-owner → 403; else `ownerDriveFor.trashFile(driveFileId)` (best-effort), delete all memberships for the workspace (`memberships.listByWorkspace` → `remove` each), delete the workspace row (add `WorkspaceStore.delete(id)` — Dynamo `DeleteCommand` + memory fake + a `MembershipStore.removeByWorkspace(id)` OR loop). Return `{ok:true}`.
  - `WorkspacesController.delete(@Param id, @Req req)` — `requireUser`; map `deleteSync` result (403/404 → those codes; ok → `{ok:true}`).
  - Add `WorkspaceStore.delete(id): Promise<void>` to the interface + Dynamo + memory impls (Dynamo `DeleteCommand`; dynalite-tested).

- [ ] **Step 1: Failing tests** — `workspace-service.delete.test.ts`: owner deletes → workspace row gone + its memberships gone + Drive file trashed (`fakeDrive.trashed(fileId)`), returns `{ok:true}`; non-owner → 403 (row + file intact); unknown → 404. Plus extend the Dynamo workspace-store test with `delete`. Plus (if added) membership bulk removal.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — `trashFile` (Google + Fake), `WorkspaceStore.delete` (interface + dynamo `DeleteCommand` + memory), `deleteSync` in WorkspaceService (owner guard → trash file best-effort → remove memberships → delete row), the controller route (`@Delete('/:id')`). Confirm Helios `@Delete` decorator + route registration match the existing member DELETE route pattern.

- [ ] **Step 4: Run → pass.** Full suite (incl. dynalite delete) + typecheck clean.

- [ ] **Step 5: Commit** `git commit -m "feat(server): owner DELETE /workspaces/:id (trash Drive file + memberships + row)"`

---

### Task 4: Client `SyncClient` — `SyncAuthError` (401) + `SyncGoneError` (404) + `deleteWorkspace`

**Files:** modify `src/extension/sync/sync-client.ts`; test `test/extension/sync/sync-client.test.ts` (extend).

**Interfaces:**
- Produces:
  - `class SyncAuthError extends Error` (401) + `class SyncGoneError extends Error` (404), exported.
  - `SyncClient.call` + `push`: on `401` throw `SyncAuthError`; on `404` throw `SyncGoneError`; (403 stays `SyncForbiddenError`; other non-2xx generic). Order: 401 → 403 → 404 → generic.
  - `SyncClient.deleteWorkspace(id): Promise<void>` — `DELETE /workspaces/:id` (the sync delete; ok/2xx → void; 403 → SyncForbiddenError; 404 → SyncGoneError).

- [ ] **Step 1: Failing tests** — extend `sync-client.test.ts` (using the existing `fetchMock`/`client` helpers): a 401 on pull → `rejects toBeInstanceOf(SyncAuthError)`; a 404 on pull → `SyncGoneError`; `deleteWorkspace('w1')` DELETEs the right URL; a 401 on push → `SyncAuthError`.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — add the two error classes; in `call` add `if (res.status===401) throw new SyncAuthError(); if (res.status===404) throw new SyncGoneError();` before the generic throw (403 already handled); same 401/404 branches in `push`; add `deleteWorkspace`.

- [ ] **Step 4: Run → pass.** `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** `git commit -m "feat(sync): SyncClient SyncAuthError/SyncGoneError + deleteWorkspace"`

---

### Task 5: `SyncManager` — 401 auth-lost, 404 keep-local, `onSyncError` reporting

**Files:** modify `src/extension/sync/sync-manager.ts`; test `test/extension/sync/sync-manager.test.ts` (extend).

**Interfaces:**
- Consumes: `SyncAuthError`/`SyncGoneError`/`SyncForbiddenError` from `./sync-client`.
- Produces: `SyncManager` deps gain optional `onAuthLost?: () => void | Promise<void>` and `onSyncError?: (workspaceId: string, error: unknown) => void`. In `push`/`pull` (and `refreshRoles`):
  - `SyncForbiddenError` → `dropSync` (exists, keep-local).
  - `SyncGoneError` → `dropSync` + `onSyncError(id, gone)` (workspace deleted server-side → keep local copy, tell the user). (dropSync keeps local data.)
  - `SyncAuthError` → `await onAuthLost?.()` and return (do NOT dropSync per-workspace — it's an account-wide auth loss). NEVER touch local stores.
  - any other error → `onSyncError?.(id, e)` and return (do NOT rethrow — the scheduler/poll must not crash; local data untouched, retried next tick). (This replaces today's `throw e` on non-403.)
- `deleteSync(workspaceId)` — calls `client.deleteWorkspace(id)` then `dropSync` locally; tolerates `SyncGoneError` (already gone).

- [ ] **Step 1: Failing tests** — extend `sync-manager.test.ts`: push throws `SyncGoneError` → `synced:false` + `onSyncError` called + `applyPulled` NOT called; push throws `SyncAuthError` → `onAuthLost` called + state.synced still true (auth loss isn't a per-workspace drop) + no store touch; push throws a generic Error → `onSyncError` called + NOT rethrown + no store touch; `deleteSync` calls `client.deleteWorkspace` + drops sync.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — thread `onAuthLost`/`onSyncError` through the deps; extend the `catch` blocks in `push`/`pull`/`refreshRoles` with the taxonomy above (SyncForbidden→dropSync; SyncGone→dropSync+onSyncError; SyncAuth→onAuthLost; else→onSyncError, no rethrow); add `deleteSync`.

- [ ] **Step 4: Run → pass.** Typecheck clean.

- [ ] **Step 5: Commit** `git commit -m "feat(sync): SyncManager 401 re-auth / 404 keep-local / onSyncError (no silent fail)"`

---

### Task 6: Host wiring — re-auth prompt, sync-error toasts (throttled), owner-delete calls sync

**Files:** modify `src/extension/panel.ts` (wire `onAuthLost`/`onSyncError` into the SyncManager; call `deleteSync` on workspace delete); `src/extension/messaging.ts` (deleteWorkspace → also sync-delete if owned+synced); test `test/extension/sync/sync-error-throttle.test.ts` (pure throttle helper).

**Interfaces:**
- Produces:
  - `panel.ts`: construct the SyncManager with `onAuthLost` = clear the cached token + `context.secrets.delete('restman.syncToken')` + `hub.authState(null)` + `hub.toast('error', 'Sync sign-in expired — please sign in again.')`; and `onSyncError` = a **throttled** toast (`makeToastThrottle(hub, intervalMs=15000)` → at most one sync-error toast per interval: `'Could not reach the sync server; will retry.'` for network/5xx, or the SyncGone message `'This workspace was deleted by its owner; your local copy was kept.'` when the error is a `SyncGoneError`).
  - `makeToastThrottle(emit, intervalMs)` (pure, in a small `src/extension/sync/toast-throttle.ts`) — returns `(level, message) => void` that drops repeats within the window; unit-tested with fake timers.
  - Workspace delete: when the user deletes a workspace that is locally **synced and owned**, the host also calls `syncManager.deleteSync(id)` (trash the Drive file + server rows) BEFORE/alongside the local permanent delete. Wire this where `deleteWorkspace` is handled (messaging router or panel) — read how delete flows today; call `deleteSync` best-effort (a failure still lets the local delete proceed, with an `onSyncError` toast).

- [ ] **Step 1: Failing test** — `test/extension/sync/sync-error-throttle.test.ts` (fake timers): `makeToastThrottle(emit, 15000)`; two calls within 15s → `emit` called ONCE; a call after 15s → called again; a different message within the window → still throttled to one (or keyed by message — pick one; the test asserts the chosen behavior).

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `toast-throttle.ts` + wire `onAuthLost`/`onSyncError` in `panel.ts` (using it) + the owner-delete→`deleteSync` call in the delete flow. `npx tsc --noEmit` + `npm run build`.

- [ ] **Step 4: Run → pass.** Full extension suite + build ok.

- [ ] **Step 5: Commit** `git commit -m "feat(sync): re-auth prompt + throttled sync-error toasts + owner-delete trashes synced workspace"`

---

### Task 7: Manual verification doc

**Files:** create `docs/sync-phase-6-verification.md`.

- [ ] **Step 1: Write the runbook** — covering: (A) **Token revoked** — revoke access in the Google account security page (or wait out the JWT) → next sync → 401 → re-auth toast + account row returns to "Sign in"; sign in again resumes. (B) **Sync server down / offline** — stop the backend → edits stay local (local-first), a throttled "could not reach sync server" toast appears, and on backend restart the next poll/push catches up; no data lost. (C) **Owner deletes a shared workspace** — owner deletes a synced workspace → Drive file trashed + members' next poll gets 404 → members see "deleted by owner; local copy kept" and keep their data (sync dropped). (D) **Drive rate limit** — (hard to force manually) note that the backend retries 429/5xx with backoff. (E) **Member removed mid-edit** — (regression from 5b-core) next push 403 → drop sync, keep local.

- [ ] **Step 2: Commit** `git commit -m "docs: Drive sync phase 6 verification"`

---

## Self-Review

**Spec edge-case coverage (`## Edge cases`):**
- Offline: local-first (unchanged) + non-fatal errors now surfaced (throttled toast) + auto-retry on next poll/mutation → Tasks 5-6. ✓
- Token revoked → mark sync-error + prompt re-auth → Task 2 (backend 401) + Tasks 4-6 (client SyncAuthError → onAuthLost → clear token + re-auth toast). ✓
- Member removed mid-edit → 403 drop-sync-keep-local → already done (5b-core), re-verified in the runbook. ✓
- Owner deletes workspace → Drive file trashed + members keep a local copy → Task 3 (backend delete) + Tasks 4-6 (client 404 SyncGoneError → keep-local + toast; owner-delete calls deleteSync). ✓
- Watch expiry → N/A (WebSocket/watch removed; poll replaced it). Noted.
- First sync → already done (enable creates the file). ✓
- Rate limits / Drive backoff → Task 1 (GoogleDriveClient retry+backoff); debounce already exists (P3). ✓

**Placeholder scan:** every task has full TDD code or exact interface + the pattern to mirror (Helios `@Delete` route mirrors the existing member DELETE; SyncManager catch-taxonomy mirrors the existing 403 handling). Host wiring (Task 6 panel.ts) is integration — the throttle helper is unit-tested, the wiring verified by build + the Task 7 runbook.

**Type consistency:** `SyncAuthError`/`SyncGoneError` (Task 4) consumed by `SyncManager` (Task 5) + wired in panel (Task 6). `DriveAuthError` (Task 2, server) mapped to 401 by controllers → the client sees 401 → `SyncAuthError`. `DriveClient.trashFile` + `WorkspaceStore.delete` + `WorkspaceService.deleteSync` + the DELETE route (Task 3) consumed by `SyncClient.deleteWorkspace` (Task 4) → `SyncManager.deleteSync` (Task 5) → owner-delete flow (Task 6). `onAuthLost`/`onSyncError`/`makeToastThrottle` names consistent across Tasks 5-6.

**Local-first / safety:** every new error path (401/404/network/5xx) is asserted to NOT call `applyPulled` and to keep `sync-state`/local stores intact (401 keeps synced flag; 404 drops synced but keeps data; generic keeps everything + retries). Owner-delete is the ONLY new destructive path and it's owner-only + trashes (not hard-deletes) the Drive file, and members keep their local copy.

**Integration risk called out:** the backend `@Delete` route + refresh-fail→401 controller mapping, and the panel.ts re-auth/toast/owner-delete wiring, aren't unit-tested against live Lambda/VS Code — the services, stores, error taxonomy, and throttle helper ARE unit-tested; the end-to-end (revoke → re-auth, backend-down → toast, owner-delete → members keep local) is the Task 7 manual runbook. Confirm the Helios `@Delete` decorator + controller `{status:401}` mapping during Task 2/3 by reading the existing controllers.
