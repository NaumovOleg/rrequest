# Drive Sync — Phase 2: Drive Push/Pull for One Workspace (owner) + Extension Sync Client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner can sign in, enable sync on a workspace, and have its collections + environments (secrets stripped) stored as one JSON file in their Google Drive under `{hash}-restman/<name>-<id>.json`, with working push (local → Drive) and pull (Drive → local).

**Architecture:** Extends the Phase-1 backend (`server/`) with a Drive layer (`DriveClient` + a per-user factory), a `WorkspaceStore` (SQLite), an extracted auth middleware, and four authenticated owner-only endpoints (`GET/POST /workspaces`, `PUT/GET /workspaces/:id`). On the extension side, a new `src/extension/sync/` module: pure snapshot build/apply, a `SyncStateStore` (JSON in globalStorage), a `SyncClient` (REST + token), a loopback login helper, and three commands (`Sign in`, `Enable sync`, `Sync now`). No realtime, sharing, or merge yet.

**Tech Stack:** Backend — Node 18+, TypeScript, Fastify, better-sqlite3, google-auth-library, global `fetch`, vitest. Extension — existing restman stack (TypeScript, vitest), Node `http` + `vscode` API.

## Global Constraints

- Reuse Phase-1 rules: Node **>= 18**, TypeScript, ESM in `server/`; all Google-facing calls on the backend; refresh tokens encrypted at rest; the extension holds only the app-session JWT (in VS Code SecretStorage).
- Phase 2 is **owner-only**: every workspace endpoint requires the caller to be the workspace's owner. No sharing/members yet.
- Drive layout: one folder per owner named **`<hash>-restman`** where `hash` = first 8 hex chars of `sha256(userId)`; one file per workspace named **`<name>-<workspaceId>.json`**.
- Sync content = **collections + environments only**; environment variables with `secret: true` are pushed with `value: ""`. History is never synced.
- No realtime, no Drive watch, no sharing, no merge/revision-conflict handling in Phase 2 (push is a straight write; the revision is stored and returned but conflicts are Phase 3).
- Backend code under `server/`; extension code under `src/` following existing restman patterns. Do not modify the extension's unrelated files.
- The extension's `RestRequest`/`Collection`/`Environment`/`KeyValue` types live in `src/shared/types.ts` and must be reused (not redefined).

---

### Task 1: WorkspaceStore (SQLite)

**Files:**
- Create: `server/src/workspace-store.ts`
- Test: `server/src/workspace-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SyncedWorkspace = { id: string; name: string; ownerUserId: string; driveFileId: string; hashFolderId: string; revision: string; updatedAt: number }`
  - `class WorkspaceStore { constructor(dbPath: string); upsert(w: SyncedWorkspace): SyncedWorkspace; get(id: string): SyncedWorkspace | undefined; listByOwner(ownerUserId: string): SyncedWorkspace[]; setRevision(id: string, revision: string, updatedAt: number): void }`
  - Tests use `":memory:"`.

- [ ] **Step 1: Write the failing test** — `server/src/workspace-store.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { WorkspaceStore, type SyncedWorkspace } from "./workspace-store";

const w = (over: Partial<SyncedWorkspace> = {}): SyncedWorkspace => ({
  id: "ws1", name: "Team", ownerUserId: "u1", driveFileId: "f1", hashFolderId: "fold1", revision: "r0", updatedAt: 1, ...over,
});

describe("WorkspaceStore", () => {
  it("upserts (insert then update) and reads back", () => {
    const s = new WorkspaceStore(":memory:");
    s.upsert(w());
    expect(s.get("ws1")?.driveFileId).toBe("f1");
    s.upsert(w({ name: "Renamed", driveFileId: "f2" }));
    expect(s.get("ws1")?.name).toBe("Renamed");
    expect(s.get("ws1")?.driveFileId).toBe("f2");
  });
  it("lists by owner", () => {
    const s = new WorkspaceStore(":memory:");
    s.upsert(w({ id: "a", ownerUserId: "u1" }));
    s.upsert(w({ id: "b", ownerUserId: "u2" }));
    s.upsert(w({ id: "c", ownerUserId: "u1" }));
    expect(s.listByOwner("u1").map((x) => x.id).sort()).toEqual(["a", "c"]);
  });
  it("updates revision + updatedAt", () => {
    const s = new WorkspaceStore(":memory:");
    s.upsert(w());
    s.setRevision("ws1", "r5", 999);
    expect(s.get("ws1")?.revision).toBe("r5");
    expect(s.get("ws1")?.updatedAt).toBe(999);
  });
  it("returns undefined for unknown id", () => {
    expect(new WorkspaceStore(":memory:").get("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/workspace-store.test.ts`
Expected: FAIL — cannot find module `./workspace-store`.

- [ ] **Step 3: Implement `server/src/workspace-store.ts`**

```ts
import Database from "better-sqlite3";

export type SyncedWorkspace = {
  id: string;
  name: string;
  ownerUserId: string;
  driveFileId: string;
  hashFolderId: string;
  revision: string;
  updatedAt: number;
};

type Row = {
  id: string; name: string; owner_user_id: string; drive_file_id: string;
  hash_folder_id: string; revision: string; updated_at: number;
};

const toWorkspace = (r: Row): SyncedWorkspace => ({
  id: r.id, name: r.name, ownerUserId: r.owner_user_id, driveFileId: r.drive_file_id,
  hashFolderId: r.hash_folder_id, revision: r.revision, updatedAt: r.updated_at,
});

export class WorkspaceStore {
  private db: Database.Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      drive_file_id TEXT NOT NULL,
      hash_folder_id TEXT NOT NULL,
      revision TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }

  upsert(w: SyncedWorkspace): SyncedWorkspace {
    this.db.prepare(`INSERT INTO workspaces (id, name, owner_user_id, drive_file_id, hash_folder_id, revision, updated_at)
      VALUES (@id, @name, @ownerUserId, @driveFileId, @hashFolderId, @revision, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, owner_user_id=excluded.owner_user_id, drive_file_id=excluded.drive_file_id,
        hash_folder_id=excluded.hash_folder_id, revision=excluded.revision, updated_at=excluded.updated_at`).run(w);
    return w;
  }

  get(id: string): SyncedWorkspace | undefined {
    const r = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as Row | undefined;
    return r ? toWorkspace(r) : undefined;
  }

  listByOwner(ownerUserId: string): SyncedWorkspace[] {
    const rows = this.db.prepare("SELECT * FROM workspaces WHERE owner_user_id = ?").all(ownerUserId) as Row[];
    return rows.map(toWorkspace);
  }

  setRevision(id: string, revision: string, updatedAt: number): void {
    this.db.prepare("UPDATE workspaces SET revision = ?, updated_at = ? WHERE id = ?").run(revision, updatedAt, id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/workspace-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/workspace-store.ts server/src/workspace-store.test.ts
git commit -m "feat(server): WorkspaceStore for synced workspaces (sqlite)"
```

---

### Task 2: DriveClient interface + fake + Google impl

**Files:**
- Create: `server/src/drive-client.ts`
- Test: `server/src/drive-client.test.ts`

**Interfaces:**
- Consumes: `OAuth2Client` from `google-auth-library`, global `fetch`.
- Produces:
  - `interface DriveClient { ensureFolder(name: string): Promise<string>; createFile(folderId: string, name: string, content: string): Promise<{ fileId: string; revision: string }>; updateFile(fileId: string, content: string): Promise<{ revision: string }>; readFile(fileId: string): Promise<string> }`
  - `class GoogleDriveClient implements DriveClient` — constructed with `(getAccessToken: () => Promise<string>, fetchImpl?: typeof fetch)`.
  - `class FakeDriveClient implements DriveClient` — in-memory, exported for tests in later tasks (folders keyed by name; files store content + an incrementing revision).

- [ ] **Step 1: Write the failing test** — `server/src/drive-client.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { FakeDriveClient } from "./drive-client";

describe("FakeDriveClient", () => {
  it("ensures a folder idempotently (same id for the same name)", async () => {
    const d = new FakeDriveClient();
    const a = await d.ensureFolder("h-restman");
    const b = await d.ensureFolder("h-restman");
    expect(a).toBe(b);
  });
  it("creates, reads, and updates a file, bumping the revision", async () => {
    const d = new FakeDriveClient();
    const folder = await d.ensureFolder("h-restman");
    const created = await d.createFile(folder, "w.json", "v1");
    expect(await d.readFile(created.fileId)).toBe("v1");
    const updated = await d.updateFile(created.fileId, "v2");
    expect(await d.readFile(created.fileId)).toBe("v2");
    expect(updated.revision).not.toBe(created.revision);
  });
  it("throws reading an unknown file", async () => {
    await expect(new FakeDriveClient().readFile("nope")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/drive-client.test.ts`
Expected: FAIL — cannot find module `./drive-client`.

- [ ] **Step 3: Implement `server/src/drive-client.ts`**

```ts
export interface DriveClient {
  ensureFolder(name: string): Promise<string>;
  createFile(folderId: string, name: string, content: string): Promise<{ fileId: string; revision: string }>;
  updateFile(fileId: string, content: string): Promise<{ revision: string }>;
  readFile(fileId: string): Promise<string>;
}

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export class GoogleDriveClient implements DriveClient {
  constructor(private getAccessToken: () => Promise<string>, private fetchImpl: typeof fetch = fetch) {}

  private async auth(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.getAccessToken()}` };
  }

  async ensureFolder(name: string): Promise<string> {
    const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const listRes = await this.fetchImpl(`${DRIVE}/files?q=${q}&fields=files(id)&spaces=drive`, { headers: await this.auth() });
    if (!listRes.ok) throw new Error(`Drive list failed: ${listRes.status}`);
    const list = (await listRes.json()) as { files?: { id: string }[] };
    if (list.files && list.files[0]) return list.files[0].id;
    const createRes = await this.fetchImpl(`${DRIVE}/files?fields=id`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
    });
    if (!createRes.ok) throw new Error(`Drive folder create failed: ${createRes.status}`);
    return ((await createRes.json()) as { id: string }).id;
  }

  async createFile(folderId: string, name: string, content: string): Promise<{ fileId: string; revision: string }> {
    const boundary = "rmbnd" + Math.random().toString(36).slice(2);
    const metadata = JSON.stringify({ name, parents: [folderId] });
    const body =
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\ncontent-type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    const res = await this.fetchImpl(`${UPLOAD}/files?uploadType=multipart&fields=id,headRevisionId`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`Drive create failed: ${res.status}`);
    const j = (await res.json()) as { id: string; headRevisionId?: string };
    return { fileId: j.id, revision: j.headRevisionId ?? "" };
  }

  async updateFile(fileId: string, content: string): Promise<{ revision: string }> {
    const res = await this.fetchImpl(`${UPLOAD}/files/${fileId}?uploadType=media&fields=headRevisionId`, {
      method: "PATCH",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: content,
    });
    if (!res.ok) throw new Error(`Drive update failed: ${res.status}`);
    return { revision: ((await res.json()) as { headRevisionId?: string }).headRevisionId ?? "" };
  }

  async readFile(fileId: string): Promise<string> {
    const res = await this.fetchImpl(`${DRIVE}/files/${fileId}?alt=media`, { headers: await this.auth() });
    if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
    return await res.text();
  }
}

// In-memory DriveClient for tests.
export class FakeDriveClient implements DriveClient {
  private folders = new Map<string, string>();
  private files = new Map<string, { content: string; revision: number }>();
  private seq = 0;

  async ensureFolder(name: string): Promise<string> {
    if (!this.folders.has(name)) this.folders.set(name, `folder-${name}`);
    return this.folders.get(name)!;
  }
  async createFile(_folderId: string, _name: string, content: string): Promise<{ fileId: string; revision: string }> {
    const fileId = `file-${++this.seq}`;
    this.files.set(fileId, { content, revision: 1 });
    return { fileId, revision: "1" };
  }
  async updateFile(fileId: string, content: string): Promise<{ revision: string }> {
    const f = this.files.get(fileId);
    if (!f) throw new Error("file not found");
    f.content = content;
    f.revision += 1;
    return { revision: String(f.revision) };
  }
  async readFile(fileId: string): Promise<string> {
    const f = this.files.get(fileId);
    if (!f) throw new Error("file not found");
    return f.content;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/drive-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/drive-client.ts server/src/drive-client.test.ts
git commit -m "feat(server): DriveClient (Google impl + in-memory fake)"
```

---

### Task 3: Per-user Drive factory + folder hash

**Files:**
- Create: `server/src/drive-factory.ts`
- Test: `server/src/drive-factory.test.ts`

**Interfaces:**
- Consumes: `OAuth2Client` from `google-auth-library`, `GoogleDriveClient` + `DriveClient` from `./drive-client`, `User` from `./user-store`, `Config` from `./config`.
- Produces:
  - `folderNameForUser(userId: string): string` → `"<8hex>-restman"`.
  - `type DriveFactory = (user: User) => DriveClient`.
  - `makeDriveFactory(config: Config): DriveFactory` — builds a `GoogleDriveClient` whose access token is fetched from an `OAuth2Client` seeded with the user's refresh token.

- [ ] **Step 1: Write the failing test** — `server/src/drive-factory.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { folderNameForUser } from "./drive-factory";

describe("folderNameForUser", () => {
  it("is stable per user and ends with -restman", () => {
    const a = folderNameForUser("user-123");
    expect(a).toMatch(/^[0-9a-f]{8}-restman$/);
    expect(folderNameForUser("user-123")).toBe(a);
    expect(folderNameForUser("user-999")).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/drive-factory.test.ts`
Expected: FAIL — cannot find module `./drive-factory`.

- [ ] **Step 3: Implement `server/src/drive-factory.ts`**

```ts
import { createHash } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { GoogleDriveClient, type DriveClient } from "./drive-client.js";
import type { User } from "./user-store.js";
import type { Config } from "./config.js";

export function folderNameForUser(userId: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `${hash}-restman`;
}

export type DriveFactory = (user: User) => DriveClient;

export function makeDriveFactory(config: Config): DriveFactory {
  return (user: User): DriveClient => {
    const oauth = new OAuth2Client(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);
    oauth.setCredentials({ refresh_token: user.refreshToken });
    const getAccessToken = async (): Promise<string> => {
      const { token } = await oauth.getAccessToken();
      if (!token) throw new Error("could not obtain a Google access token");
      return token;
    };
    return new GoogleDriveClient(getAccessToken);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/drive-factory.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/drive-factory.ts server/src/drive-factory.test.ts
git commit -m "feat(server): per-user Drive factory + owner folder hash"
```

---

### Task 4: Auth middleware (extract from /me) + AppDeps extension

**Files:**
- Create: `server/src/auth.ts`
- Modify: `server/src/app.ts` (add `workspaces`, `driveFor` to `AppDeps`; refactor `/me` to use the helper)
- Test: `server/src/auth.test.ts`

**Interfaces:**
- Consumes: `verifySession` from `./jwt`, `UserStore` from `./user-store`.
- Produces:
  - `function requireUser(req: { headers: { authorization?: string } }, deps: { config: { jwtSecret: string }; users: UserStore }): User | null` — extracts the Bearer token, verifies it, loads the user; returns the `User` or `null`.
  - `AppDeps` gains `workspaces: WorkspaceStore` and `driveFor: DriveFactory`.

- [ ] **Step 1: Write the failing test** — `server/src/auth.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { requireUser } from "./auth";
import { UserStore } from "./user-store";
import { signSession } from "./jwt";

const deps = () => {
  const users = new UserStore(":memory:", "k");
  const u = users.upsertByGoogle({ googleSub: "g", email: "a@x.com", refreshToken: "rt" });
  return { deps: { config: { jwtSecret: "j" }, users }, user: u };
};

describe("requireUser", () => {
  it("returns the user for a valid Bearer token", () => {
    const { deps: d, user } = deps();
    const req = { headers: { authorization: `Bearer ${signSession(user.id, "j")}` } };
    expect(requireUser(req, d)?.id).toBe(user.id);
  });
  it("returns null without a token", () => {
    const { deps: d } = deps();
    expect(requireUser({ headers: {} }, d)).toBeNull();
  });
  it("returns null when the user no longer exists", () => {
    const { deps: d } = deps();
    const req = { headers: { authorization: `Bearer ${signSession("ghost", "j")}` } };
    expect(requireUser(req, d)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/auth.test.ts`
Expected: FAIL — cannot find module `./auth`.

- [ ] **Step 3: Implement `server/src/auth.ts`**

```ts
import { verifySession } from "./jwt.js";
import type { UserStore, User } from "./user-store.js";

export function requireUser(
  req: { headers: { authorization?: string } },
  deps: { config: { jwtSecret: string }; users: UserStore },
): User | null {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = verifySession(token, deps.config.jwtSecret);
  if (!session) return null;
  return deps.users.getById(session.userId) ?? null;
}
```

- [ ] **Step 4: Extend `AppDeps` and refactor `/me` in `server/src/app.ts`**

Add these imports at the top of `app.ts`:

```ts
import type { WorkspaceStore } from "./workspace-store.js";
import type { DriveFactory } from "./drive-factory.js";
import { requireUser } from "./auth.js";
```

Add two fields to the `AppDeps` type:

```ts
  workspaces: WorkspaceStore;
  driveFor: DriveFactory;
```

Replace the body of the `/me` route with the shared helper:

```ts
  app.get("/me", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { id: user.id, email: user.email };
  });
```

- [ ] **Step 5: Update existing app tests to supply the new deps**

The app test helpers construct `buildApp({...})`. In `server/src/app.health.test.ts`, `server/src/app.auth.test.ts`, and `server/src/app.me.test.ts`, add to every `buildApp({...})` deps object:

```ts
      workspaces: new WorkspaceStore(":memory:"),
      driveFor: () => new FakeDriveClient(),
```

and add the imports at the top of each of those three test files:

```ts
import { WorkspaceStore } from "./workspace-store";
import { FakeDriveClient } from "./drive-client";
```

- [ ] **Step 6: Run the full suite to verify it passes**

Run: `cd server && npx vitest run`
Expected: PASS — all prior suites still green plus `auth.test.ts` (3 tests).

- [ ] **Step 7: Commit**

```bash
git add server/src/auth.ts server/src/auth.test.ts server/src/app.ts server/src/app.health.test.ts server/src/app.auth.test.ts server/src/app.me.test.ts
git commit -m "feat(server): requireUser middleware + AppDeps workspaces/driveFor"
```

---

### Task 5: `POST /workspaces` — enable sync (create Drive file + row)

**Files:**
- Modify: `server/src/app.ts` (add route)
- Test: `server/src/app.workspaces-create.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `deps.driveFor(user)`, `deps.workspaces.upsert`, `folderNameForUser` from `./drive-factory`.
- Produces: `POST /workspaces` body `{ workspaceId: string; name: string; snapshot: string }` → 201 `{ driveFileId, revision }`. 401 if unauthenticated.

- [ ] **Step 1: Write the failing test** — `server/src/app.workspaces-create.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { signSession } from "./jwt";

const cfg = {
  port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k",
  googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback",
};
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "cid");

function make() {
  const users = new UserStore(":memory:", "k");
  const user = users.upsertByGoogle({ googleSub: "g", email: "a@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive });
  return { app, user, workspaces, token: signSession(user.id, "j") };
}

describe("POST /workspaces", () => {
  it("creates the Drive file, stores a row, returns driveFileId + revision", async () => {
    const { app, user, workspaces, token } = make();
    const res = await app.inject({
      method: "POST", url: "/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId: "ws1", name: "Team", snapshot: '{"version":1}' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.driveFileId).toBeTruthy();
    expect(body.revision).toBe("1");
    const row = workspaces.get("ws1")!;
    expect(row.ownerUserId).toBe(user.id);
    expect(row.driveFileId).toBe(body.driveFileId);
  });
  it("401 without a token", async () => {
    const { app } = make();
    const res = await app.inject({ method: "POST", url: "/workspaces", payload: { workspaceId: "ws1", name: "T", snapshot: "{}" } });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/app.workspaces-create.test.ts`
Expected: FAIL — POST /workspaces returns 404.

- [ ] **Step 3: Add the route in `server/src/app.ts`**

Add to the imports at the top:

```ts
import { folderNameForUser } from "./drive-factory.js";
```

Insert inside `buildApp`, before `return app;`:

```ts
  app.post("/workspaces", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { workspaceId, name, snapshot } = req.body as { workspaceId?: string; name?: string; snapshot?: string };
    if (!workspaceId || !name || typeof snapshot !== "string") return reply.code(400).send({ error: "workspaceId, name, snapshot required" });
    const drive = deps.driveFor(user);
    const folderId = await drive.ensureFolder(folderNameForUser(user.id));
    const { fileId, revision } = await drive.createFile(folderId, `${name}-${workspaceId}.json`, snapshot);
    const now = Date.now();
    deps.workspaces.upsert({ id: workspaceId, name, ownerUserId: user.id, driveFileId: fileId, hashFolderId: folderId, revision, updatedAt: now });
    return reply.code(201).send({ driveFileId: fileId, revision });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/app.workspaces-create.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/app.workspaces-create.test.ts
git commit -m "feat(server): POST /workspaces enables sync (create drive file + row)"
```

---

### Task 6: `PUT /workspaces/:id` (push) and `GET /workspaces/:id` (pull) + `GET /workspaces` (list)

**Files:**
- Modify: `server/src/app.ts` (add three routes)
- Test: `server/src/app.workspaces-rw.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `deps.driveFor`, `deps.workspaces.get/listByOwner/setRevision`.
- Produces:
  - `GET /workspaces` → 200 `SyncedWorkspace[]` (owner's).
  - `PUT /workspaces/:id` body `{ snapshot: string }` → owner-only → writes Drive, bumps revision → 200 `{ revision }`. 404 unknown, 403 not owner.
  - `GET /workspaces/:id` → owner-only → 200 `{ snapshot, revision }`.

- [ ] **Step 1: Write the failing test** — `server/src/app.workspaces-rw.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { signSession } from "./jwt";

const cfg = {
  port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k",
  googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback",
};
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "cid");

async function seeded() {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "g1", email: "o@x.com", refreshToken: "rt" });
  const other = users.upsertByGoogle({ googleSub: "g2", email: "b@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive });
  const tokenOwner = signSession(owner.id, "j");
  await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${tokenOwner}` }, payload: { workspaceId: "ws1", name: "Team", snapshot: '{"v":1}' } });
  return { app, workspaces, tokenOwner, tokenOther: signSession(other.id, "j") };
}

describe("workspace read/write", () => {
  it("GET /workspaces lists the owner's workspaces", async () => {
    const { app, tokenOwner } = await seeded();
    const res = await app.inject({ method: "GET", url: "/workspaces", headers: { authorization: `Bearer ${tokenOwner}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((w: any) => w.id)).toEqual(["ws1"]);
  });
  it("PUT pushes a new snapshot and bumps the revision", async () => {
    const { app, tokenOwner, workspaces } = await seeded();
    const res = await app.inject({ method: "PUT", url: "/workspaces/ws1", headers: { authorization: `Bearer ${tokenOwner}` }, payload: { snapshot: '{"v":2}' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().revision).toBe("2");
    expect(workspaces.get("ws1")?.revision).toBe("2");
  });
  it("GET /workspaces/:id pulls the current snapshot", async () => {
    const { app, tokenOwner } = await seeded();
    await app.inject({ method: "PUT", url: "/workspaces/ws1", headers: { authorization: `Bearer ${tokenOwner}` }, payload: { snapshot: '{"v":2}' } });
    const res = await app.inject({ method: "GET", url: "/workspaces/ws1", headers: { authorization: `Bearer ${tokenOwner}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ snapshot: '{"v":2}', revision: "2" });
  });
  it("403 when a non-owner tries to push", async () => {
    const { app, tokenOther } = await seeded();
    const res = await app.inject({ method: "PUT", url: "/workspaces/ws1", headers: { authorization: `Bearer ${tokenOther}` }, payload: { snapshot: "{}" } });
    expect(res.statusCode).toBe(403);
  });
  it("404 for an unknown workspace", async () => {
    const { app, tokenOwner } = await seeded();
    const res = await app.inject({ method: "GET", url: "/workspaces/nope", headers: { authorization: `Bearer ${tokenOwner}` } });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/app.workspaces-rw.test.ts`
Expected: FAIL — routes return 404.

- [ ] **Step 3: Add the three routes in `server/src/app.ts`** (before `return app;`)

```ts
  app.get("/workspaces", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return deps.workspaces.listByOwner(user.id);
  });

  app.put("/workspaces/:id", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const id = (req.params as { id: string }).id;
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    if (ws.ownerUserId !== user.id) return reply.code(403).send({ error: "forbidden" });
    const { snapshot } = req.body as { snapshot?: string };
    if (typeof snapshot !== "string") return reply.code(400).send({ error: "snapshot required" });
    const { revision } = await deps.driveFor(user).updateFile(ws.driveFileId, snapshot);
    deps.workspaces.setRevision(id, revision, Date.now());
    return { revision };
  });

  app.get("/workspaces/:id", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const id = (req.params as { id: string }).id;
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    if (ws.ownerUserId !== user.id) return reply.code(403).send({ error: "forbidden" });
    const snapshot = await deps.driveFor(user).readFile(ws.driveFileId);
    return { snapshot, revision: ws.revision };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/app.workspaces-rw.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/app.workspaces-rw.test.ts
git commit -m "feat(server): workspace list/push/pull endpoints (owner-only)"
```

---

### Task 7: Wire the new deps into `server.ts` + README update

**Files:**
- Modify: `server/src/server.ts` (construct `WorkspaceStore` + `makeDriveFactory`)
- Modify: `server/README.md` (document the workspace endpoints)

**Interfaces:**
- Consumes: `WorkspaceStore`, `makeDriveFactory`.
- Produces: a server that boots with the workspace endpoints live.

- [ ] **Step 1: Update `server/src/server.ts`**

Add imports:

```ts
import { WorkspaceStore } from "./workspace-store.js";
import { makeDriveFactory } from "./drive-factory.js";
```

Add these two lines before `const app = buildApp({...})`:

```ts
const workspaces = new WorkspaceStore(config.dbPath);
const driveFor = makeDriveFactory(config);
```

Add `workspaces` and `driveFor` to the `buildApp({...})` deps object (alongside `config, users, google, states`).

- [ ] **Step 2: Append workspace endpoints to `server/README.md`** (under the Endpoints section)

```markdown
- `GET /workspaces` (Bearer JWT) → the caller's synced workspaces.
- `POST /workspaces` (Bearer JWT) `{ workspaceId, name, snapshot }` → creates the Drive file under `<hash>-restman/`, stores a row, returns `{ driveFileId, revision }`.
- `PUT /workspaces/:id` (Bearer JWT, owner) `{ snapshot }` → pushes, returns `{ revision }`.
- `GET /workspaces/:id` (Bearer JWT, owner) → pulls, returns `{ snapshot, revision }`.
```

- [ ] **Step 3: Typecheck + full suite**

Run: `cd server && npm run typecheck && npx vitest run`
Expected: typecheck clean; all suites pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/server.ts server/README.md
git commit -m "feat(server): wire workspace store + drive factory into entry"
```

---

### Task 8: Snapshot build/apply (extension, pure functions)

**Files:**
- Create: `src/extension/sync/snapshot.ts`
- Test: `test/extension/sync/snapshot.test.ts`

**Interfaces:**
- Consumes: `Collection`, `Environment`, `KeyValue` from `src/shared/types`.
- Produces:
  - `type WorkspaceSnapshot = { version: 1; workspaceId: string; name: string; collections: Collection[]; environments: Environment[]; updatedAt: number; updatedBy: string }`
  - `buildSnapshot(input: { workspaceId: string; name: string; collections: Collection[]; environments: Environment[]; updatedBy: string }): WorkspaceSnapshot` — deep-copies and blanks secret env var values (`value: ""` where `secret === true`).
  - `mergeEnvironmentsPreservingSecrets(incoming: Environment[], local: Environment[]): Environment[]` — for pull: for each incoming env var with `secret === true` and empty `value`, if a local var with the same env id + key has a non-empty value, keep the local value.

- [ ] **Step 1: Write the failing test** — `test/extension/sync/snapshot.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { buildSnapshot, mergeEnvironmentsPreservingSecrets } from '../../../src/extension/sync/snapshot'
import type { Environment } from '../../../src/shared/types'

const env = (over: Partial<Environment> = {}): Environment => ({ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [], ...over })

describe('buildSnapshot', () => {
  it('strips secret env values but keeps the key + non-secret values', () => {
    const snap = buildSnapshot({
      workspaceId: 'w1', name: 'W', updatedBy: 'a@x.com', collections: [],
      environments: [env({ variables: [
        { key: 'base', value: 'https://api', enabled: true },
        { key: 'token', value: 'abc123', enabled: true, secret: true },
      ] })],
    })
    expect(snap.version).toBe(1)
    const vars = snap.environments[0].variables
    expect(vars.find((v) => v.key === 'base')?.value).toBe('https://api')
    expect(vars.find((v) => v.key === 'token')?.value).toBe('')
  })
  it('does not mutate the input environments', () => {
    const environments = [env({ variables: [{ key: 'token', value: 'abc', enabled: true, secret: true }] })]
    buildSnapshot({ workspaceId: 'w1', name: 'W', updatedBy: 'a', collections: [], environments })
    expect(environments[0].variables[0].value).toBe('abc')
  })
})

describe('mergeEnvironmentsPreservingSecrets', () => {
  it('restores local secret values when the incoming secret value is empty', () => {
    const incoming = [env({ variables: [{ key: 'token', value: '', enabled: true, secret: true }] })]
    const local = [env({ variables: [{ key: 'token', value: 'local-secret', enabled: true, secret: true }] })]
    const merged = mergeEnvironmentsPreservingSecrets(incoming, local)
    expect(merged[0].variables[0].value).toBe('local-secret')
  })
  it('leaves non-secret and already-filled values untouched', () => {
    const incoming = [env({ variables: [{ key: 'base', value: 'https://api', enabled: true }] })]
    const merged = mergeEnvironmentsPreservingSecrets(incoming, [])
    expect(merged[0].variables[0].value).toBe('https://api')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/sync/snapshot.test.ts`
Expected: FAIL — cannot find module `.../snapshot`.

- [ ] **Step 3: Implement `src/extension/sync/snapshot.ts`**

```ts
import type { Collection, Environment } from '../../shared/types'

export type WorkspaceSnapshot = {
  version: 1
  workspaceId: string
  name: string
  collections: Collection[]
  environments: Environment[]
  updatedAt: number
  updatedBy: string
}

export function buildSnapshot(input: {
  workspaceId: string
  name: string
  collections: Collection[]
  environments: Environment[]
  updatedBy: string
}): WorkspaceSnapshot {
  const environments = input.environments.map((e) => ({
    ...e,
    variables: e.variables.map((v) => (v.secret ? { ...v, value: '' } : { ...v })),
  }))
  return {
    version: 1,
    workspaceId: input.workspaceId,
    name: input.name,
    collections: JSON.parse(JSON.stringify(input.collections)) as Collection[],
    environments,
    updatedAt: Date.now(),
    updatedBy: input.updatedBy,
  }
}

export function mergeEnvironmentsPreservingSecrets(incoming: Environment[], local: Environment[]): Environment[] {
  return incoming.map((env) => {
    const localEnv = local.find((l) => l.id === env.id)
    if (!localEnv) return env
    return {
      ...env,
      variables: env.variables.map((v) => {
        if (v.secret && !v.value) {
          const localVar = localEnv.variables.find((lv) => lv.key === v.key)
          if (localVar && localVar.value) return { ...v, value: localVar.value }
        }
        return v
      }),
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/sync/snapshot.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/sync/snapshot.ts test/extension/sync/snapshot.test.ts
git commit -m "feat(sync): snapshot build (strip secrets) + secret-preserving merge"
```

---

### Task 9: SyncStateStore (local, per-workspace)

**Files:**
- Create: `src/extension/sync/sync-state-store.ts`
- Test: `test/extension/sync/sync-state-store.test.ts`

**Interfaces:**
- Consumes: `readJsonSafe`, `writeJsonAtomic` from `src/extension/atomic-write` (existing helpers used elsewhere in the extension).
- Produces:
  - `type SyncState = { driveFileId: string; ownerEmail: string; role: 'owner' | 'editor' | 'viewer'; lastRevision: string; synced: boolean }`
  - `class SyncStateStore { constructor(baseDir: string); get(workspaceId: string): Promise<SyncState | undefined>; set(workspaceId: string, state: SyncState): Promise<void>; all(): Promise<Record<string, SyncState>> }`
  - Stored as a single JSON file `sync-state.json` under `baseDir`.

- [ ] **Step 1: Write the failing test** — `test/extension/sync/sync-state-store.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SyncStateStore } from '../../../src/extension/sync/sync-state-store'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restman-ss-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const st = (over = {}) => ({ driveFileId: 'f1', ownerEmail: 'a@x.com', role: 'owner' as const, lastRevision: 'r1', synced: true, ...over })

describe('SyncStateStore', () => {
  it('sets and gets per-workspace state', async () => {
    const s = new SyncStateStore(dir)
    await s.set('w1', st())
    expect((await s.get('w1'))?.driveFileId).toBe('f1')
    expect(await s.get('w2')).toBeUndefined()
  })
  it('persists across instances and returns all', async () => {
    await new SyncStateStore(dir).set('w1', st())
    await new SyncStateStore(dir).set('w2', st({ driveFileId: 'f2' }))
    const all = await new SyncStateStore(dir).all()
    expect(Object.keys(all).sort()).toEqual(['w1', 'w2'])
    expect(all.w2.driveFileId).toBe('f2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/sync/sync-state-store.test.ts`
Expected: FAIL — cannot find module `.../sync-state-store`.

- [ ] **Step 3: Implement `src/extension/sync/sync-state-store.ts`**

```ts
import * as path from 'node:path'
import { readJsonSafe, writeJsonAtomic } from '../atomic-write'

export type SyncState = {
  driveFileId: string
  ownerEmail: string
  role: 'owner' | 'editor' | 'viewer'
  lastRevision: string
  synced: boolean
}

export class SyncStateStore {
  private readonly file: string
  constructor(baseDir: string) { this.file = path.join(baseDir, 'sync-state.json') }

  async all(): Promise<Record<string, SyncState>> {
    return (await readJsonSafe<Record<string, SyncState>>(this.file)) ?? {}
  }
  async get(workspaceId: string): Promise<SyncState | undefined> {
    return (await this.all())[workspaceId]
  }
  async set(workspaceId: string, state: SyncState): Promise<void> {
    const all = await this.all()
    all[workspaceId] = state
    await writeJsonAtomic(this.file, all)
  }
}
```

- [ ] **Step 4: Verify `atomic-write` exports** (read-only check)

Run: `grep -n "export" src/extension/atomic-write.ts`
Expected: shows `readJsonSafe` and `writeJsonAtomic`. If the names differ, adjust the import in step 3 to match the actual exports (do not change `atomic-write.ts`).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/extension/sync/sync-state-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/extension/sync/sync-state-store.ts test/extension/sync/sync-state-store.test.ts
git commit -m "feat(sync): local per-workspace SyncStateStore"
```

---

### Task 10: SyncClient (backend REST)

**Files:**
- Create: `src/extension/sync/sync-client.ts`
- Test: `test/extension/sync/sync-client.test.ts`

**Interfaces:**
- Consumes: `WorkspaceSnapshot` from `./snapshot`; global `fetch` (injectable for tests).
- Produces:
  - `type RemoteWorkspace = { id: string; name: string; ownerUserId: string; driveFileId: string; revision: string; updatedAt: number }`
  - `class SyncClient { constructor(opts: { baseUrl: string; getToken: () => string | undefined; fetchImpl?: typeof fetch }); me(): Promise<{ id: string; email: string }>; listWorkspaces(): Promise<RemoteWorkspace[]>; enableSync(workspaceId: string, name: string, snapshot: string): Promise<{ driveFileId: string; revision: string }>; push(id: string, snapshot: string): Promise<{ revision: string }>; pull(id: string): Promise<{ snapshot: string; revision: string }> }`
  - Every call sends `Authorization: Bearer <token>`; a non-2xx response throws `Error` with the status.

- [ ] **Step 1: Write the failing test** — `test/extension/sync/sync-client.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { SyncClient } from '../../../src/extension/sync/sync-client'

function fetchMock(handler: (url: string, init: any) => { status: number; body: any }) {
  return vi.fn(async (url: string, init: any) => {
    const { status, body } = handler(url, init)
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as any
  })
}

const client = (fetchImpl: any) => new SyncClient({ baseUrl: 'http://localhost:8787', getToken: () => 'jwt-1', fetchImpl })

describe('SyncClient', () => {
  it('me() calls /me with the bearer token', async () => {
    let seen: any
    const f = fetchMock((url, init) => { seen = { url, init }; return { status: 200, body: { id: 'u1', email: 'a@x.com' } } })
    const me = await client(f).me()
    expect(me.email).toBe('a@x.com')
    expect(seen.url).toBe('http://localhost:8787/me')
    expect(seen.init.headers.authorization).toBe('Bearer jwt-1')
  })
  it('enableSync POSTs the snapshot and returns driveFileId + revision', async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe('http://localhost:8787/workspaces')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({ workspaceId: 'w1', name: 'W', snapshot: '{"v":1}' })
      return { status: 201, body: { driveFileId: 'f1', revision: '1' } }
    })
    expect(await client(f).enableSync('w1', 'W', '{"v":1}')).toEqual({ driveFileId: 'f1', revision: '1' })
  })
  it('push PUTs to /workspaces/:id', async () => {
    const f = fetchMock((url, init) => { expect(url).toBe('http://localhost:8787/workspaces/w1'); expect(init.method).toBe('PUT'); return { status: 200, body: { revision: '2' } } })
    expect(await client(f).push('w1', '{"v":2}')).toEqual({ revision: '2' })
  })
  it('pull GETs /workspaces/:id', async () => {
    const f = fetchMock(() => ({ status: 200, body: { snapshot: '{"v":2}', revision: '2' } }))
    expect(await client(f).pull('w1')).toEqual({ snapshot: '{"v":2}', revision: '2' })
  })
  it('throws on a non-2xx response', async () => {
    const f = fetchMock(() => ({ status: 403, body: { error: 'forbidden' } }))
    await expect(client(f).push('w1', '{}')).rejects.toThrow(/403/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/sync/sync-client.test.ts`
Expected: FAIL — cannot find module `.../sync-client`.

- [ ] **Step 3: Implement `src/extension/sync/sync-client.ts`**

```ts
export type RemoteWorkspace = {
  id: string
  name: string
  ownerUserId: string
  driveFileId: string
  revision: string
  updatedAt: number
}

export class SyncClient {
  private baseUrl: string
  private getToken: () => string | undefined
  private fetchImpl: typeof fetch
  constructor(opts: { baseUrl: string; getToken: () => string | undefined; fetchImpl?: typeof fetch }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.getToken = opts.getToken
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${this.getToken() ?? ''}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    if (!res.ok) throw new Error(`sync request failed: ${res.status}`)
    return (await res.json()) as T
  }

  me(): Promise<{ id: string; email: string }> {
    return this.call('/me')
  }
  listWorkspaces(): Promise<RemoteWorkspace[]> {
    return this.call('/workspaces')
  }
  enableSync(workspaceId: string, name: string, snapshot: string): Promise<{ driveFileId: string; revision: string }> {
    return this.call('/workspaces', { method: 'POST', body: { workspaceId, name, snapshot } })
  }
  push(id: string, snapshot: string): Promise<{ revision: string }> {
    return this.call(`/workspaces/${id}`, { method: 'PUT', body: { snapshot } })
  }
  pull(id: string): Promise<{ snapshot: string; revision: string }> {
    return this.call(`/workspaces/${id}`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/sync/sync-client.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/sync/sync-client.ts test/extension/sync/sync-client.test.ts
git commit -m "feat(sync): SyncClient backend REST wrapper"
```

---

### Task 11: Loopback login helper (token capture)

**Files:**
- Create: `src/extension/sync/login.ts`
- Test: `test/extension/sync/login.test.ts`

**Interfaces:**
- Consumes: Node `http`.
- Produces:
  - `extractToken(reqUrl: string): string | undefined` — pulls `token` from a callback URL like `/?token=abc`.
  - `signIn(opts: { baseUrl: string; openExternal: (url: string) => void; timeoutMs?: number }): Promise<string>` — starts a loopback `http` server on an ephemeral port, calls `openExternal(<baseUrl>/auth/start?cb=http://localhost:<port>)`, resolves with the captured token when the browser hits the loopback (then closes the server), rejects on timeout.

- [ ] **Step 1: Write the failing test** — `test/extension/sync/login.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import * as http from 'node:http'
import { extractToken, signIn } from '../../../src/extension/sync/login'

describe('extractToken', () => {
  it('reads the token query param', () => {
    expect(extractToken('/?token=abc123')).toBe('abc123')
    expect(extractToken('/')).toBeUndefined()
  })
})

describe('signIn', () => {
  it('opens the browser to /auth/start?cb=<loopback> and resolves with the captured token', async () => {
    let openedUrl = ''
    const openExternal = (url: string) => {
      openedUrl = url
      // Simulate the browser (after Google) hitting the loopback callback with a token.
      const cb = new URL(url).searchParams.get('cb')!
      http.get(`${cb}?token=captured-jwt`, () => {})
    }
    const token = await signIn({ baseUrl: 'http://localhost:8787', openExternal, timeoutMs: 3000 })
    expect(token).toBe('captured-jwt')
    expect(openedUrl).toContain('http://localhost:8787/auth/start?cb=http%3A%2F%2Flocalhost%3A')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/sync/login.test.ts`
Expected: FAIL — cannot find module `.../login`.

- [ ] **Step 3: Implement `src/extension/sync/login.ts`**

```ts
import * as http from 'node:http'

export function extractToken(reqUrl: string): string | undefined {
  const u = new URL(reqUrl, 'http://localhost')
  return u.searchParams.get('token') ?? undefined
}

export function signIn(opts: {
  baseUrl: string
  openExternal: (url: string) => void
  timeoutMs?: number
}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 120000
  return new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const token = extractToken(req.url ?? '/')
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>You can close this tab and return to VS Code.</body></html>')
      if (token) {
        clearTimeout(timer)
        server.close()
        resolve(token)
      }
    })
    const timer = setTimeout(() => { server.close(); reject(new Error('sign-in timed out')) }, timeoutMs)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      const cb = `http://localhost:${port}`
      const base = opts.baseUrl.replace(/\/$/, '')
      opts.openExternal(`${base}/auth/start?cb=${encodeURIComponent(cb)}`)
    })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/sync/login.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/sync/login.ts test/extension/sync/login.test.ts
git commit -m "feat(sync): loopback login helper (token capture)"
```

---

### Task 12: SyncManager (host orchestration: enable/push/pull)

**Files:**
- Create: `src/extension/sync/sync-manager.ts`
- Test: `test/extension/sync/sync-manager.test.ts`

**Interfaces:**
- Consumes: `SyncClient`, `SyncStateStore`, `buildSnapshot`/`mergeEnvironmentsPreservingSecrets` from `./snapshot`, `Collection`/`Environment` from `src/shared/types`.
- Produces:
  - `type StoresPort = { getCollections(workspaceId: string): Promise<Collection[]>; getEnvironments(workspaceId: string): Promise<Environment[]>; applyPulled(workspaceId: string, collections: Collection[], environments: Environment[]): Promise<void> }`
  - `class SyncManager { constructor(deps: { client: SyncClient; state: SyncStateStore; stores: StoresPort; email: () => string }); enable(workspaceId: string, name: string): Promise<void>; push(workspaceId: string): Promise<void>; pull(workspaceId: string): Promise<void> }`
  - `enable`: build snapshot → `client.enableSync` → `state.set(synced:true, role:'owner', ownerEmail, driveFileId, lastRevision)`.
  - `push`: only if synced → build snapshot → `client.push` → update `lastRevision`.
  - `pull`: only if synced → `client.pull` → parse → `mergeEnvironmentsPreservingSecrets(incoming, local)` → `stores.applyPulled` → update `lastRevision`.

- [ ] **Step 1: Write the failing test** — `test/extension/sync/sync-manager.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SyncManager } from '../../../src/extension/sync/sync-manager'
import { SyncStateStore } from '../../../src/extension/sync/sync-state-store'
import type { Collection, Environment } from '../../../src/shared/types'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restman-sm-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const col = (): Collection => ({ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] })
const env = (vars: any[]): Environment => ({ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: vars })

function stores(initial: { collections: Collection[]; environments: Environment[] }) {
  const box = { ...initial, applied: null as any }
  return {
    port: {
      getCollections: async () => box.collections,
      getEnvironments: async () => box.environments,
      applyPulled: async (_id: string, collections: Collection[], environments: Environment[]) => { box.applied = { collections, environments } },
    },
    box,
  }
}

describe('SyncManager', () => {
  it('enable builds a secret-stripped snapshot, calls enableSync, and marks synced', async () => {
    const client = { enableSync: vi.fn(async () => ({ driveFileId: 'f1', revision: '1' })), push: vi.fn(), pull: vi.fn() } as any
    const { port } = stores({ collections: [col()], environments: [env([{ key: 'token', value: 'sekret', enabled: true, secret: true }])] })
    const state = new SyncStateStore(dir)
    await new SyncManager({ client, state, stores: port, email: () => 'a@x.com' }).enable('w1', 'W')
    const snap = JSON.parse(client.enableSync.mock.calls[0][2])
    expect(snap.environments[0].variables[0].value).toBe('') // secret stripped
    expect((await state.get('w1'))?.synced).toBe(true)
    expect((await state.get('w1'))?.lastRevision).toBe('1')
  })

  it('pull merges preserving local secret values and applies to stores', async () => {
    const remoteSnap = JSON.stringify({ version: 1, workspaceId: 'w1', name: 'W', collections: [col()], environments: [env([{ key: 'token', value: '', enabled: true, secret: true }])], updatedAt: 1, updatedBy: 'a' })
    const client = { pull: vi.fn(async () => ({ snapshot: remoteSnap, revision: '5' })), enableSync: vi.fn(), push: vi.fn() } as any
    const { port, box } = stores({ collections: [], environments: [env([{ key: 'token', value: 'local-secret', enabled: true, secret: true }])] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f1', ownerEmail: 'a@x.com', role: 'owner', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'a@x.com' }).pull('w1')
    expect(box.applied.environments[0].variables[0].value).toBe('local-secret')
    expect((await state.get('w1'))?.lastRevision).toBe('5')
  })

  it('push is a no-op when the workspace is not synced', async () => {
    const client = { push: vi.fn(), enableSync: vi.fn(), pull: vi.fn() } as any
    const { port } = stores({ collections: [], environments: [] })
    await new SyncManager({ client, state: new SyncStateStore(dir), stores: port, email: () => 'a@x.com' }).push('w1')
    expect(client.push).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/sync/sync-manager.test.ts`
Expected: FAIL — cannot find module `.../sync-manager`.

- [ ] **Step 3: Implement `src/extension/sync/sync-manager.ts`**

```ts
import type { Collection, Environment } from '../../shared/types'
import type { SyncClient } from './sync-client'
import type { SyncStateStore } from './sync-state-store'
import { buildSnapshot, mergeEnvironmentsPreservingSecrets, type WorkspaceSnapshot } from './snapshot'

export type StoresPort = {
  getCollections(workspaceId: string): Promise<Collection[]>
  getEnvironments(workspaceId: string): Promise<Environment[]>
  applyPulled(workspaceId: string, collections: Collection[], environments: Environment[]): Promise<void>
}

export class SyncManager {
  constructor(private deps: { client: SyncClient; state: SyncStateStore; stores: StoresPort; email: () => string }) {}

  private async snapshotText(workspaceId: string, name: string): Promise<string> {
    const [collections, environments] = await Promise.all([
      this.deps.stores.getCollections(workspaceId),
      this.deps.stores.getEnvironments(workspaceId),
    ])
    return JSON.stringify(buildSnapshot({ workspaceId, name, collections, environments, updatedBy: this.deps.email() }))
  }

  async enable(workspaceId: string, name: string): Promise<void> {
    const snapshot = await this.snapshotText(workspaceId, name)
    const { driveFileId, revision } = await this.deps.client.enableSync(workspaceId, name, snapshot)
    await this.deps.state.set(workspaceId, { driveFileId, ownerEmail: this.deps.email(), role: 'owner', lastRevision: revision, synced: true })
  }

  async push(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return
    // name is carried in the snapshot; re-derive from stores is unnecessary — use the workspace id as the file already exists.
    const snapshot = await this.snapshotText(workspaceId, workspaceId)
    const { revision } = await this.deps.client.push(workspaceId, snapshot)
    await this.deps.state.set(workspaceId, { ...state, lastRevision: revision })
  }

  async pull(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return
    const { snapshot, revision } = await this.deps.client.pull(workspaceId)
    const parsed = JSON.parse(snapshot) as WorkspaceSnapshot
    const local = await this.deps.stores.getEnvironments(workspaceId)
    const environments = mergeEnvironmentsPreservingSecrets(parsed.environments, local)
    await this.deps.stores.applyPulled(workspaceId, parsed.collections, environments)
    await this.deps.state.set(workspaceId, { ...state, lastRevision: revision })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/extension/sync/sync-manager.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/sync/sync-manager.ts test/extension/sync/sync-manager.test.ts
git commit -m "feat(sync): SyncManager (enable/push/pull orchestration)"
```

---

### Task 13: Wire sync into the extension host (commands + config + token storage)

**Files:**
- Modify: `src/extension/extension.ts` (register commands, build the sync stack)
- Create: `src/extension/sync/wiring.ts` (assemble SyncManager from real stores + SecretStorage)
- Modify: `package.json` (contribute commands + `restman.syncServerUrl` setting)
- Test: `test/extension/sync/wiring.test.ts`

**Interfaces:**
- Consumes: everything in `src/extension/sync/`, the existing `CollectionStore`/`EnvironmentStore` (from `src/extension`), `vscode`.
- Produces:
  - `buildStoresPort(collections: CollectionStore, environments: EnvironmentStore): StoresPort` — `getCollections`/`getEnvironments` filter the stores' `list()` by `workspaceId`; `applyPulled` writes each collection via `collections.saveCollection` and each environment via `environments.saveEnvironment`.
  - Three commands: `restman.signInToSync`, `restman.enableWorkspaceSync`, `restman.syncNow`.

- [ ] **Step 1: Write the failing test** — `test/extension/sync/wiring.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildStoresPort } from '../../../src/extension/sync/wiring'
import type { Collection, Environment } from '../../../src/shared/types'

const col = (id: string, ws: string): Collection => ({ id, name: id, workspaceId: ws, requests: [] })
const env = (id: string, ws: string): Environment => ({ id, name: id, workspaceId: ws, variables: [] })

describe('buildStoresPort', () => {
  it('filters collections + environments by workspaceId', async () => {
    const collections = { list: vi.fn(async () => [col('c1', 'w1'), col('c2', 'w2')]), saveCollection: vi.fn() } as any
    const environments = { list: vi.fn(async () => [env('e1', 'w1'), env('e2', 'w2')]), saveEnvironment: vi.fn() } as any
    const port = buildStoresPort(collections, environments)
    expect((await port.getCollections('w1')).map((c) => c.id)).toEqual(['c1'])
    expect((await port.getEnvironments('w2')).map((e) => e.id)).toEqual(['e2'])
  })
  it('applyPulled saves each collection and environment', async () => {
    const collections = { list: vi.fn(async () => []), saveCollection: vi.fn(async () => {}) } as any
    const environments = { list: vi.fn(async () => []), saveEnvironment: vi.fn(async () => {}) } as any
    const port = buildStoresPort(collections, environments)
    await port.applyPulled('w1', [col('c1', 'w1')], [env('e1', 'w1')])
    expect(collections.saveCollection).toHaveBeenCalledWith(col('c1', 'w1'))
    expect(environments.saveEnvironment).toHaveBeenCalledWith(env('e1', 'w1'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/extension/sync/wiring.test.ts`
Expected: FAIL — cannot find module `.../wiring`.

- [ ] **Step 3: Implement `src/extension/sync/wiring.ts`**

```ts
import type { Collection, Environment } from '../../shared/types'
import type { CollectionStore } from '../collection-store'
import type { EnvironmentStore } from '../environment-store'
import type { StoresPort } from './sync-manager'

export function buildStoresPort(collections: CollectionStore, environments: EnvironmentStore): StoresPort {
  return {
    async getCollections(workspaceId: string): Promise<Collection[]> {
      return (await collections.list()).filter((c) => (c.workspaceId || workspaceId) === workspaceId)
    },
    async getEnvironments(workspaceId: string): Promise<Environment[]> {
      return (await environments.list()).filter((e) => (e.workspaceId || workspaceId) === workspaceId)
    },
    async applyPulled(_workspaceId: string, cols: Collection[], envs: Environment[]): Promise<void> {
      for (const c of cols) await collections.saveCollection(c)
      for (const e of envs) await environments.saveEnvironment(e)
    },
  }
}
```

- [ ] **Step 4: Run the wiring test to verify it passes**

Run: `npx vitest run test/extension/sync/wiring.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Register commands + settings in `src/extension/extension.ts`**

Add these imports at the top:

```ts
import { SyncClient } from './sync/sync-client'
import { SyncStateStore } from './sync/sync-state-store'
import { SyncManager } from './sync/sync-manager'
import { buildStoresPort } from './sync/wiring'
import { signIn } from './sync/login'
```

Inside the `activate(context)` function, after the existing stores are constructed, add (reuse the existing `CollectionStore`/`EnvironmentStore` instances the extension already builds — name them to match what's there; if they are created inside a different module, construct fresh ones pointed at the same `context.globalStorageUri.fsPath`, matching the existing constructor calls):

```ts
  const syncBaseUrl = (): string => vscode.workspace.getConfiguration('restman').get<string>('syncServerUrl', 'http://localhost:8787')
  const getToken = (): string | undefined => context.globalState.get<string>('restman.syncToken')
  const syncClient = () => new SyncClient({ baseUrl: syncBaseUrl(), getToken })

  context.subscriptions.push(
    vscode.commands.registerCommand('restman.signInToSync', async () => {
      try {
        const token = await signIn({ baseUrl: syncBaseUrl(), openExternal: (u) => void vscode.env.openExternal(vscode.Uri.parse(u)) })
        await context.globalState.update('restman.syncToken', token)
        const me = await syncClient().me()
        void vscode.window.showInformationMessage(`restman: signed in as ${me.email}`)
      } catch (e: any) {
        void vscode.window.showErrorMessage(`restman sign-in failed: ${e?.message ?? e}`)
      }
    }),
  )
```

Then, using the extension's existing `CollectionStore`/`EnvironmentStore` instances (call them `collections` and `environments` — match the actual variable names in `extension.ts`/`panel.ts`; if they are not in scope here, construct them the same way the rest of the extension does), add the enable + sync commands:

```ts
  const syncManager = () => new SyncManager({
    client: syncClient(),
    state: new SyncStateStore(context.globalStorageUri.fsPath),
    stores: buildStoresPort(collections, environments),
    email: () => context.globalState.get<string>('restman.syncEmail', 'me'),
  })
  const activeWorkspaceId = (): string => context.globalState.get<string>('restman.activeWorkspaceId', '')

  context.subscriptions.push(
    vscode.commands.registerCommand('restman.enableWorkspaceSync', async () => {
      const id = activeWorkspaceId()
      if (!id) return void vscode.window.showWarningMessage('restman: no active workspace')
      try { await syncManager().enable(id, id); void vscode.window.showInformationMessage('restman: workspace sync enabled') }
      catch (e: any) { void vscode.window.showErrorMessage(`restman: enable sync failed: ${e?.message ?? e}`) }
    }),
    vscode.commands.registerCommand('restman.syncNow', async () => {
      const id = activeWorkspaceId()
      if (!id) return void vscode.window.showWarningMessage('restman: no active workspace')
      try { await syncManager().pull(id); await syncManager().push(id); void vscode.window.showInformationMessage('restman: synced') }
      catch (e: any) { void vscode.window.showErrorMessage(`restman: sync failed: ${e?.message ?? e}`) }
    }),
  )
```

Note: if `context.globalState.get<string>('restman.activeWorkspaceId')` is not how the extension stores the active workspace, use whatever the extension already uses to read the active workspace id (check `panel.ts`; it reads `restman.activeWorkspaceId` from `globalState` in Phase-1 core). Keep the read consistent with that.

- [ ] **Step 6: Contribute the commands + setting in `package.json`**

In `contributes.commands`, add:

```json
{ "command": "restman.signInToSync", "title": "restman: Sign in to sync (Google)" },
{ "command": "restman.enableWorkspaceSync", "title": "restman: Enable sync for active workspace" },
{ "command": "restman.syncNow", "title": "restman: Sync now" }
```

In `contributes.configuration.properties`, add:

```json
"restman.syncServerUrl": { "type": "string", "default": "http://localhost:8787", "description": "restman sync backend URL" }
```

- [ ] **Step 7: Typecheck + build + full extension suite**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: typecheck clean; all tests pass (existing + new sync tests); build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/extension/sync/wiring.ts test/extension/sync/wiring.test.ts src/extension/extension.ts package.json
git commit -m "feat(sync): wire sign-in + enable + sync-now commands into the extension"
```

---

### Task 14: Manual verification checklist + docs

**Files:**
- Create: `docs/sync-phase-2-verification.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a written manual test script (no automated test — this documents the end-to-end path an operator runs once).

- [ ] **Step 1: Create `docs/sync-phase-2-verification.md`**

```markdown
# Drive Sync Phase 2 — manual verification

Prereq: `server/` running with a real Google OAuth client (see `server/README.md`), Drive API enabled.

1. Start the backend: `cd server && npm run dev`.
2. In the Extension Development Host (F5), run **restman: Sign in to sync (Google)**. Complete Google consent. Expect an info message "signed in as <email>".
3. Select/activate a workspace with at least one collection and one environment (add a secret variable to the environment).
4. Run **restman: Enable sync for active workspace**. Expect "workspace sync enabled".
5. In Google Drive, confirm a folder `<hash>-restman/` exists containing `<workspaceId>-... .json`. Open it: collections present; the secret variable's value is `""`.
6. Change a request locally, run **restman: Sync now**, re-open the Drive file: the change is present.
7. Delete the local collection, run **restman: Sync now** (pull): the collection returns; the secret variable's value is still blank in the file but your local secret value is preserved locally.
```

- [ ] **Step 2: Commit**

```bash
git add docs/sync-phase-2-verification.md
git commit -m "docs: Drive sync phase 2 manual verification checklist"
```

---

## Self-Review

**Spec coverage (Phase 2 = "Drive proxy: folder/file create, push/pull one workspace (owner), panel login + sync toggle + sync-state store"):**
- Drive proxy (create folder/file, push, pull) → backend Tasks 2, 3, 5, 6. ✓
- Owner-only workspace endpoints + workspaces table → Tasks 1, 4, 5, 6. ✓
- `{hash}-restman/<name>-<id>.json` layout → Task 3 (`folderNameForUser`) + Task 5 (file name). ✓
- Sync content = collections + environments, secrets stripped → Task 8 `buildSnapshot`; history never included (snapshot has no history field). ✓
- Secret preservation on pull → Task 8 `mergeEnvironmentsPreservingSecrets` + Task 12 `pull`. ✓
- sync-state store → Task 9. ✓
- Login (loopback) → Task 11; token stored in extension state → Task 13. ✓
- "sync toggle" → realized as the `enableWorkspaceSync` + `syncNow` commands (Task 13); a polished panel toggle is deferred to the Phase-5 Workspace panel — noted, not silently dropped.
- Extension talks only to the backend; Google tokens never on the client → SyncClient only calls the backend (Task 10); the JWT is the only client credential (Task 13). ✓

Explicitly out of Phase 2 (later phases): realtime WebSocket + Drive watch (Phase 3–4), merge/revision-conflict on push (Phase 3), sharing/members/roles enforcement beyond owner (Phase 5), the full Workspace webview panel.

**Placeholder scan:** none — every code step has full code. The two "match the existing variable names" notes in Task 13 are grounding instructions (the implementer must read `extension.ts`/`panel.ts` to reuse the real `CollectionStore`/`EnvironmentStore` instances and the active-workspace read), not blanks; the exact code to add is shown.

**Type consistency:** `SyncedWorkspace`, `SyncState`, `WorkspaceSnapshot`, `RemoteWorkspace`, `StoresPort`, `DriveClient`, `DriveFactory`, `requireUser`, `SyncClient.{me,listWorkspaces,enableSync,push,pull}`, `SyncManager.{enable,push,pull}` are used with identical signatures across tasks. Backend `buildApp` deps gain `workspaces` + `driveFor` in Task 4 and every later backend task's test constructs them.

**Security note carried forward:** the Phase-1 final review's fixes (loopback `cb` validation, secrets gitignored) remain in force; Phase 2 adds owner-only checks on every workspace endpoint (Task 6 tests the 403 path).

**Deferred to Phase 3 (write into that plan):** optimistic concurrency — `PUT /workspaces/:id` currently overwrites without checking the client's base revision; Phase 3 adds the revision guard + merge-by-id described in the spec.
