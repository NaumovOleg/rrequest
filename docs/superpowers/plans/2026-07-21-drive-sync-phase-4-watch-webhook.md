# Drive Sync — DS-Phase 4: Watch Channels + Webhook + Renewal (outside-edit sync) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect edits made to a workspace's Drive file **outside** restman (Google Drive web UI, another device, a client not connected over WebSocket) and fan them out to connected members so their extensions pull — via Drive `files.watch` push channels + a `POST /webhook` endpoint, with channel renewal and a periodic poll fallback so sync survives a missed/undeliverable webhook.

**Architecture:** The backend registers a Drive `files.watch` channel per enabled workspace file (address = a configured public HTTPS `/webhook`, plus a per-channel verification token), storing the channel in a new `watch_channels` table. Google POSTs change notifications to `/webhook`; the backend verifies the channel token, maps the channel → workspace, re-reads the file's current Drive `headRevisionId`, and **only if it differs from the workspace's stored revision** (i.e. a genuine outside edit, not the echo of our own write) bumps the revision and broadcasts `workspace-changed` via the existing DS-Phase-3 `Realtime` relay. A `WatchScheduler` renews channels before expiry and, every poll interval, does the same head-revision comparison for every synced workspace — this is the fallback that keeps outside-edit sync working even with no public webhook URL (dev) or a dropped notification.

**Tech Stack:** Backend only — Node 18+, TypeScript, ESM, Fastify, better-sqlite3, google-auth-library, `ws` (already present), vitest. No extension changes (the DS-Phase-3 `SyncSocket` → `pullIfNewer` path already consumes `workspace-changed`).

## Global Constraints

- Backend under `server/`: Node **>= 18**, TypeScript, ESM. All Google-facing calls stay on the backend.
- **DS-Phase 4 stays owner-only** (sharing is DS-Phase 5): a workspace's watch channel + poll use the **owner's** Drive credentials (`driveFor(users.getById(workspace.ownerUserId))`). Broadcasts still only reach the owner's connected sockets (that's all `Realtime` knows in Phase 4).
- **Revision model (unchanged, relied upon):** a workspace's `revision` column always equals the Drive file's `headRevisionId` returned by the last `createFile`/`updateFile`. This is the echo-detection key.
- **Echo/loop prevention:** the webhook AND the poll re-read the file's current `headRevisionId` and broadcast **only when it differs** from the stored workspace revision. Our own push already set the stored revision to that head revision, so the webhook Google fires for our own write is a no-op. (This replaces the spec's alternative "origin client id tag" — revision-equality is sufficient because revision == headRevisionId.) On a real change, `setRevision` to the new head revision then broadcast.
- **Webhook auth:** Google's `POST /webhook` carries no app JWT. Authenticate by matching the `X-Goog-Channel-Token` header against the token stored for that `X-Goog-Channel-ID`. An unmatched/unknown channel → no-op. Always respond **200** (a non-2xx makes Google retry).
- **Public URL is optional (dev-friendly):** `PUBLIC_WEBHOOK_URL` env is optional. When unset, watch registration is skipped and the poll fallback alone delivers outside-edit sync (higher latency). When set, it must be an HTTPS URL Google can reach; the webhook address is `${PUBLIC_WEBHOOK_URL}/webhook`.
- **Resource states:** ignore the initial `sync` handshake notification and any state other than `update`/`change`/`exists` (treat only content-change states as candidates for detection).
- Reuse existing modules: `Realtime` (`realtime.ts`), `WorkspaceStore`, `UserStore` (`getById`), `DriveFactory` (`driveFor`), `signSession`/`config`.

---

### Task 1: DriveClient — `getHeadRevision`, `watchFile`, `stopChannel`

**Files:**
- Modify: `server/src/drive-client.ts` (interface + `GoogleDriveClient` + `FakeDriveClient`)
- Test: `server/src/drive-client.test.ts` (new — exercises `FakeDriveClient`'s new methods)

**Interfaces:**
- Consumes: nothing new.
- Produces (added to `DriveClient`):
  - `getHeadRevision(fileId: string): Promise<string>`
  - `watchFile(fileId: string, opts: WatchOpts): Promise<WatchInfo>` where `type WatchOpts = { channelId: string; address: string; token: string; ttlSeconds?: number }` and `type WatchInfo = { channelId: string; resourceId: string; expiration: number }` (expiration = ms epoch)
  - `stopChannel(opts: { channelId: string; resourceId: string }): Promise<void>`
  - Both new types exported from `drive-client.ts`.

- [ ] **Step 1: Write the failing test** — `server/src/drive-client.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { FakeDriveClient } from "./drive-client";

describe("FakeDriveClient watch surface", () => {
  it("getHeadRevision returns the current revision as a string and tracks updates", async () => {
    const d = new FakeDriveClient();
    const { fileId, revision } = await d.createFile("f", "n", "{}");
    expect(await d.getHeadRevision(fileId)).toBe(revision);
    const { revision: r2 } = await d.updateFile(fileId, "{\"v\":2}");
    expect(await d.getHeadRevision(fileId)).toBe(r2);
    expect(r2).not.toBe(revision);
  });
  it("watchFile records a channel and returns channelId/resourceId/expiration", async () => {
    const d = new FakeDriveClient();
    const { fileId } = await d.createFile("f", "n", "{}");
    const info = await d.watchFile(fileId, { channelId: "ch1", address: "https://x/webhook", token: "tok" });
    expect(info.channelId).toBe("ch1");
    expect(info.resourceId).toBeTypeOf("string");
    expect(info.expiration).toBeGreaterThan(Date.now());
    expect(d.watched("ch1")).toMatchObject({ fileId, token: "tok" });
  });
  it("stopChannel removes a recorded channel", async () => {
    const d = new FakeDriveClient();
    const { fileId } = await d.createFile("f", "n", "{}");
    const info = await d.watchFile(fileId, { channelId: "ch1", address: "a", token: "t" });
    await d.stopChannel({ channelId: "ch1", resourceId: info.resourceId });
    expect(d.watched("ch1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/drive-client.test.ts`
Expected: FAIL — `getHeadRevision`/`watchFile`/`stopChannel`/`watched` not on `FakeDriveClient`.

- [ ] **Step 3: Extend the interface + both clients in `server/src/drive-client.ts`**

Add near the top, after the `DriveClient` interface's existing members:

```ts
export type WatchOpts = { channelId: string; address: string; token: string; ttlSeconds?: number };
export type WatchInfo = { channelId: string; resourceId: string; expiration: number };
```

Add these three method signatures to the `DriveClient` interface:

```ts
  getHeadRevision(fileId: string): Promise<string>;
  watchFile(fileId: string, opts: WatchOpts): Promise<WatchInfo>;
  stopChannel(opts: { channelId: string; resourceId: string }): Promise<void>;
```

In `GoogleDriveClient`, add:

```ts
  async getHeadRevision(fileId: string): Promise<string> {
    const res = await this.fetchImpl(`${DRIVE}/files/${fileId}?fields=headRevisionId`, { headers: await this.auth() });
    if (!res.ok) throw new Error(`Drive head-revision failed: ${res.status}`);
    return ((await res.json()) as { headRevisionId?: string }).headRevisionId ?? "";
  }

  async watchFile(fileId: string, opts: WatchOpts): Promise<WatchInfo> {
    const body: Record<string, unknown> = { id: opts.channelId, type: "web_hook", address: opts.address, token: opts.token };
    if (opts.ttlSeconds) body.expiration = Date.now() + opts.ttlSeconds * 1000;
    const res = await this.fetchImpl(`${DRIVE}/files/${fileId}/watch?fields=resourceId,expiration`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Drive watch failed: ${res.status}`);
    const j = (await res.json()) as { resourceId: string; expiration?: string };
    return { channelId: opts.channelId, resourceId: j.resourceId, expiration: j.expiration ? Number(j.expiration) : Date.now() + 3600_000 };
  }

  async stopChannel(opts: { channelId: string; resourceId: string }): Promise<void> {
    const res = await this.fetchImpl(`${DRIVE}/channels/stop`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify({ id: opts.channelId, resourceId: opts.resourceId }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Drive channel stop failed: ${res.status}`);
  }
```

In `FakeDriveClient`, add a channel map + the methods:

```ts
  private channels = new Map<string, { fileId: string; resourceId: string; token: string; expiration: number }>();

  async getHeadRevision(fileId: string): Promise<string> {
    const f = this.files.get(fileId);
    if (!f) throw new Error("file not found");
    return String(f.revision);
  }
  async watchFile(fileId: string, opts: WatchOpts): Promise<WatchInfo> {
    const resourceId = `res-${opts.channelId}`;
    const expiration = Date.now() + (opts.ttlSeconds ?? 3600) * 1000;
    this.channels.set(opts.channelId, { fileId, resourceId, token: opts.token, expiration });
    return { channelId: opts.channelId, resourceId, expiration };
  }
  async stopChannel(opts: { channelId: string; resourceId: string }): Promise<void> {
    this.channels.delete(opts.channelId);
  }
  // test helper
  watched(channelId: string) { return this.channels.get(channelId); }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/drive-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: all green, typecheck clean (no other file references the new methods yet).

- [ ] **Step 6: Commit**

```bash
git add server/src/drive-client.ts server/src/drive-client.test.ts
git commit -m "feat(server): DriveClient getHeadRevision + watch/stop channel"
```

---

### Task 2: `WatchChannelStore` (sqlite)

**Files:**
- Create: `server/src/watch-channel-store.ts`
- Test: `server/src/watch-channel-store.test.ts`

**Interfaces:**
- Consumes: `better-sqlite3`.
- Produces:
  - `type WatchChannel = { workspaceId: string; channelId: string; resourceId: string; token: string; expiration: number }`
  - `class WatchChannelStore { constructor(dbPath: string); upsert(c: WatchChannel): void; getByChannelId(channelId: string): WatchChannel | undefined; getByWorkspaceId(workspaceId: string): WatchChannel | undefined; all(): WatchChannel[]; delete(workspaceId: string): void }`
  - `workspace_id` is the primary key (one live channel per workspace); `channelId` has a lookup index.

- [ ] **Step 1: Write the failing test** — `server/src/watch-channel-store.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { WatchChannelStore } from "./watch-channel-store";

const ch = (over = {}) => ({ workspaceId: "w1", channelId: "c1", resourceId: "r1", token: "t1", expiration: 1000, ...over });

describe("WatchChannelStore", () => {
  it("upserts and reads back by channel id and workspace id", () => {
    const s = new WatchChannelStore(":memory:");
    s.upsert(ch());
    expect(s.getByChannelId("c1")).toEqual(ch());
    expect(s.getByWorkspaceId("w1")).toEqual(ch());
  });
  it("upsert replaces the row for the same workspace (one channel per workspace)", () => {
    const s = new WatchChannelStore(":memory:");
    s.upsert(ch());
    s.upsert(ch({ channelId: "c2", resourceId: "r2", token: "t2", expiration: 2000 }));
    expect(s.getByChannelId("c1")).toBeUndefined();
    expect(s.getByWorkspaceId("w1")).toMatchObject({ channelId: "c2", expiration: 2000 });
  });
  it("all() lists every channel; delete removes by workspace", () => {
    const s = new WatchChannelStore(":memory:");
    s.upsert(ch());
    s.upsert(ch({ workspaceId: "w2", channelId: "c9", resourceId: "r9" }));
    expect(s.all()).toHaveLength(2);
    s.delete("w1");
    expect(s.getByWorkspaceId("w1")).toBeUndefined();
    expect(s.all()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/watch-channel-store.test.ts`
Expected: FAIL — cannot find module `./watch-channel-store`.

- [ ] **Step 3: Implement `server/src/watch-channel-store.ts`**

```ts
import Database from "better-sqlite3";

export type WatchChannel = { workspaceId: string; channelId: string; resourceId: string; token: string; expiration: number };

type Row = { workspace_id: string; channel_id: string; resource_id: string; token: string; expiration: number };
const toCh = (r: Row): WatchChannel => ({ workspaceId: r.workspace_id, channelId: r.channel_id, resourceId: r.resource_id, token: r.token, expiration: r.expiration });

export class WatchChannelStore {
  private db: Database.Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS watch_channels (
      workspace_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      token TEXT NOT NULL,
      expiration INTEGER NOT NULL
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_watch_channel_id ON watch_channels(channel_id)`);
  }

  upsert(c: WatchChannel): void {
    this.db.prepare(`INSERT INTO watch_channels (workspace_id, channel_id, resource_id, token, expiration)
      VALUES (@workspaceId, @channelId, @resourceId, @token, @expiration)
      ON CONFLICT(workspace_id) DO UPDATE SET
        channel_id=excluded.channel_id, resource_id=excluded.resource_id, token=excluded.token, expiration=excluded.expiration`).run(c);
  }
  getByChannelId(channelId: string): WatchChannel | undefined {
    const r = this.db.prepare("SELECT * FROM watch_channels WHERE channel_id = ?").get(channelId) as Row | undefined;
    return r ? toCh(r) : undefined;
  }
  getByWorkspaceId(workspaceId: string): WatchChannel | undefined {
    const r = this.db.prepare("SELECT * FROM watch_channels WHERE workspace_id = ?").get(workspaceId) as Row | undefined;
    return r ? toCh(r) : undefined;
  }
  all(): WatchChannel[] {
    return (this.db.prepare("SELECT * FROM watch_channels").all() as Row[]).map(toCh);
  }
  delete(workspaceId: string): void {
    this.db.prepare("DELETE FROM watch_channels WHERE workspace_id = ?").run(workspaceId);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/watch-channel-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/watch-channel-store.ts server/src/watch-channel-store.test.ts
git commit -m "feat(server): WatchChannelStore (watch_channels table)"
```

---

### Task 3: `WatchService` — detect-and-broadcast + webhook notification handling

**Files:**
- Create: `server/src/watch-service.ts`
- Test: `server/src/watch-service.test.ts`

**Interfaces:**
- Consumes: `WorkspaceStore`, `UserStore` (`getById`), `WatchChannelStore`, `DriveFactory` (`driveFor`), `Realtime`, `Config` (`publicWebhookUrl`).
- Produces:
  - `class WatchService { constructor(deps: WatchDeps); detectAndBroadcast(workspaceId: string): Promise<'broadcast' | 'echo' | 'unknown'>; handleNotification(input: { channelId: string; token: string; resourceState: string }): Promise<'broadcast' | 'echo' | 'ignored' | 'unauthorized' | 'unknown'> }`
  - `type WatchDeps = { config: Pick<Config, 'publicWebhookUrl'>; users: UserStore; workspaces: WorkspaceStore; watch: WatchChannelStore; driveFor: DriveFactory; realtime: Realtime; now?: () => number }`
  - `detectAndBroadcast`: resolves the workspace + its owner's Drive client; reads current `headRevisionId`; if unknown workspace/owner → `'unknown'`; if head === stored revision → `'echo'` (no broadcast); else `setRevision(new)` + `realtime.broadcast(id, {type:'workspace-changed', workspaceId:id, revision:new, updatedBy:'drive'})` → `'broadcast'`.
  - `handleNotification`: `resourceState === 'sync'` → `'ignored'`; look up channel by `channelId` → none → `'unknown'`; token mismatch → `'unauthorized'`; else `detectAndBroadcast(channel.workspaceId)`.

- [ ] **Step 1: Write the failing test** — `server/src/watch-service.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { WatchService } from "./watch-service";
import { WorkspaceStore } from "./workspace-store";
import { UserStore } from "./user-store";
import { WatchChannelStore } from "./watch-channel-store";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";

function setup() {
  const users = new UserStore(":memory:", "enckey");
  const owner = users.upsertByGoogle({ googleSub: "g", email: "o@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const watch = new WatchChannelStore(":memory:");
  const drive = new FakeDriveClient();
  const realtime = new Realtime();
  const svc = new WatchService({ config: { publicWebhookUrl: "https://x" }, users, workspaces, watch, driveFor: () => drive, realtime });
  return { users, owner, workspaces, watch, drive, realtime, svc };
}

async function seedWorkspace(t: ReturnType<typeof setup>, id = "w1") {
  const { fileId, revision } = await t.drive.createFile("folder", "n", "{}");
  t.workspaces.upsert({ id, name: "W", ownerUserId: t.owner.id, driveFileId: fileId, hashFolderId: "h", revision, updatedAt: 1 });
  return { fileId, revision };
}

describe("WatchService.detectAndBroadcast", () => {
  it("returns 'echo' and does not broadcast when the head revision is unchanged", async () => {
    const t = setup(); await seedWorkspace(t);
    const heard = vi.fn(); t.realtime.register("c", t.owner.id, ["w1"], heard);
    expect(await t.svc.detectAndBroadcast("w1")).toBe("echo");
    expect(heard).not.toHaveBeenCalled();
  });
  it("bumps the stored revision and broadcasts on an outside change", async () => {
    const t = setup(); const { fileId } = await seedWorkspace(t);
    await t.drive.updateFile(fileId, "{\"outside\":true}"); // Drive head revision advances behind our back
    const heard = vi.fn(); t.realtime.register("c", t.owner.id, ["w1"], heard);
    expect(await t.svc.detectAndBroadcast("w1")).toBe("broadcast");
    const newRev = await t.drive.getHeadRevision(fileId);
    expect(t.workspaces.get("w1")?.revision).toBe(newRev);
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ type: "workspace-changed", workspaceId: "w1", revision: newRev, updatedBy: "drive" }));
  });
  it("returns 'unknown' for an unknown workspace", async () => {
    const t = setup();
    expect(await t.svc.detectAndBroadcast("nope")).toBe("unknown");
  });
});

describe("WatchService.handleNotification", () => {
  it("ignores the initial sync handshake", async () => {
    const t = setup(); await seedWorkspace(t);
    expect(await t.svc.handleNotification({ channelId: "c1", token: "t1", resourceState: "sync" })).toBe("ignored");
  });
  it("rejects an unknown channel and a bad token", async () => {
    const t = setup(); await seedWorkspace(t);
    t.watch.upsert({ workspaceId: "w1", channelId: "c1", resourceId: "r1", token: "good", expiration: 9e15 });
    expect(await t.svc.handleNotification({ channelId: "missing", token: "x", resourceState: "update" })).toBe("unknown");
    expect(await t.svc.handleNotification({ channelId: "c1", token: "bad", resourceState: "update" })).toBe("unauthorized");
  });
  it("detects a change for a valid channel+token", async () => {
    const t = setup(); const { fileId } = await seedWorkspace(t);
    t.watch.upsert({ workspaceId: "w1", channelId: "c1", resourceId: "r1", token: "good", expiration: 9e15 });
    await t.drive.updateFile(fileId, "{\"z\":1}");
    expect(await t.svc.handleNotification({ channelId: "c1", token: "good", resourceState: "update" })).toBe("broadcast");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/watch-service.test.ts`
Expected: FAIL — cannot find module `./watch-service`.

- [ ] **Step 3: Implement `server/src/watch-service.ts`**

```ts
import type { Config } from "./config.js";
import type { UserStore } from "./user-store.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { WatchChannelStore } from "./watch-channel-store.js";
import type { DriveFactory } from "./drive-factory.js";
import type { Realtime } from "./realtime.js";

export type WatchDeps = {
  config: Pick<Config, "publicWebhookUrl">;
  users: UserStore;
  workspaces: WorkspaceStore;
  watch: WatchChannelStore;
  driveFor: DriveFactory;
  realtime: Realtime;
  now?: () => number;
};

const CHANGE_STATES = new Set(["update", "change", "exists"]);

export class WatchService {
  private now: () => number;
  constructor(private deps: WatchDeps) {
    this.now = deps.now ?? Date.now;
  }

  private driveForOwner(ownerUserId: string) {
    const owner = this.deps.users.getById(ownerUserId);
    return owner ? this.deps.driveFor(owner) : undefined;
  }

  async detectAndBroadcast(workspaceId: string): Promise<"broadcast" | "echo" | "unknown"> {
    const ws = this.deps.workspaces.get(workspaceId);
    if (!ws) return "unknown";
    const drive = this.driveForOwner(ws.ownerUserId);
    if (!drive) return "unknown";
    const head = await drive.getHeadRevision(ws.driveFileId);
    if (head === ws.revision) return "echo";
    this.deps.workspaces.setRevision(workspaceId, head, this.now());
    this.deps.realtime.broadcast(workspaceId, { type: "workspace-changed", workspaceId, revision: head, updatedBy: "drive" });
    return "broadcast";
  }

  async handleNotification(input: { channelId: string; token: string; resourceState: string }): Promise<"broadcast" | "echo" | "ignored" | "unauthorized" | "unknown"> {
    if (input.resourceState === "sync" || !CHANGE_STATES.has(input.resourceState)) return "ignored";
    const ch = this.deps.watch.getByChannelId(input.channelId);
    if (!ch) return "unknown";
    if (ch.token !== input.token) return "unauthorized";
    return this.detectAndBroadcast(ch.workspaceId);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/watch-service.test.ts`
Expected: PASS (6 tests).

Note: `config.publicWebhookUrl` is not read by this task's methods (it is used by `ensureWatch` in Task 5). It is present in `WatchDeps` now so the type is stable across tasks; `Config` gains the field in Task 7. Until then, the test supplies a literal `{ publicWebhookUrl: "https://x" }` via the `Pick<Config,...>` so this task compiles independently.

- [ ] **Step 5: Commit**

```bash
git add server/src/watch-service.ts server/src/watch-service.test.ts
git commit -m "feat(server): WatchService detect-and-broadcast + webhook handling"
```

---

### Task 4: `POST /webhook` route

**Files:**
- Modify: `server/src/app.ts` (add optional `watchService` to `AppDeps`; add the route)
- Test: `server/src/app.webhook.test.ts`

**Interfaces:**
- Consumes: `WatchService` from `./watch-service`.
- Produces: `AppDeps` gains `watchService?: WatchService`. Route `POST /webhook`: reads headers `x-goog-channel-id`, `x-goog-channel-token`, `x-goog-resource-state`; calls `deps.watchService?.handleNotification(...)`; **always** replies 200 (`{ ok: true }`). If `watchService` is absent, still 200 (no-op).

- [ ] **Step 1: Write the failing test** — `server/src/app.webhook.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { WatchChannelStore } from "./watch-channel-store";
import { WatchService } from "./watch-service";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback", publicWebhookUrl: "https://x", pollIntervalMs: 60000, channelTtlSeconds: 604800 } as any;
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "cid");

describe("POST /webhook", () => {
  it("passes Google notification headers to the WatchService and always returns 200", async () => {
    const users = new UserStore(":memory:", "k");
    const workspaces = new WorkspaceStore(":memory:");
    const watch = new WatchChannelStore(":memory:");
    const drive = new FakeDriveClient();
    const realtime = new Realtime();
    const watchService = new WatchService({ config: cfg, users, workspaces, watch, driveFor: () => drive, realtime });
    const spy = vi.spyOn(watchService, "handleNotification");
    const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime, watchService });
    const res = await app.inject({ method: "POST", url: "/webhook", headers: {
      "x-goog-channel-id": "c1", "x-goog-channel-token": "t1", "x-goog-resource-state": "update",
    }, payload: "" });
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith({ channelId: "c1", token: "t1", resourceState: "update" });
  });
  it("returns 200 even when no watchService is configured", async () => {
    const app = buildApp({ config: cfg, users: new UserStore(":memory:", "k"), google, states: new PendingStates(), workspaces: new WorkspaceStore(":memory:"), driveFor: () => new FakeDriveClient(), realtime: new Realtime() });
    const res = await app.inject({ method: "POST", url: "/webhook", headers: { "x-goog-resource-state": "update" }, payload: "" });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/app.webhook.test.ts`
Expected: FAIL — `AppDeps` has no `watchService`; no `/webhook` route.

- [ ] **Step 3: Extend `AppDeps` + add the route in `server/src/app.ts`**

Add import:

```ts
import type { WatchService } from "./watch-service.js";
```

Add to `AppDeps`:

```ts
  watchService?: WatchService;
```

Add the route (near the other routes, e.g. after `/health`):

```ts
  app.post("/webhook", async (req, reply) => {
    const h = req.headers as Record<string, string | undefined>;
    const channelId = h["x-goog-channel-id"] ?? "";
    const token = h["x-goog-channel-token"] ?? "";
    const resourceState = h["x-goog-resource-state"] ?? "";
    await deps.watchService?.handleNotification({ channelId, token, resourceState });
    return reply.code(200).send({ ok: true });
  });
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/app.webhook.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full server suite + typecheck**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: all green (existing `buildApp` callers still compile — `watchService` is optional so they need no change), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/app.ts server/src/app.webhook.test.ts
git commit -m "feat(server): POST /webhook route -> WatchService"
```

---

### Task 5: Register/refresh a watch channel when a workspace is enabled

**Files:**
- Modify: `server/src/watch-service.ts` (add `ensureWatch`)
- Modify: `server/src/app.ts` (call `ensureWatch` from `POST /workspaces`)
- Test: `server/src/watch-service.ensure.test.ts`, and extend `server/src/app.workspaces-create.test.ts`

**Interfaces:**
- Consumes: Task 1 `DriveClient.watchFile`/`stopChannel`, Task 2 `WatchChannelStore`, `config.publicWebhookUrl`, `randomUUID`.
- Produces: `WatchService.ensureWatch(workspaceId: string): Promise<void>` — no-op when `config.publicWebhookUrl` is falsy; else: if a channel row already exists for the workspace, `stopChannel` it first (best-effort); then `driveForOwner(...).watchFile(fileId, { channelId: randomUUID(), address: '<publicWebhookUrl>/webhook', token: randomUUID(), ttlSeconds: config.channelTtlSeconds })`; `watch.upsert(...)` the returned channel. `POST /workspaces` calls `await deps.watchService?.ensureWatch(workspaceId)` after the `workspaces.upsert(...)`.
- `WatchDeps.config` widens to `Pick<Config, 'publicWebhookUrl' | 'channelTtlSeconds'>`.

- [ ] **Step 1: Write the failing test** — `server/src/watch-service.ensure.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { WatchService } from "./watch-service";
import { WorkspaceStore } from "./workspace-store";
import { UserStore } from "./user-store";
import { WatchChannelStore } from "./watch-channel-store";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";

function make(publicWebhookUrl?: string) {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "g", email: "o@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const watch = new WatchChannelStore(":memory:");
  const drive = new FakeDriveClient();
  const svc = new WatchService({ config: { publicWebhookUrl, channelTtlSeconds: 604800 } as any, users, workspaces, watch, driveFor: () => drive, realtime: new Realtime() });
  return { users, owner, workspaces, watch, drive, svc };
}

describe("WatchService.ensureWatch", () => {
  it("registers a channel and stores it when a public webhook url is set", async () => {
    const t = make("https://pub.example");
    const { fileId, revision } = await t.drive.createFile("f", "n", "{}");
    t.workspaces.upsert({ id: "w1", name: "W", ownerUserId: t.owner.id, driveFileId: fileId, hashFolderId: "h", revision, updatedAt: 1 });
    await t.svc.ensureWatch("w1");
    const row = t.watch.getByWorkspaceId("w1")!;
    expect(row.channelId).toBeTypeOf("string");
    expect(t.drive.watched(row.channelId)).toMatchObject({ fileId, token: row.token });
  });
  it("is a no-op when no public webhook url is configured", async () => {
    const t = make(undefined);
    const { fileId, revision } = await t.drive.createFile("f", "n", "{}");
    t.workspaces.upsert({ id: "w1", name: "W", ownerUserId: t.owner.id, driveFileId: fileId, hashFolderId: "h", revision, updatedAt: 1 });
    await t.svc.ensureWatch("w1");
    expect(t.watch.getByWorkspaceId("w1")).toBeUndefined();
  });
  it("stops the previous channel when re-registering", async () => {
    const t = make("https://pub.example");
    const { fileId, revision } = await t.drive.createFile("f", "n", "{}");
    t.workspaces.upsert({ id: "w1", name: "W", ownerUserId: t.owner.id, driveFileId: fileId, hashFolderId: "h", revision, updatedAt: 1 });
    await t.svc.ensureWatch("w1");
    const first = t.watch.getByWorkspaceId("w1")!.channelId;
    await t.svc.ensureWatch("w1");
    const second = t.watch.getByWorkspaceId("w1")!.channelId;
    expect(second).not.toBe(first);
    expect(t.drive.watched(first)).toBeUndefined(); // old channel stopped
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/watch-service.ensure.test.ts`
Expected: FAIL — `ensureWatch` not defined.

- [ ] **Step 3: Add `ensureWatch` to `server/src/watch-service.ts`**

Widen the `WatchDeps.config` type:

```ts
  config: Pick<Config, "publicWebhookUrl" | "channelTtlSeconds">;
```

Add the import:

```ts
import { randomUUID } from "node:crypto";
```

Add the method:

```ts
  async ensureWatch(workspaceId: string): Promise<void> {
    const address = this.deps.config.publicWebhookUrl;
    if (!address) return;
    const ws = this.deps.workspaces.get(workspaceId);
    if (!ws) return;
    const drive = this.driveForOwner(ws.ownerUserId);
    if (!drive) return;
    const existing = this.deps.watch.getByWorkspaceId(workspaceId);
    if (existing) {
      try { await drive.stopChannel({ channelId: existing.channelId, resourceId: existing.resourceId }); } catch { /* best-effort */ }
    }
    const channelId = randomUUID();
    const token = randomUUID();
    const info = await drive.watchFile(ws.driveFileId, {
      channelId, token, address: `${address.replace(/\/$/, "")}/webhook`, ttlSeconds: this.deps.config.channelTtlSeconds,
    });
    this.deps.watch.upsert({ workspaceId, channelId, resourceId: info.resourceId, token, expiration: info.expiration });
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/watch-service.ensure.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Call `ensureWatch` from `POST /workspaces` in `server/src/app.ts`**

In the `POST /workspaces` handler, immediately after `deps.workspaces.upsert({ ... })` and before the `return reply.code(201)...`, add:

```ts
    await deps.watchService?.ensureWatch(workspaceId);
```

- [ ] **Step 6: Assert it in the create test** — extend `server/src/app.workspaces-create.test.ts`

Add one test that supplies a `watchService` (constructed with the same in-memory stores + the shared `FakeDriveClient`) and, after a successful `POST /workspaces`, asserts a watch row now exists for the workspace (`watch.getByWorkspaceId(id)` is defined). Follow the file's existing setup helpers; supply `config` with `publicWebhookUrl: "https://x"` and `channelTtlSeconds: 604800`. (The pre-existing create tests that pass no `watchService` must still pass unchanged, since `ensureWatch` is guarded by `?.`.)

- [ ] **Step 7: Full server suite + typecheck**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: all green, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add server/src/watch-service.ts server/src/app.ts server/src/watch-service.ensure.test.ts server/src/app.workspaces-create.test.ts
git commit -m "feat(server): register Drive watch channel on workspace enable"
```

---

### Task 6: `WatchService` renewal + poll fallback, and `WatchScheduler`

**Files:**
- Modify: `server/src/watch-service.ts` (add `renewExpiring`, `pollAll`)
- Create: `server/src/watch-scheduler.ts`
- Test: `server/src/watch-service.poll.test.ts`, `server/src/watch-scheduler.test.ts`

**Interfaces:**
- Consumes: Task 3/5 `WatchService`, `WatchChannelStore.all`, `WorkspaceStore`.
- Produces:
  - `WatchService.pollAll(): Promise<number>` — for every workspace the store knows, run `detectAndBroadcast`; return the count that broadcast.
  - `WatchService.renewExpiring(withinMs: number): Promise<number>` — for each stored channel whose `expiration - now() <= withinMs`, call `ensureWatch(workspaceId)` (which stops+re-registers); return the count renewed.
  - `class WatchScheduler { constructor(opts: { service: WatchService; pollIntervalMs: number; renewIntervalMs?: number; renewWithinMs?: number }); start(): void; stop(): void }` — `start()` sets two intervals (poll → `pollAll`; renew → `renewExpiring(renewWithinMs)`); `stop()` clears them. The interval bodies swallow errors (a transient Drive/network failure must not crash the process).
  - `WatchService.pollAll` needs the set of workspace ids. Use the watch store's `all()` when a public URL is configured, else fall back to `workspaces` — but to keep Phase-4 simple and cover the no-webhook dev case, iterate **all owners' workspaces**: add a `WorkspaceStore.allIds(): string[]` helper (see Step 3a) and poll those. This makes the poll fallback work even with zero registered channels.

- [ ] **Step 1: Write the failing test** — `server/src/watch-service.poll.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { WatchService } from "./watch-service";
import { WorkspaceStore } from "./workspace-store";
import { UserStore } from "./user-store";
import { WatchChannelStore } from "./watch-channel-store";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";

function make(now = () => 1_000_000) {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "g", email: "o@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const watch = new WatchChannelStore(":memory:");
  const drive = new FakeDriveClient();
  const svc = new WatchService({ config: { publicWebhookUrl: "https://x", channelTtlSeconds: 604800 } as any, users, workspaces, watch, driveFor: () => drive, realtime: new Realtime(), now });
  return { users, owner, workspaces, watch, drive, svc };
}
async function seed(t: ReturnType<typeof make>, id: string) {
  const { fileId, revision } = await t.drive.createFile("f", id, "{}");
  t.workspaces.upsert({ id, name: id, ownerUserId: t.owner.id, driveFileId: fileId, hashFolderId: "h", revision, updatedAt: 1 });
  return fileId;
}

describe("WatchService.pollAll", () => {
  it("broadcasts only for workspaces whose Drive head revision changed", async () => {
    const t = make();
    const f1 = await seed(t, "w1");
    await seed(t, "w2");
    await t.drive.updateFile(f1, "{\"x\":1}"); // only w1 changed outside
    expect(await t.svc.pollAll()).toBe(1);
    expect(t.workspaces.get("w1")!.revision).toBe(await t.drive.getHeadRevision(f1));
  });
});

describe("WatchService.renewExpiring", () => {
  it("re-registers channels within the expiry window and leaves fresh ones alone", async () => {
    const t = make(() => 1_000_000);
    await seed(t, "w1");
    await seed(t, "w2");
    t.watch.upsert({ workspaceId: "w1", channelId: "old1", resourceId: "r1", token: "t1", expiration: 1_000_000 + 5_000 }); // expiring soon
    t.watch.upsert({ workspaceId: "w2", channelId: "keep2", resourceId: "r2", token: "t2", expiration: 1_000_000 + 999_999 }); // fresh
    const renewed = await t.svc.renewExpiring(10_000);
    expect(renewed).toBe(1);
    expect(t.watch.getByWorkspaceId("w1")!.channelId).not.toBe("old1"); // renewed
    expect(t.watch.getByWorkspaceId("w2")!.channelId).toBe("keep2");     // untouched
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/watch-service.poll.test.ts`
Expected: FAIL — `pollAll`/`renewExpiring` not defined (and `WorkspaceStore.allIds` missing).

- [ ] **Step 3a: Add `allIds` to `server/src/workspace-store.ts`**

```ts
  allIds(): string[] {
    return (this.db.prepare("SELECT id FROM workspaces").all() as { id: string }[]).map((r) => r.id);
  }
```

- [ ] **Step 3b: Add `pollAll` + `renewExpiring` to `server/src/watch-service.ts`**

```ts
  async pollAll(): Promise<number> {
    let broadcast = 0;
    for (const id of this.deps.workspaces.allIds()) {
      try { if ((await this.detectAndBroadcast(id)) === "broadcast") broadcast += 1; }
      catch { /* transient Drive/network error — next tick retries */ }
    }
    return broadcast;
  }

  async renewExpiring(withinMs: number): Promise<number> {
    const now = this.now();
    let renewed = 0;
    for (const ch of this.deps.watch.all()) {
      if (ch.expiration - now <= withinMs) {
        try { await this.ensureWatch(ch.workspaceId); renewed += 1; }
        catch { /* best-effort; next tick retries */ }
      }
    }
    return renewed;
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/watch-service.poll.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the scheduler test** — `server/src/watch-scheduler.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { WatchScheduler } from "./watch-scheduler";

afterEach(() => vi.useRealTimers());

describe("WatchScheduler", () => {
  it("calls pollAll on the poll interval and renewExpiring on the renew interval, and stops cleanly", async () => {
    vi.useFakeTimers();
    const service = { pollAll: vi.fn(async () => 0), renewExpiring: vi.fn(async () => 0) } as any;
    const s = new WatchScheduler({ service, pollIntervalMs: 1000, renewIntervalMs: 5000, renewWithinMs: 60000 });
    s.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(service.pollAll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000); // total 5000
    expect(service.pollAll).toHaveBeenCalledTimes(5);
    expect(service.renewExpiring).toHaveBeenCalledTimes(1);
    expect(service.renewExpiring).toHaveBeenCalledWith(60000);
    s.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(service.pollAll).toHaveBeenCalledTimes(5); // no more after stop
  });
});
```

- [ ] **Step 6: Implement `server/src/watch-scheduler.ts`**

```ts
import type { WatchService } from "./watch-service.js";

export class WatchScheduler {
  private pollTimer?: ReturnType<typeof setInterval>;
  private renewTimer?: ReturnType<typeof setInterval>;
  constructor(private opts: { service: WatchService; pollIntervalMs: number; renewIntervalMs?: number; renewWithinMs?: number }) {}

  start(): void {
    const renewInterval = this.opts.renewIntervalMs ?? 3600_000;
    const renewWithin = this.opts.renewWithinMs ?? 86_400_000;
    this.pollTimer = setInterval(() => { void this.opts.service.pollAll().catch(() => {}); }, this.opts.pollIntervalMs);
    this.renewTimer = setInterval(() => { void this.opts.service.renewExpiring(renewWithin).catch(() => {}); }, renewInterval);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.pollTimer = undefined;
    this.renewTimer = undefined;
  }
}
```

- [ ] **Step 7: Run the scheduler test to verify it passes**

Run: `cd server && npx vitest run src/watch-scheduler.test.ts`
Expected: PASS (1 test).

- [ ] **Step 8: Full server suite + typecheck**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: all green, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add server/src/watch-service.ts server/src/watch-scheduler.ts server/src/workspace-store.ts server/src/watch-service.poll.test.ts server/src/watch-scheduler.test.ts
git commit -m "feat(server): watch renewal + poll fallback + WatchScheduler"
```

---

### Task 7: Config additions + `server.ts` wiring

**Files:**
- Modify: `server/src/config.ts` (add `publicWebhookUrl?`, `pollIntervalMs`, `channelTtlSeconds`)
- Modify: `server/src/server.ts` (construct `WatchChannelStore` + `WatchService` + `WatchScheduler`; pass `watchService` into `buildApp`; start the scheduler)
- Test: `server/src/config.test.ts` (extend if it exists; else create)

**Interfaces:**
- Consumes: everything above.
- Produces: `Config` gains `publicWebhookUrl?: string` (env `PUBLIC_WEBHOOK_URL`, optional), `pollIntervalMs: number` (env `POLL_INTERVAL_MS`, default `60000`), `channelTtlSeconds: number` (env `CHANNEL_TTL_SECONDS`, default `604800`).

- [ ] **Step 1: Write/extend the config test** — `server/src/config.test.ts`

Create (or extend) with:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

const base = { JWT_SECRET: "j", TOKEN_ENC_KEY: "k", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s", GOOGLE_REDIRECT_URI: "http://localhost/cb" };

describe("loadConfig watch settings", () => {
  it("defaults poll interval + channel ttl and leaves publicWebhookUrl undefined", () => {
    const c = loadConfig({ ...base } as any);
    expect(c.publicWebhookUrl).toBeUndefined();
    expect(c.pollIntervalMs).toBe(60000);
    expect(c.channelTtlSeconds).toBe(604800);
  });
  it("reads overrides from env", () => {
    const c = loadConfig({ ...base, PUBLIC_WEBHOOK_URL: "https://pub", POLL_INTERVAL_MS: "5000", CHANNEL_TTL_SECONDS: "3600" } as any);
    expect(c.publicWebhookUrl).toBe("https://pub");
    expect(c.pollIntervalMs).toBe(5000);
    expect(c.channelTtlSeconds).toBe(3600);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/config.test.ts`
Expected: FAIL — those fields don't exist on `Config`.

- [ ] **Step 3: Extend `server/src/config.ts`**

Add to the `Config` type:

```ts
  publicWebhookUrl?: string;
  pollIntervalMs: number;
  channelTtlSeconds: number;
```

Add to the returned object in `loadConfig`:

```ts
    publicWebhookUrl: env.PUBLIC_WEBHOOK_URL,
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 60000),
    channelTtlSeconds: Number(env.CHANNEL_TTL_SECONDS ?? 604800),
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire `server/src/server.ts`**

Add imports:

```ts
import { WatchChannelStore } from "./watch-channel-store.js";
import { WatchService } from "./watch-service.js";
import { WatchScheduler } from "./watch-scheduler.js";
```

After the existing `const workspaces = ...`, `driveFor`, `realtime` and the `users` construction, build the watch stack. Note `users` is currently constructed inline inside `buildApp({ users: new UserStore(...) })` — hoist it to a named `const users = new UserStore(config.dbPath, config.tokenEncKey);` so both `buildApp` and `WatchService` share it. Then:

```ts
const users = new UserStore(config.dbPath, config.tokenEncKey);
const watch = new WatchChannelStore(config.dbPath);
const watchService = new WatchService({ config, users, workspaces, watch, driveFor, realtime });
```

Pass `users` and `watchService` into `buildApp({ ..., users, ..., watchService })`. After `app.listen(...).then(...)` attaches the ws server, also start the scheduler:

```ts
    new WatchScheduler({ service: watchService, pollIntervalMs: config.pollIntervalMs }).start();
```

(Place it inside the same `.then((addr) => { ... })` callback as `attachWsServer(...)`.)

- [ ] **Step 6: Full server suite + typecheck**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: all green, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/config.ts server/src/server.ts server/src/config.test.ts
git commit -m "feat(server): config PUBLIC_WEBHOOK_URL/poll/ttl + wire WatchService + scheduler"
```

---

### Task 8: Manual verification doc

**Files:**
- Create: `docs/sync-phase-4-verification.md`

**Interfaces:**
- Consumes: nothing.
- Produces: an operator runbook proving outside-edit sync via both the webhook and the poll fallback.

- [ ] **Step 1: Create `docs/sync-phase-4-verification.md`**

```markdown
# Drive Sync DS-Phase 4 — manual verification

Prereq: backend running with a real Google OAuth client + Drive API; sign in and enable sync on a workspace (DS-Phase 1-2 steps); a second VS Code window signed in as the same account, connected (DS-Phase 3 realtime working).

## A. Poll fallback (no public URL needed)
1. Leave `PUBLIC_WEBHOOK_URL` unset. Restart the backend (default `POLL_INTERVAL_MS=60000`; set `POLL_INTERVAL_MS=5000` to speed up the test).
2. Open the workspace's JSON file directly in Google Drive (drive.google.com) and edit it (e.g. add a request object by hand), or edit from a device outside restman.
3. Within one poll interval, both restman windows should show the outside change (poll detects the head-revision bump → broadcast → clients pull). Confirm no change is lost and secrets stay intact.

## B. Webhook (real-time outside-edit sync)
1. Expose the backend over HTTPS (e.g. `ngrok http 8787`) and set `PUBLIC_WEBHOOK_URL=https://<id>.ngrok.io`. Restart the backend.
2. Re-enable sync on the workspace (or wait for renewal) so a `files.watch` channel registers against the ngrok `/webhook`.
3. Edit the file directly in Google Drive again. Within a second or two (no waiting for the poll interval), both windows should update — Drive fired the webhook.

## C. Echo suppression
1. From restman, make a normal edit (auto-push). Confirm the backend does NOT emit a second redundant `workspace-changed` for that same write (the webhook/poll sees an unchanged head revision vs the stored one → no broadcast). The pusher shouldn't get a spurious extra pull.

## D. Renewal
1. With a public URL set, confirm the `watch_channels` row's `expiration` refreshes over time (renewal runs hourly by default, re-registering channels within ~1 day of expiry) so sync survives past the original channel lifetime.
```

- [ ] **Step 2: Commit**

```bash
git add docs/sync-phase-4-verification.md
git commit -m "docs: Drive sync phase 4 manual verification"
```

---

## Self-Review

**Spec coverage (build-order #4 = "Watch channels + webhook + renewal (outside-edit sync)"):**
- Registers Drive `files.watch` per synced workspace file → Task 1 (`watchFile`) + Task 5 (`ensureWatch` on enable). ✓
- Receives change webhooks → Task 4 (`POST /webhook`) + Task 3 (`handleNotification`, token-verified per spec line 170). ✓
- Renews before expiry (cron) → Task 6 (`renewExpiring` + `WatchScheduler`). ✓
- Periodic poll fallback → Task 6 (`pollAll`). ✓
- `watch_channels(workspace_id, channel_id, resource_id, expiration)` table → Task 2 (adds `token` too, for webhook auth). ✓
- Outside edit → Drive fires `/webhook` → backend re-reads, bumps revision, broadcasts → members pull (spec lines 129-130) → Task 3 `detectAndBroadcast`. ✓
- Owner-only credentials for Drive calls (Phase-4 scope) → `driveForOwner` via `users.getById`. ✓
- Public-HTTPS webhook requirement (spec line 205) → `PUBLIC_WEBHOOK_URL` config, gracefully optional with poll fallback. ✓

Explicitly out of DS-Phase 4 (later): sharing/members/roles + fanning webhook broadcasts to non-owner members (DS-Phase 5 — `Realtime` only knows the owner's sockets in Phase 4); offline queue/toasts (DS-Phase 6). No extension-side changes: the DS-Phase-3 `SyncSocket` → `pullIfNewer` path already consumes `workspace-changed`, and `pullIfNewer` correctly pulls because a real outside edit produces a revision ≠ the client's `lastRevision`.

**Placeholder scan:** none — every code step carries full code. Task 5 Step 6 and Task 7 Step 5 describe edits to existing files in prose because they adapt to current file contents; both name the exact insertion point, the exact statement to add, and the assertion to make.

**Type consistency:** `WatchOpts`/`WatchInfo` (Task 1) consumed by `ensureWatch` (Task 5). `WatchChannel` (Task 2) used by `WatchService` + tests everywhere. `WatchDeps.config` widens monotonically: `Pick<Config,'publicWebhookUrl'>` (Task 3) → adds `'channelTtlSeconds'` (Task 5); `Config` gains both plus `pollIntervalMs` in Task 7 — the earlier `Pick` subsets stay satisfied. `WatchService` method set — `detectAndBroadcast`/`handleNotification` (Task 3), `ensureWatch` (Task 5), `pollAll`/`renewExpiring` (Task 6) — matches the `WatchScheduler` (Task 6) and `server.ts` (Task 7) call sites. `AppDeps.watchService?` (Task 4) is optional so every prior `buildApp` caller compiles unchanged; only the webhook + create tests supply it. Workspace `revision == headRevisionId` invariant is consumed identically by `detectAndBroadcast` and preserved by the existing PUT/POST handlers.

**Echo/idempotence check:** webhook and poll share `detectAndBroadcast`, which is idempotent — whichever fires first sets the stored revision to the current head; the other then sees `head === revision` → `'echo'` → no duplicate broadcast. Our own push sets the stored revision to the head it just wrote, so its webhook echo is suppressed. Verified against the revision model.

**Integration risk called out:** `server.ts` wiring (Task 7) and the `WatchScheduler` interval loop are not unit-tested against a live process — the scheduler's *logic* (`pollAll`/`renewExpiring`) and the *timer wiring* (`WatchScheduler` with fake timers) are unit-tested separately; the real Google `files.watch` + webhook round-trip is covered by the Task 8 manual runbook (needs ngrok + a real Drive file).
