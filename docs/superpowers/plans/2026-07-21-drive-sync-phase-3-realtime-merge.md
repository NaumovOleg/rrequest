# Drive Sync — Phase 3: Realtime + Revision-Conflict Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workspace sync near-real-time and conflict-safe: pushes carry a base revision (409 on a stale write), the extension merges by id and retries, and a change pushed by one client is relayed over a WebSocket to the owner's other connected clients, which pull automatically. Local edits auto-push (debounced).

**Architecture:** Backend gains a `Realtime` relay (in-memory subscriptions) and a `ws` WebSocketServer attached to Fastify's HTTP server (JWT-authed on connect); `PUT /workspaces/:id` gains an optimistic-concurrency guard (409 returns the current snapshot+revision) and broadcasts `workspace-changed` on success. The extension gains a pure `mergeSnapshots` (merge-by-id), a conflict-aware `SyncClient.push`, a `SyncSocket` client, and — the key integration — the sync runtime moves into `panel.ts`'s bootstrap so it shares the router's stores + Hub: the router signals mutations (debounced auto-push) and incoming `workspace-changed` events pull then re-broadcast the Hub snapshot so open webviews refresh. This also retires the Phase-2 two-store-instances wart.

**Tech Stack:** Backend — Node 18+, TypeScript, Fastify, `ws`, vitest. Extension — existing restman stack (TypeScript, `ws`, vitest), VS Code API.

## Global Constraints

- Reuse Phase-1/2 rules: Node **>= 18**, TypeScript, ESM in `server/`; all Google-facing calls on the backend; the extension holds only the app-session JWT (VS Code SecretStorage); Phase 3 stays **owner-only** (sharing is Phase 5) — so "other clients" means the same owner on other machines/windows.
- **Optimistic concurrency:** `PUT /workspaces/:id` takes `{ snapshot, baseRevision }`. If `baseRevision !== ws.revision`, respond **409** with `{ snapshot: <current remote>, revision: <current> }` and do NOT write. On match, write, bump revision, broadcast.
- **Merge policy (documented, MVP):** merge-by-id = start from **remote**, then add any **local-only** items (by id) at each level (collections, folders, requests, environments, env-vars). Remote wins on a same-id field clash. Deletions are **not** propagated across a conflict (no base snapshot is tracked → safe, never destructive). A base-tracked 3-way merge is a later enhancement.
- Realtime relay is in-memory + single-instance (fine for Phase 3); no Drive watch/webhooks yet (that's Phase 4).
- WebSocket auth: the client connects with the JWT as a `?token=` query param; the server verifies it on `connection` and closes the socket if invalid.
- Backend code under `server/`; extension code under `src/`. Reuse existing types from `src/shared/types.ts` and the Phase-2 `src/extension/sync/*` modules.
- **Deferred-from-Phase-2 fixes folded in here:** `SyncManager.push` currently sends the workspace **id** as the snapshot `name`; Phase 3 threads the **real name** through (Task 6). `applyPulled` remains union-only (documented above).

---

### Task 1: Add `ws` dependency + `Realtime` relay (backend)

**Files:**
- Modify: `server/package.json` (add `ws` + `@types/ws`)
- Create: `server/src/realtime.ts`
- Test: `server/src/realtime.test.ts`

**Interfaces:**
- Consumes: nothing (the relay is transport-agnostic — it stores `send` callbacks).
- Produces:
  - `type ChangeMsg = { type: 'workspace-changed'; workspaceId: string; revision: string; updatedBy: string }`
  - `class Realtime { register(connId: string, userId: string, workspaceIds: string[], send: (m: ChangeMsg) => void): () => void; broadcast(workspaceId: string, msg: ChangeMsg, exceptConnId?: string): void }`
  - `register` returns an unregister function. `broadcast` sends to every connection subscribed to `workspaceId` except `exceptConnId`.

- [ ] **Step 1: Add deps to `server/package.json`**

In `dependencies` add `"ws": "^8.18.0"`; in `devDependencies` add `"@types/ws": "^8.5.10"`.

- [ ] **Step 2: Install**

Run: `cd server && npm install`
Expected: installs `ws` + types.

- [ ] **Step 3: Write the failing test** — `server/src/realtime.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { Realtime, type ChangeMsg } from "./realtime";

const msg = (over: Partial<ChangeMsg> = {}): ChangeMsg => ({ type: "workspace-changed", workspaceId: "w1", revision: "2", updatedBy: "a@x.com", ...over });

describe("Realtime", () => {
  it("broadcasts to subscribers of a workspace, excluding the sender", () => {
    const r = new Realtime();
    const a = vi.fn(), b = vi.fn(), c = vi.fn();
    r.register("cA", "u1", ["w1"], a);
    r.register("cB", "u1", ["w1"], b);
    r.register("cC", "u1", ["w2"], c);
    r.broadcast("w1", msg(), "cA");
    expect(a).not.toHaveBeenCalled();     // excluded sender
    expect(b).toHaveBeenCalledWith(msg());
    expect(c).not.toHaveBeenCalled();     // different workspace
  });
  it("stops delivering after unregister", () => {
    const r = new Realtime();
    const b = vi.fn();
    const off = r.register("cB", "u1", ["w1"], b);
    off();
    r.broadcast("w1", msg());
    expect(b).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd server && npx vitest run src/realtime.test.ts`
Expected: FAIL — cannot find module `./realtime`.

- [ ] **Step 5: Implement `server/src/realtime.ts`**

```ts
export type ChangeMsg = { type: "workspace-changed"; workspaceId: string; revision: string; updatedBy: string };

type Conn = { userId: string; workspaceIds: Set<string>; send: (m: ChangeMsg) => void };

export class Realtime {
  private conns = new Map<string, Conn>();

  register(connId: string, userId: string, workspaceIds: string[], send: (m: ChangeMsg) => void): () => void {
    this.conns.set(connId, { userId, workspaceIds: new Set(workspaceIds), send });
    return () => { this.conns.delete(connId); };
  }

  broadcast(workspaceId: string, msg: ChangeMsg, exceptConnId?: string): void {
    for (const [id, conn] of this.conns) {
      if (id === exceptConnId) continue;
      if (conn.workspaceIds.has(workspaceId)) conn.send(msg);
    }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd server && npx vitest run src/realtime.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add server/package.json server/package-lock.json server/src/realtime.ts server/src/realtime.test.ts
git commit -m "feat(server): Realtime relay + ws dependency"
```

---

### Task 2: Revision guard on `PUT /workspaces/:id` + broadcast

**Files:**
- Modify: `server/src/app.ts` (add `realtime` to `AppDeps`; rewrite `PUT` handler)
- Test: `server/src/app.workspaces-conflict.test.ts`

**Interfaces:**
- Consumes: `Realtime` from `./realtime`, existing `requireUser`, `deps.workspaces`, `deps.driveFor`.
- Produces: `AppDeps` gains `realtime: Realtime`. `PUT /workspaces/:id` body is now `{ snapshot: string; baseRevision: string }`:
  - unknown → 404; not owner → 403; `baseRevision !== ws.revision` → **409** `{ snapshot: <current Drive snapshot>, revision: ws.revision }`; else write Drive, `setRevision`, `realtime.broadcast(id, {type:'workspace-changed', workspaceId:id, revision, updatedBy: user.email}, undefined)`, return `{ revision }`.

- [ ] **Step 1: Write the failing test** — `server/src/app.workspaces-conflict.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";
import { signSession } from "./jwt";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback" };
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "cid");

async function seeded() {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "g", email: "o@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const drive = new FakeDriveClient();
  const realtime = new Realtime();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime });
  const token = signSession(owner.id, "j");
  await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${token}` }, payload: { workspaceId: "ws1", name: "T", snapshot: '{"v":1}' } });
  return { app, token, workspaces, realtime };
}

describe("PUT /workspaces/:id revision guard", () => {
  it("writes and bumps when baseRevision matches, and broadcasts", async () => {
    const { app, token, workspaces, realtime } = await seeded();
    const heard = vi.fn();
    realtime.register("other", "u2", ["ws1"], heard);
    const res = await app.inject({ method: "PUT", url: "/workspaces/ws1", headers: { authorization: `Bearer ${token}` }, payload: { snapshot: '{"v":2}', baseRevision: "1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().revision).toBe("2");
    expect(workspaces.get("ws1")?.revision).toBe("2");
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ type: "workspace-changed", workspaceId: "ws1", revision: "2" }));
  });
  it("409s with the current snapshot + revision when baseRevision is stale", async () => {
    const { app, token } = await seeded();
    // first push moves revision 1 -> 2
    await app.inject({ method: "PUT", url: "/workspaces/ws1", headers: { authorization: `Bearer ${token}` }, payload: { snapshot: '{"v":2}', baseRevision: "1" } });
    // second push with the now-stale base "1"
    const res = await app.inject({ method: "PUT", url: "/workspaces/ws1", headers: { authorization: `Bearer ${token}` }, payload: { snapshot: '{"v":3}', baseRevision: "1" } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ snapshot: '{"v":2}', revision: "2" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/app.workspaces-conflict.test.ts`
Expected: FAIL — `AppDeps` has no `realtime`; PUT ignores `baseRevision`.

- [ ] **Step 3: Extend `AppDeps` + rewrite the `PUT` handler in `server/src/app.ts`**

Add the import at the top:

```ts
import type { Realtime } from "./realtime.js";
```

Add to the `AppDeps` type:

```ts
  realtime: Realtime;
```

Replace the existing `app.put("/workspaces/:id", …)` handler with:

```ts
  app.put("/workspaces/:id", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const id = (req.params as { id: string }).id;
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    if (ws.ownerUserId !== user.id) return reply.code(403).send({ error: "forbidden" });
    const { snapshot, baseRevision } = req.body as { snapshot?: string; baseRevision?: string };
    if (typeof snapshot !== "string" || typeof baseRevision !== "string") return reply.code(400).send({ error: "snapshot + baseRevision required" });
    const drive = deps.driveFor(user);
    if (baseRevision !== ws.revision) {
      const current = await drive.readFile(ws.driveFileId);
      return reply.code(409).send({ snapshot: current, revision: ws.revision });
    }
    const clean = stripSnapshotSecrets(snapshot);
    const { revision } = await drive.updateFile(ws.driveFileId, clean);
    deps.workspaces.setRevision(id, revision, Date.now());
    deps.realtime.broadcast(id, { type: "workspace-changed", workspaceId: id, revision, updatedBy: user.email });
    return { revision };
  });
```

(`stripSnapshotSecrets` already exists in `app.ts` from the Phase-2 fix.)

- [ ] **Step 4: Update the other app test files to supply `realtime`**

Every `buildApp({...})` call must now include `realtime`. In `server/src/app.health.test.ts`, `app.auth.test.ts`, `app.me.test.ts`, `app.workspaces-create.test.ts`, and `app.workspaces-rw.test.ts`: add `import { Realtime } from "./realtime";` and add `realtime: new Realtime(),` to each `buildApp({...})` deps object.

Additionally, in `app.workspaces-rw.test.ts`, the existing `PUT` test payloads must add `baseRevision`. The seeded workspace is created at revision `"1"`; change its PUT injects from `payload: { snapshot: '{"v":2}' }` to `payload: { snapshot: '{"v":2}', baseRevision: "1" }` (and if a test pushes twice, use the revision returned by the previous push as the next `baseRevision`).

- [ ] **Step 5: Run the full backend suite**

Run: `cd server && npx vitest run`
Expected: PASS — all suites green including the new conflict test (2) and the updated rw test.

- [ ] **Step 6: Commit**

```bash
git add server/src/app.ts server/src/app.workspaces-conflict.test.ts server/src/app.health.test.ts server/src/app.auth.test.ts server/src/app.me.test.ts server/src/app.workspaces-create.test.ts server/src/app.workspaces-rw.test.ts
git commit -m "feat(server): PUT revision guard (409) + realtime broadcast"
```

---

### Task 3: WebSocket server + wire into entry

**Files:**
- Create: `server/src/ws-server.ts`
- Modify: `server/src/server.ts` (construct `Realtime`, attach the WS server, pass `realtime` to `buildApp`)
- Test: `server/src/ws-server.test.ts`

**Interfaces:**
- Consumes: `WebSocketServer` from `ws`, `verifySession` from `./jwt`, `WorkspaceStore`, `Realtime`, Node `http.Server`.
- Produces:
  - `subscriptionsFor(userId, workspaces): string[]` — the workspace ids a connection should hear about (Phase 3 = the ids owned by the user).
  - `attachWsServer(opts: { server: http.Server; jwtSecret: string; workspaces: WorkspaceStore; realtime: Realtime }): void` — on each connection, read `?token=`, verify it, register the connection with `realtime` for the user's workspace ids, and unregister on close. Invalid token → close.

- [ ] **Step 1: Write the failing test** — `server/src/ws-server.test.ts` (tests the pure subscription helper)

```ts
import { describe, it, expect } from "vitest";
import { subscriptionsFor } from "./ws-server";
import { WorkspaceStore } from "./workspace-store";

describe("subscriptionsFor", () => {
  it("returns the workspace ids owned by the user", () => {
    const ws = new WorkspaceStore(":memory:");
    ws.upsert({ id: "a", name: "A", ownerUserId: "u1", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    ws.upsert({ id: "b", name: "B", ownerUserId: "u2", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    ws.upsert({ id: "c", name: "C", ownerUserId: "u1", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    expect(subscriptionsFor("u1", ws).sort()).toEqual(["a", "c"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/ws-server.test.ts`
Expected: FAIL — cannot find module `./ws-server`.

- [ ] **Step 3: Implement `server/src/ws-server.ts`**

```ts
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { verifySession } from "./jwt.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { Realtime, ChangeMsg } from "./realtime.js";

export function subscriptionsFor(userId: string, workspaces: WorkspaceStore): string[] {
  return workspaces.listByOwner(userId).map((w) => w.id);
}

let seq = 0;

export function attachWsServer(opts: { server: Server; jwtSecret: string; workspaces: WorkspaceStore; realtime: Realtime }): void {
  const wss = new WebSocketServer({ server: opts.server, path: "/ws" });
  wss.on("connection", (socket: WebSocket, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token") ?? "";
    const session = verifySession(token, opts.jwtSecret);
    if (!session) { socket.close(4001, "unauthorized"); return; }
    const connId = `c${++seq}`;
    const off = opts.realtime.register(connId, session.userId, subscriptionsFor(session.userId, opts.workspaces), (m: ChangeMsg) => {
      try { socket.send(JSON.stringify(m)); } catch { /* socket closing */ }
    });
    socket.on("close", off);
    socket.on("error", off);
  });
}
```

- [ ] **Step 4: Run the subscription test to verify it passes**

Run: `cd server && npx vitest run src/ws-server.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Wire into `server/src/server.ts`**

Add imports:

```ts
import { Realtime } from "./realtime.js";
import { attachWsServer } from "./ws-server.js";
```

Construct the relay before `buildApp` and pass it in:

```ts
const realtime = new Realtime();
```

Add `realtime` to the `buildApp({...})` deps object. Then, after `app.listen(...)` resolves, attach the WS server to Fastify's underlying HTTP server. Replace the existing `app.listen(...).then(...)` block with:

```ts
app.listen({ port: config.port, host: "0.0.0.0" })
  .then((addr) => {
    attachWsServer({ server: app.server, jwtSecret: config.jwtSecret, workspaces, realtime });
    console.log(`restman sync server on ${addr}`);
  })
  .catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 6: Typecheck + full suite**

Run: `cd server && npm run typecheck && npx vitest run`
Expected: typecheck clean; all suites pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/ws-server.ts server/src/server.ts server/src/ws-server.test.ts
git commit -m "feat(server): JWT-authed WebSocket relay attached to http server"
```

---

### Task 4: `mergeSnapshots` (extension, pure merge-by-id)

**Files:**
- Create: `src/extension/sync/merge.ts`
- Test: `test/extension/sync/merge.test.ts`

**Interfaces:**
- Consumes: `WorkspaceSnapshot` from `./snapshot`; `Collection`, `Folder`, `CollectionItem`, `Environment` from `src/shared/types`.
- Produces:
  - `mergeSnapshots(remote: WorkspaceSnapshot, local: WorkspaceSnapshot): WorkspaceSnapshot` — remote as the base; add local-only collections (by id); for collections in both, add local-only folders (by id) + merge each shared folder's local-only requests + add local-only root requests; add local-only environments (by id) + local-only env vars (by key). Remote wins for any shared id/key. The result keeps remote's `revision`-related metadata (`updatedAt`, `updatedBy`, `workspaceId`, `name` from remote).

- [ ] **Step 1: Write the failing test** — `test/extension/sync/merge.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { mergeSnapshots } from '../../../src/extension/sync/merge'
import type { WorkspaceSnapshot } from '../../../src/extension/sync/snapshot'

const req = (id: string, name = id) => ({ id, name, method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } })
const snap = (over: Partial<WorkspaceSnapshot>): WorkspaceSnapshot => ({ version: 1, workspaceId: 'w1', name: 'W', collections: [], environments: [], updatedAt: 1, updatedBy: 'r', ...over })

describe('mergeSnapshots', () => {
  it('adds local-only collections and keeps remote metadata', () => {
    const remote = snap({ collections: [{ id: 'c1', name: 'C1', workspaceId: 'w1', requests: [] }], updatedBy: 'remote' })
    const local = snap({ collections: [{ id: 'c2', name: 'C2', workspaceId: 'w1', requests: [] }], updatedBy: 'local' })
    const merged = mergeSnapshots(remote, local)
    expect(merged.collections.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
    expect(merged.updatedBy).toBe('remote')
  })
  it('merges local-only requests into a shared collection/folder, remote wins on shared ids', () => {
    const remote = snap({ collections: [{ id: 'c1', name: 'C1', workspaceId: 'w1', requests: [req('r1', 'remote-name')], folders: [{ id: 'f1', name: 'F', requests: [req('rf1')] }] }] })
    const local = snap({ collections: [{ id: 'c1', name: 'C1', workspaceId: 'w1', requests: [req('r1', 'local-name'), req('r2')], folders: [{ id: 'f1', name: 'F', requests: [req('rf2')] }] }] })
    const merged = mergeSnapshots(remote, local)
    const c1 = merged.collections.find((c) => c.id === 'c1')!
    expect(c1.requests.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    expect(c1.requests.find((r) => r.id === 'r1')!.name).toBe('remote-name') // remote wins
    expect(c1.folders![0].requests.map((r) => r.id).sort()).toEqual(['rf1', 'rf2'])
  })
  it('merges local-only environments and env vars', () => {
    const env = (id: string, vars: any[]) => ({ id, name: id, workspaceId: 'w1', variables: vars })
    const remote = snap({ environments: [env('e1', [{ key: 'a', value: '1', enabled: true }])] })
    const local = snap({ environments: [env('e1', [{ key: 'a', value: 'X', enabled: true }, { key: 'b', value: '2', enabled: true }]), env('e2', [])] })
    const merged = mergeSnapshots(remote, local)
    expect(merged.environments.map((e) => e.id).sort()).toEqual(['e1', 'e2'])
    const e1 = merged.environments.find((e) => e.id === 'e1')!
    expect(e1.variables.find((v) => v.key === 'a')!.value).toBe('1')   // remote wins
    expect(e1.variables.find((v) => v.key === 'b')!.value).toBe('2')   // local-only added
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/sync/merge.test.ts`
Expected: FAIL — cannot find module `.../merge`.

- [ ] **Step 3: Implement `src/extension/sync/merge.ts`**

```ts
import type { Collection, Folder, CollectionItem, Environment } from '../../shared/types'
import type { WorkspaceSnapshot } from './snapshot'

function addMissingRequests(target: CollectionItem[], local: CollectionItem[]): void {
  for (const r of local) if (!target.some((x) => x.id === r.id)) target.push(r)
}

function mergeFolders(remote: Folder[], local: Folder[]): Folder[] {
  const out = remote.map((f) => ({ ...f, requests: [...f.requests] }))
  for (const lf of local) {
    const rf = out.find((f) => f.id === lf.id)
    if (!rf) out.push({ ...lf, requests: [...lf.requests] })
    else addMissingRequests(rf.requests, lf.requests)
  }
  return out
}

function mergeCollections(remote: Collection[], local: Collection[]): Collection[] {
  const out = remote.map((c) => ({ ...c, requests: [...c.requests], folders: [...(c.folders ?? [])] }))
  for (const lc of local) {
    const rc = out.find((c) => c.id === lc.id)
    if (!rc) { out.push({ ...lc, requests: [...lc.requests], folders: [...(lc.folders ?? [])] }); continue }
    addMissingRequests(rc.requests, lc.requests)
    rc.folders = mergeFolders(rc.folders ?? [], lc.folders ?? [])
  }
  return out
}

function mergeEnvironments(remote: Environment[], local: Environment[]): Environment[] {
  const out = remote.map((e) => ({ ...e, variables: [...e.variables] }))
  for (const le of local) {
    const re = out.find((e) => e.id === le.id)
    if (!re) { out.push({ ...le, variables: [...le.variables] }); continue }
    for (const lv of le.variables) if (!re.variables.some((v) => v.key === lv.key)) re.variables.push(lv)
  }
  return out
}

export function mergeSnapshots(remote: WorkspaceSnapshot, local: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...remote,
    collections: mergeCollections(remote.collections, local.collections),
    environments: mergeEnvironments(remote.environments, local.environments),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/sync/merge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/sync/merge.ts test/extension/sync/merge.test.ts
git commit -m "feat(sync): mergeSnapshots (merge-by-id, remote-wins)"
```

---

### Task 5: Conflict-aware `SyncClient.push`

**Files:**
- Modify: `src/extension/sync/sync-client.ts` (change `push` signature + return)
- Test: `test/extension/sync/sync-client.test.ts` (update the push test + add a conflict test)

**Interfaces:**
- Consumes: existing `SyncClient.call` internals.
- Produces: `type PushResult = { ok: true; revision: string } | { ok: false; conflict: true; snapshot: string; revision: string }`. `push(id: string, snapshot: string, baseRevision: string): Promise<PushResult>` — POSTs `{ snapshot, baseRevision }`; on **409** returns `{ ok:false, conflict:true, snapshot, revision }` (from the body); on 2xx returns `{ ok:true, revision }`; other non-2xx still throws.

- [ ] **Step 1: Update the push test + add a conflict test** — `test/extension/sync/sync-client.test.ts`

Replace the existing `push` test with:

```ts
  it('push PUTs {snapshot, baseRevision} and returns ok on 200', async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe('http://localhost:8787/workspaces/w1')
      expect(init.method).toBe('PUT')
      expect(JSON.parse(init.body)).toEqual({ snapshot: '{"v":2}', baseRevision: '1' })
      return { status: 200, body: { revision: '2' } }
    })
    expect(await client(f).push('w1', '{"v":2}', '1')).toEqual({ ok: true, revision: '2' })
  })
  it('push returns a conflict object on 409', async () => {
    const f = fetchMock(() => ({ status: 409, body: { snapshot: '{"v":9}', revision: '5' } }))
    expect(await client(f).push('w1', '{"v":2}', '1')).toEqual({ ok: false, conflict: true, snapshot: '{"v":9}', revision: '5' })
  })
```

(Leave the other tests as-is except: the "throws on a non-2xx response" test calls `push('w1','{}')` — update it to `push('w1','{}','1')` and keep expecting it to throw on 403.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/sync/sync-client.test.ts`
Expected: FAIL — `push` has the old signature/return.

- [ ] **Step 3: Update `push` in `src/extension/sync/sync-client.ts`**

Add the result type near the top (after `RemoteWorkspace`):

```ts
export type PushResult =
  | { ok: true; revision: string }
  | { ok: false; conflict: true; snapshot: string; revision: string }
```

Replace the `push` method with a version that inspects the 409 without letting `call` throw:

```ts
  async push(id: string, snapshot: string, baseRevision: string): Promise<PushResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/workspaces/${id}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${this.getToken() ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot, baseRevision }),
    })
    if (res.status === 409) {
      const body = (await res.json()) as { snapshot: string; revision: string }
      return { ok: false, conflict: true, snapshot: body.snapshot, revision: body.revision }
    }
    if (!res.ok) throw new Error(`sync request failed: ${res.status}`)
    const body = (await res.json()) as { revision: string }
    return { ok: true, revision: body.revision }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/sync/sync-client.test.ts`
Expected: PASS (all, including the conflict test).

- [ ] **Step 5: Commit**

```bash
git add src/extension/sync/sync-client.ts test/extension/sync/sync-client.test.ts
git commit -m "feat(sync): SyncClient.push carries baseRevision + returns conflict"
```

---

### Task 6: `SyncManager` conflict merge + real workspace name

**Files:**
- Modify: `src/extension/sync/sync-manager.ts`
- Test: `test/extension/sync/sync-manager.test.ts` (update push tests + add a conflict test)

**Interfaces:**
- Consumes: updated `SyncClient.push` (Task 5), `mergeSnapshots` (Task 4), existing `StoresPort` + `SyncStateStore` + snapshot fns.
- Produces:
  - `StoresPort` gains `getName(workspaceId: string): Promise<string>` (the human workspace name for the snapshot).
  - `push(workspaceId)`: no-op unless synced → build snapshot with the real name → `client.push(id, snapshot, state.lastRevision)`. On `ok` → update `lastRevision`. On `conflict` → parse the returned remote snapshot, `mergeSnapshots(remote, localSnapshot)`, `stores.applyPulled(merged.collections, merged.environments-with-secrets-preserved)`, then `client.push(id, JSON.stringify(merged), conflict.revision)` once more; update `lastRevision` from that result (if the retry itself conflicts, stop and leave `lastRevision` — the next change/pull reconciles).
  - `enable`/`pull` unchanged except `enable` uses the real name.

- [ ] **Step 1: Update the sync-manager test** — `test/extension/sync/sync-manager.test.ts`

In the existing `stores(...)` helper, add `getName: async () => 'RealName'` to the returned `port`. Update the two push/enable assertions that read the snapshot to expect `name: 'RealName'` where they currently pass the id. Then add a conflict test:

```ts
  it('push merges and retries on conflict, then records the new revision', async () => {
    const localCol = { id: 'c-local', name: 'Local', workspaceId: 'w1', requests: [] }
    const remoteSnap = JSON.stringify({ version: 1, workspaceId: 'w1', name: 'RealName', collections: [{ id: 'c-remote', name: 'Remote', workspaceId: 'w1', requests: [] }], environments: [], updatedAt: 1, updatedBy: 'other' })
    let pushes = 0
    const client = {
      enableSync: vi.fn(),
      pull: vi.fn(),
      push: vi.fn(async (_id: string, snapshot: string, _base: string) => {
        pushes += 1
        if (pushes === 1) return { ok: false, conflict: true, snapshot: remoteSnap, revision: '7' }
        // second push should carry both collections (merged)
        const parsed = JSON.parse(snapshot)
        expect(parsed.collections.map((c: any) => c.id).sort()).toEqual(['c-local', 'c-remote'])
        return { ok: true, revision: '8' }
      }),
    } as any
    const { port } = stores({ collections: [localCol], environments: [] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f1', ownerEmail: 'a@x.com', role: 'owner', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'a@x.com' }).push('w1')
    expect(pushes).toBe(2)
    expect((await state.get('w1'))?.lastRevision).toBe('8')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/sync/sync-manager.test.ts`
Expected: FAIL — `getName` missing / push returns the new shape / no conflict handling.

- [ ] **Step 3: Update `src/extension/sync/sync-manager.ts`**

Add `mergeSnapshots` import + a `getName` to `StoresPort`, and rewrite `snapshotText` + `push`:

```ts
import { buildSnapshot, mergeEnvironmentsPreservingSecrets, type WorkspaceSnapshot } from './snapshot'
import { mergeSnapshots } from './merge'
```

Add to `StoresPort`:

```ts
  getName(workspaceId: string): Promise<string>
```

Replace `snapshotText` so it uses the real name, and rewrite `push`:

```ts
  private async buildLocalSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
    const [name, collections, environments] = await Promise.all([
      this.deps.stores.getName(workspaceId),
      this.deps.stores.getCollections(workspaceId),
      this.deps.stores.getEnvironments(workspaceId),
    ])
    return buildSnapshot({ workspaceId, name, collections, environments, updatedBy: this.deps.email() })
  }

  async enable(workspaceId: string): Promise<void> {
    const snap = await this.buildLocalSnapshot(workspaceId)
    const { driveFileId, revision } = await this.deps.client.enableSync(workspaceId, snap.name, JSON.stringify(snap))
    await this.deps.state.set(workspaceId, { driveFileId, ownerEmail: this.deps.email(), role: 'owner', lastRevision: revision, synced: true })
  }

  async push(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return
    const local = await this.buildLocalSnapshot(workspaceId)
    const first = await this.deps.client.push(workspaceId, JSON.stringify(local), state.lastRevision)
    if (first.ok) { await this.deps.state.set(workspaceId, { ...state, lastRevision: first.revision }); return }
    // conflict: merge remote + local, apply locally, retry once against the remote revision
    const remote = JSON.parse(first.snapshot) as WorkspaceSnapshot
    const merged = mergeSnapshots(remote, local)
    const localEnvs = await this.deps.stores.getEnvironments(workspaceId)
    await this.deps.stores.applyPulled(workspaceId, merged.collections, mergeEnvironmentsPreservingSecrets(merged.environments, localEnvs))
    const retry = await this.deps.client.push(workspaceId, JSON.stringify(merged), first.revision)
    if (retry.ok) await this.deps.state.set(workspaceId, { ...state, lastRevision: retry.revision })
  }
```

Update `enable`'s signature note: it no longer takes a `name` param (the name comes from `getName`). If any caller passes a name, drop it. Keep `pull` as-is (it already uses `mergeEnvironmentsPreservingSecrets`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/sync/sync-manager.test.ts`
Expected: PASS (all, incl. the conflict test).

- [ ] **Step 5: Commit**

```bash
git add src/extension/sync/sync-manager.ts test/extension/sync/sync-manager.test.ts
git commit -m "feat(sync): SyncManager conflict merge+retry, real workspace name"
```

---

### Task 7: `SyncSocket` (extension WebSocket client)

**Files:**
- Create: `src/extension/sync/sync-socket.ts`
- Test: `test/extension/sync/sync-socket.test.ts`

**Interfaces:**
- Consumes: the `ws` package (already a dependency of the extension), injectable for tests.
- Produces:
  - `type ChangeMsg = { type: 'workspace-changed'; workspaceId: string; revision: string; updatedBy: string }`
  - `handleSocketData(raw: string, onChange: (m: ChangeMsg) => void): void` — parses a message; calls `onChange` only for `workspace-changed`. (Pure, tested.)
  - `class SyncSocket { constructor(opts: { url: () => string; token: () => string | undefined; onChange: (m: ChangeMsg) => void; wsFactory?: (url: string) => WsLike }); start(): void; stop(): void }` where `WsLike = { on(ev, cb), close() }`. Connects to `${url()}/ws?token=${token()}`, routes `message` events through `handleSocketData`, and reconnects with a capped backoff on `close`/`error` until `stop()`.

- [ ] **Step 1: Write the failing test** — `test/extension/sync/sync-socket.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { handleSocketData, SyncSocket } from '../../../src/extension/sync/sync-socket'

describe('handleSocketData', () => {
  it('invokes onChange for a workspace-changed message', () => {
    const onChange = vi.fn()
    handleSocketData(JSON.stringify({ type: 'workspace-changed', workspaceId: 'w1', revision: '2', updatedBy: 'a' }), onChange)
    expect(onChange).toHaveBeenCalledWith({ type: 'workspace-changed', workspaceId: 'w1', revision: '2', updatedBy: 'a' })
  })
  it('ignores other or malformed messages', () => {
    const onChange = vi.fn()
    handleSocketData(JSON.stringify({ type: 'other' }), onChange)
    handleSocketData('not json', onChange)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SyncSocket', () => {
  it('connects with the token in the query and routes change messages', () => {
    let opened = ''
    const handlers: Record<string, (arg?: any) => void> = {}
    const fakeWs = { on: (ev: string, cb: any) => { handlers[ev] = cb }, close: vi.fn() }
    const onChange = vi.fn()
    const sock = new SyncSocket({
      url: () => 'http://localhost:8787', token: () => 'jwt-1', onChange,
      wsFactory: (u: string) => { opened = u; return fakeWs as any },
    })
    sock.start()
    expect(opened).toBe('http://localhost:8787/ws?token=jwt-1')
    handlers.message?.(Buffer.from(JSON.stringify({ type: 'workspace-changed', workspaceId: 'w1', revision: '3', updatedBy: 'a' })))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1', revision: '3' }))
    sock.stop()
    expect(fakeWs.close).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/sync/sync-socket.test.ts`
Expected: FAIL — cannot find module `.../sync-socket`.

- [ ] **Step 3: Implement `src/extension/sync/sync-socket.ts`**

```ts
import WebSocket from 'ws'

export type ChangeMsg = { type: 'workspace-changed'; workspaceId: string; revision: string; updatedBy: string }

export type WsLike = { on(ev: string, cb: (arg?: any) => void): void; close(): void }

export function handleSocketData(raw: string, onChange: (m: ChangeMsg) => void): void {
  try {
    const m = JSON.parse(raw)
    if (m && m.type === 'workspace-changed') onChange(m as ChangeMsg)
  } catch {
    /* ignore malformed frames */
  }
}

export class SyncSocket {
  private ws: WsLike | undefined
  private stopped = false
  private backoff = 1000
  constructor(private opts: {
    url: () => string
    token: () => string | undefined
    onChange: (m: ChangeMsg) => void
    wsFactory?: (url: string) => WsLike
  }) {}

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.ws?.close()
    this.ws = undefined
  }

  private connect(): void {
    if (this.stopped) return
    const token = this.opts.token()
    if (!token) { this.scheduleReconnect(); return }
    const base = this.opts.url().replace(/\/$/, '').replace(/^http/, 'ws')
    const url = `${this.opts.url().replace(/\/$/, '')}/ws?token=${encodeURIComponent(token)}`
    const factory = this.opts.wsFactory ?? ((u: string) => new WebSocket(u.replace(/^http/, 'ws')) as unknown as WsLike)
    const socket = factory(url)
    this.ws = socket
    socket.on('message', (data: unknown) => handleSocketData(String(data), this.opts.onChange))
    socket.on('open', () => { this.backoff = 1000 })
    socket.on('close', () => this.scheduleReconnect())
    socket.on('error', () => { try { socket.close() } catch { /* ignore */ } })
    void base
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, 30000)
    setTimeout(() => this.connect(), delay)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/sync/sync-socket.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/sync/sync-socket.ts test/extension/sync/sync-socket.test.ts
git commit -m "feat(sync): SyncSocket ws client with reconnect"
```

---

### Task 8: Integrate sync into the host bootstrap (auto-push + auto-pull + shared runtime)

**Files:**
- Modify: `src/extension/hub.ts` (add `setAfterDispatch` + `refresh`)
- Create: `src/extension/sync/sync-runtime.ts` (assemble SyncManager + debounced push + SyncSocket around the router's stores/Hub)
- Modify: `src/extension/panel.ts` (build the runtime in bootstrap; wire `onMutated` + pull→refresh)
- Modify: `src/extension/extension.ts` (commands call the shared runtime instead of a private SyncManager)
- Test: `test/extension/sync/sync-runtime.test.ts`, `test/extension/hub-sync.test.ts`

**Interfaces:**
- Consumes: `Hub` (extended), `SyncManager`, `SyncSocket`, `SyncStateStore`, `buildStoresPort` (extended with `getName`), the router's `CollectionStore`/`EnvironmentStore`, config accessors.
- Produces:
  - `Hub.setAfterDispatch(fn: (msg: WebviewMessage) => void): void` — called after each dispatch's snapshot broadcast.
  - `Hub.refresh(): Promise<void>` — re-broadcast the snapshot to all sinks (used after an incoming pull).
  - `isMutating(msgType: string): boolean` — true for message types that change collections/environments.
  - `createSyncRuntime(deps: { manager: SyncManager; socket: SyncSocket; onPulled: () => Promise<void>; debounceMs?: number }): { schedulePush(workspaceId: string): void; start(): void; stop(): void; manager: SyncManager }` — debounces `manager.push(id)`; `socket.onChange` → `manager.pull(id)` then `onPulled()`.
- Note: `buildStoresPort` (Task 13 of Phase 2) must gain `getName`. Add it in this task: read the workspace name from the workspaces list the extension already loads, or fall back to the id. Concretely, `getName` looks up the name via a passed `nameOf(workspaceId): string` resolver (the host reads it from the sidebar workspaces snapshot / globalState); if unknown, return the id.

- [ ] **Step 1: Write the failing test for the Hub hooks** — `test/extension/hub-sync.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { Hub } from '../../src/extension/hub'
import type { HostMessage } from '../../src/shared/types'

const snapshot = async (): Promise<HostMessage[]> => [{ type: 'tree', collections: [] }]

describe('Hub sync hooks', () => {
  it('calls afterDispatch with the message after a dispatch', async () => {
    const hub = new Hub(async () => undefined, snapshot)
    const after = vi.fn()
    hub.setAfterDispatch(after)
    await hub.dispatch('sidebar', { type: 'saveRequest', collectionId: 'c1', request: {} as any })
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ type: 'saveRequest' }))
  })
  it('refresh re-broadcasts the snapshot to all sinks', async () => {
    const hub = new Hub(async () => undefined, snapshot)
    const got: HostMessage[] = []
    hub.register('req:1', (m) => got.push(m))
    await hub.refresh()
    expect(got.map((m) => m.type)).toEqual(['tree'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/extension/hub-sync.test.ts`
Expected: FAIL — `setAfterDispatch`/`refresh` do not exist.

- [ ] **Step 3: Extend `src/extension/hub.ts`**

Add a field `private afterDispatch?: (msg: WebviewMessage) => void` and these methods:

```ts
  setAfterDispatch(fn: (msg: WebviewMessage) => void): void { this.afterDispatch = fn }

  async refresh(): Promise<void> {
    for (const m of await this.snapshot()) this.broadcast(m)
  }
```

At the very end of `dispatch(fromId, msg)`, after the snapshot broadcast loop, add:

```ts
    this.afterDispatch?.(msg)
```

(`this.snapshot` and `this.broadcast` already exist; if `snapshot`/`broadcast` are named differently in the current Hub, use the existing private members — do not rename them.)

- [ ] **Step 4: Run the hub test to verify it passes**

Run: `npx vitest run test/extension/hub-sync.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for the runtime** — `test/extension/sync/sync-runtime.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { createSyncRuntime, isMutating } from '../../../src/extension/sync/sync-runtime'

describe('isMutating', () => {
  it('flags data-changing message types', () => {
    expect(isMutating('saveRequest')).toBe(true)
    expect(isMutating('deleteCollection')).toBe(true)
    expect(isMutating('saveEnvironment')).toBe(true)
    expect(isMutating('loadTree')).toBe(false)
    expect(isMutating('sendRequest')).toBe(false)
  })
})

describe('createSyncRuntime', () => {
  it('debounces schedulePush into a single manager.push', async () => {
    vi.useFakeTimers()
    const manager = { push: vi.fn(async () => {}), pull: vi.fn(async () => {}) } as any
    const socket = { start: vi.fn(), stop: vi.fn() } as any
    const rt = createSyncRuntime({ manager, socket, onPulled: async () => {}, debounceMs: 500 })
    rt.schedulePush('w1'); rt.schedulePush('w1'); rt.schedulePush('w1')
    await vi.advanceTimersByTimeAsync(600)
    expect(manager.push).toHaveBeenCalledTimes(1)
    expect(manager.push).toHaveBeenCalledWith('w1')
    vi.useRealTimers()
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run test/extension/sync/sync-runtime.test.ts`
Expected: FAIL — cannot find module `.../sync-runtime`.

- [ ] **Step 7: Implement `src/extension/sync/sync-runtime.ts`**

```ts
import type { SyncManager } from './sync-manager'
import type { SyncSocket, ChangeMsg } from './sync-socket'

const MUTATING = new Set<string>([
  'saveRequest', 'createRequest', 'duplicateRequest', 'deleteRequest', 'renameRequest',
  'moveRequest', 'moveFolder', 'createFolder', 'renameFolder', 'deleteFolder',
  'createCollection', 'renameCollection', 'deleteCollection', 'setCollectionEnvironment',
  'saveEnvironment', 'createEnvironment', 'deleteEnvironment', 'restoreTrash',
])

export function isMutating(msgType: string): boolean {
  return MUTATING.has(msgType)
}

export function createSyncRuntime(deps: {
  manager: SyncManager
  socket: SyncSocket
  onPulled: () => Promise<void>
  debounceMs?: number
}) {
  const debounceMs = deps.debounceMs ?? 1500
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const schedulePush = (workspaceId: string): void => {
    if (!workspaceId) return
    clearTimeout(timers.get(workspaceId))
    timers.set(workspaceId, setTimeout(() => { void deps.manager.push(workspaceId) }, debounceMs))
  }

  return {
    manager: deps.manager,
    schedulePush,
    start(): void {
      deps.socket.start()
    },
    stop(): void {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      deps.socket.stop()
    },
    // exposed so the host can route socket changes → pull → refresh
    async onSocketChange(m: ChangeMsg): Promise<void> {
      await deps.manager.pull(m.workspaceId)
      await deps.onPulled()
    },
  }
}
```

Note: the `SyncSocket` is constructed by the host (Step 9) with `onChange` pointed at `runtime.onSocketChange`.

- [ ] **Step 8: Run the runtime test to verify it passes**

Run: `npx vitest run test/extension/sync/sync-runtime.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Wire the runtime into `src/extension/panel.ts`'s bootstrap**

In `panel.ts`'s `ensureBootstrap`, after the `Hub` is created and `collections`/`environments` stores exist, build the sync runtime and wire it. Add imports at the top of `panel.ts`:

```ts
import { SyncClient } from './sync/sync-client'
import { SyncStateStore } from './sync/sync-state-store'
import { SyncManager } from './sync/sync-manager'
import { SyncSocket } from './sync/sync-socket'
import { buildStoresPort } from './sync/wiring'
import { createSyncRuntime, isMutating } from './sync/sync-runtime'
```

After `const hub = new Hub(route, snapshot)` (and the existing `hubRef = hub`, `hub.setOpen(...)`), add:

```ts
  // --- sync runtime (shares the router's stores + Hub) ---
  const syncBaseUrl = (): string => vscode.workspace.getConfiguration('restman').get<string>('syncServerUrl', 'http://localhost:8787')
  const getSyncToken = async (): Promise<string | undefined> => (await context.secrets.get('restman.syncToken')) ?? undefined
  let cachedToken: string | undefined
  void getSyncToken().then((t) => { cachedToken = t })
  const activeWorkspaceId = (): string => context.globalState.get<string>('restman.activeWorkspaceId', '')
  const nameOf = (id: string): string => (list.find((w) => w.id === id)?.name ?? id) // `list` is the workspaces list already loaded in bootstrap

  const syncClient = new SyncClient({ baseUrl: syncBaseUrl(), getToken: () => cachedToken })
  const manager = new SyncManager({
    client: syncClient,
    state: new SyncStateStore(context.globalStorageUri.fsPath),
    stores: buildStoresPort(collections, environments, nameOf),
    email: () => context.globalState.get<string>('restman.syncEmail', 'me'),
  })
  const runtime = createSyncRuntime({
    manager,
    socket: new SyncSocket({ url: syncBaseUrl, token: () => cachedToken, onChange: (m) => { void runtime.onSocketChange(m) } }),
    onPulled: async () => { await hub.refresh() },
  })
  hub.setAfterDispatch((msg) => { if (isMutating(msg.type)) runtime.schedulePush(activeWorkspaceId()) })
  runtime.start()
  syncRuntimeRef = runtime
  // refresh the cached token whenever secrets change (e.g. after sign-in in extension.ts)
  context.secrets.onDidChange(async (e) => { if (e.key === 'restman.syncToken') cachedToken = (await getSyncToken()) })
```

Add a module-level `let syncRuntimeRef: ReturnType<typeof createSyncRuntime> | undefined` near `hubRef`, and export a getter `export function getSyncRuntime() { return syncRuntimeRef }`.

Because `SyncSocket`'s `onChange` references `runtime` before it is assigned, declare `runtime` with `let` and set `onChange` to a closure that reads it (as written above — the arrow defers the read until a message arrives, by which point `runtime` is assigned).

- [ ] **Step 10: Update `buildStoresPort` for `getName`** in `src/extension/sync/wiring.ts`

Change the signature to `buildStoresPort(collections, environments, nameOf: (id: string) => string): StoresPort` and add `async getName(workspaceId) { return nameOf(workspaceId) }` to the returned object. Update the existing `test/extension/sync/wiring.test.ts` calls to pass a `nameOf` (e.g. `(id) => id`) and add one assertion: `expect(await port.getName('w1')).toBe('w1')`.

- [ ] **Step 11: Point `extension.ts` sign-in + commands at the shared runtime**

In `src/extension/extension.ts`, keep the `restman.signInToSync` command (it stores the token in SecretStorage — `panel.ts` now listens for that change). Replace the private `syncManager()` construction and the `enableWorkspaceSync`/`syncNow` command bodies so they use the shared runtime:

```ts
  import { getSyncRuntime } from './panel'
  // ...
  vscode.commands.registerCommand('restman.enableWorkspaceSync', async () => {
    const id = context.globalState.get<string>('restman.activeWorkspaceId', '')
    const rt = getSyncRuntime()
    if (!id || !rt) return void vscode.window.showWarningMessage('restman: no active workspace / sync not ready')
    try { await rt.manager.enable(id); void vscode.window.showInformationMessage('restman: workspace sync enabled') }
    catch (e: any) { void vscode.window.showErrorMessage(`restman: enable sync failed: ${e?.message ?? e}`) }
  }),
  vscode.commands.registerCommand('restman.syncNow', async () => {
    const id = context.globalState.get<string>('restman.activeWorkspaceId', '')
    const rt = getSyncRuntime()
    if (!id || !rt) return void vscode.window.showWarningMessage('restman: no active workspace / sync not ready')
    try { await rt.manager.pull(id); await rt.manager.push(id); void vscode.window.showInformationMessage('restman: synced') }
    catch (e: any) { void vscode.window.showErrorMessage(`restman: sync failed: ${e?.message ?? e}`) }
  }),
```

Also make `signInToSync` store the email so `updatedBy` is real (it already does `context.globalState.update('restman.syncEmail', me.email)` from the Phase-2 fix — keep it). Remove the now-unused `SyncManager`/`SyncStateStore`/`buildStoresPort` imports from `extension.ts` if they become unused.

- [ ] **Step 12: Typecheck + full extension suite + build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: typecheck clean; all tests pass (existing + new hub-sync, sync-runtime, updated wiring); build succeeds.

- [ ] **Step 13: Commit**

```bash
git add src/extension/hub.ts src/extension/sync/sync-runtime.ts src/extension/panel.ts src/extension/extension.ts src/extension/sync/wiring.ts test/extension/hub-sync.test.ts test/extension/sync/sync-runtime.test.ts test/extension/sync/wiring.test.ts
git commit -m "feat(sync): host runtime — debounced auto-push + auto-pull via ws, shared with router"
```

---

### Task 9: Manual verification checklist (two windows)

**Files:**
- Create: `docs/sync-phase-3-verification.md`

**Interfaces:**
- Consumes: nothing.
- Produces: an operator runbook proving realtime + conflict behavior.

- [ ] **Step 1: Create `docs/sync-phase-3-verification.md`**

```markdown
# Drive Sync Phase 3 — manual verification

Prereq: backend running (`cd server && npm run dev`) with a real Google OAuth client + Drive API; sign in and enable sync on a workspace (Phase 2 steps).

## Realtime (same owner, two windows)
1. Open two VS Code windows on the extension (both signed in as the same Google account, same synced workspace).
2. In window A, add a request to a collection and wait ~2s (debounced auto-push).
3. Window B should update within a second or two (WebSocket `workspace-changed` → auto-pull → tree refresh) — no manual action.

## Conflict (revision guard)
1. Stop window B's network (or the backend) briefly so it goes stale.
2. In window A, make a change (pushes → revision bumps).
3. Reconnect window B and make a *different* change. Its push 409s; the client merges (both changes present) and retries. Confirm both changes survive in the Drive file and in both windows.

## Secrets
1. Confirm the Drive file still stores secret env values as `""` after auto-push, and local secret values remain intact in each window after pull.
```

- [ ] **Step 2: Commit**

```bash
git add docs/sync-phase-3-verification.md
git commit -m "docs: Drive sync phase 3 manual verification"
```

---

## Self-Review

**Spec coverage (Phase 3 = "Realtime: WebSocket + revision + merge-by-id + debounced push/pull"):**
- WebSocket realtime → backend Tasks 1 (relay) + 3 (ws server); extension Task 7 (client) + Task 8 (wire auto-pull). ✓
- Revision guard → Task 2 (409 + current snapshot). ✓
- merge-by-id → Task 4 (`mergeSnapshots`) applied on conflict in Task 6; also the trash-restore merge landed earlier. ✓
- Debounced push/pull → Task 8 (`createSyncRuntime` debounce + `Hub.setAfterDispatch` mutation signal; auto-pull on socket change → `Hub.refresh`). ✓
- Deferred Phase-2 items folded in: real workspace name on push (Task 6); the two-store-instances wart resolved by moving the runtime into `panel.ts`'s bootstrap (Task 8). ✓

Explicitly out of Phase 3 (later): Drive `files.watch` webhooks for **out-of-app** edits (Phase 4); sharing/members/roles beyond owner (Phase 5); a base-tracked 3-way merge with delete propagation (enhancement — Phase 3 uses safe union-merge, documented in Global Constraints).

**Placeholder scan:** none — every code step has full code. Task 8's "use the existing private members if named differently" note is a grounding instruction for the one Hub internal whose exact name the implementer must confirm by reading `hub.ts`; the added methods' bodies are given.

**Type consistency:** `ChangeMsg` (identical shape on server `realtime.ts` and extension `sync-socket.ts`), `Realtime.register/broadcast`, `PushResult`, `SyncClient.push(id,snapshot,baseRevision)`, `SyncManager.{enable,push,pull}`, `StoresPort.getName`, `mergeSnapshots(remote,local)`, `Hub.setAfterDispatch/refresh`, `createSyncRuntime(...).{schedulePush,start,stop,onSocketChange,manager}`, `isMutating` — used with matching signatures across tasks. `buildStoresPort` gains a third `nameOf` param in Task 8/10 and every caller (panel.ts + wiring test) is updated in the same tasks.

**Integration risk called out:** Task 8 touches the host wiring (`panel.ts`, `extension.ts`, `hub.ts`) and cannot be unit-verified against real VS Code — the hub hooks, runtime debounce, merge, revision guard, and ws relay are unit-tested; the end-to-end realtime path is covered by the Task 9 manual runbook.
