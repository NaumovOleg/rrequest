# Drive Sync — DS-Phase 5a: Backend Sharing (members, roles, Drive permissions, pending, fan-out) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace owner share a synced workspace with other people by email + role (editor/viewer): the backend records memberships, grants Drive permissions (Google emails the invitee), resolves memberships that were pending an account on first sign-in, fans `workspace-changed` out to members' WebSocket connections, and enforces roles on every workspace endpoint (viewer = read-only → `PUT` rejected).

**Architecture:** A new `memberships` table + `MembershipStore` records editor/viewer members (resolved `user_id` or a `pending_email`) plus the Drive `permission_id` used to revoke access. All Drive I/O for a workspace continues to use the **owner's** credentials (consistent with DS-Phase 4) — membership + role are enforced at the backend API layer, and the Drive permission exists to notify + surface the file in the member's Drive, not to route member Drive calls. A shared `resolveRole(workspaceId, user)` helper (owner via `workspace.ownerUserId`, else the membership role) gates pull (any role), push (owner/editor; viewer → 403), and member management (owner only). `GET /workspaces` returns owned + shared workspaces each tagged with the caller's role; `subscriptionsFor` gains the member's shared workspace ids so `Realtime.broadcast` reaches members; `/auth/callback` resolves any pending membership matching the new user's email.

**Tech Stack:** Backend only — Node 18+, TypeScript, ESM, Fastify, better-sqlite3, google-auth-library, `ws`, vitest. (The extension-side sharing UX — SyncClient member methods, viewer read-only UI, Workspace/Members panel — is a separate plan, DS-Phase 5b.)

## Global Constraints

- Backend under `server/`: Node **>= 18**, TypeScript, ESM. All Google-facing calls stay on the backend.
- **Roles:** `owner` | `editor` | `viewer`. Owner is derived from `workspace.ownerUserId` (NOT a membership row). Memberships store only `editor`/`viewer`.
- **Owner-credential rule (unchanged from DS-Phase 4):** every Drive read/write/permission/watch call for a workspace uses the **owner's** Drive client (`driveFor(users.getById(ws.ownerUserId))`). A member never triggers a Drive call under their own credentials. Authorization is enforced at the API layer via `resolveRole`.
- **Role enforcement (backend half; the extension half is DS-Phase 5b):** pull (`GET /workspaces/:id`) allowed for owner/editor/viewer; push (`PUT /workspaces/:id`) allowed for owner/editor, **viewer → 403**; member add/list/remove: list allowed for any member, **add/remove owner-only**.
- **Drive role mapping:** editor → Drive `writer`, viewer → Drive `reader`. Member add uses `sendNotificationEmail=true` so Google emails the invitee. `drive.file` scope permits sharing app-created files.
- **Pending memberships:** adding a member whose email has no account yet creates a membership with `pending_email` set and `user_id` null; `/auth/callback` resolves it (sets `user_id`, clears `pending_email`) on that email's first sign-in.
- **Secrets & revision invariants unchanged:** `stripSnapshotSecrets` server-side on write; workspace `revision == Drive headRevisionId`; `workspace-changed {id, revision, updatedBy}` carries the acting user's email as `updatedBy`.
- Reuse existing modules: `WorkspaceStore`, `UserStore`, `DriveFactory`/`driveFor`, `Realtime`, `WatchService`, `requireUser` (`auth.ts`), `signSession`.

---

### Task 1: `UserStore.getByEmail`

**Files:**
- Modify: `server/src/user-store.ts`
- Test: `server/src/user-store.test.ts` (extend if present; else create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `UserStore.getByEmail(email: string): User | undefined` — first user with that email (email is not unique in the schema; first match is fine for MVP), decrypting the refresh token like `getById`.

- [ ] **Step 1: Write the failing test** — add to `server/src/user-store.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { UserStore } from "./user-store";

describe("UserStore.getByEmail", () => {
  it("returns the user with the given email, or undefined", () => {
    const s = new UserStore(":memory:", "enckey");
    const u = s.upsertByGoogle({ googleSub: "g1", email: "a@x.com", refreshToken: "rt1" });
    expect(s.getByEmail("a@x.com")?.id).toBe(u.id);
    expect(s.getByEmail("a@x.com")?.refreshToken).toBe("rt1");
    expect(s.getByEmail("missing@x.com")).toBeUndefined();
  });
});
```

(If `server/src/user-store.test.ts` does not exist, create it with this content plus the standard imports.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/user-store.test.ts`
Expected: FAIL — `getByEmail` not a function.

- [ ] **Step 3: Implement in `server/src/user-store.ts`**

```ts
  getByEmail(email: string): User | undefined {
    const r = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) as Row | undefined;
    if (!r) return undefined;
    return { id: r.id, email: r.email, googleSub: r.google_sub, refreshToken: decrypt(r.refresh_token, this.encKey) };
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/user-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/user-store.ts server/src/user-store.test.ts
git commit -m "feat(server): UserStore.getByEmail"
```

---

### Task 2: `MembershipStore` (sqlite)

**Files:**
- Create: `server/src/membership-store.ts`
- Test: `server/src/membership-store.test.ts`

**Interfaces:**
- Consumes: `better-sqlite3`.
- Produces:
  - `type Role = "editor" | "viewer"`
  - `type Membership = { id: string; workspaceId: string; userId?: string; pendingEmail?: string; role: Role; permissionId: string }`
  - `class MembershipStore { constructor(dbPath: string); add(m: Omit<Membership, "id">): Membership; getById(id: string): Membership | undefined; listByWorkspace(workspaceId: string): Membership[]; listByUser(userId: string): Membership[]; roleForUser(workspaceId: string, userId: string): Role | undefined; findByWorkspaceEmail(workspaceId: string, email: string): Membership | undefined; resolvePending(email: string, userId: string): number; remove(id: string): void }`
  - Table `memberships(id PK, workspace_id, user_id NULL, pending_email NULL, role, permission_id)`, indexed on `workspace_id` and `user_id`. `add` generates a `randomUUID` id.

- [ ] **Step 1: Write the failing test** — `server/src/membership-store.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { MembershipStore } from "./membership-store";

const base = { workspaceId: "w1", role: "editor" as const, permissionId: "p1" };

describe("MembershipStore", () => {
  it("adds a resolved membership and reads it back by id/workspace/user", () => {
    const s = new MembershipStore(":memory:");
    const m = s.add({ ...base, userId: "u1" });
    expect(m.id).toBeTypeOf("string");
    expect(s.getById(m.id)).toMatchObject({ workspaceId: "w1", userId: "u1", role: "editor" });
    expect(s.listByWorkspace("w1")).toHaveLength(1);
    expect(s.listByUser("u1").map((x) => x.workspaceId)).toEqual(["w1"]);
    expect(s.roleForUser("w1", "u1")).toBe("editor");
    expect(s.roleForUser("w1", "nobody")).toBeUndefined();
  });
  it("adds a pending membership (no userId) and resolves it by email", () => {
    const s = new MembershipStore(":memory:");
    s.add({ ...base, pendingEmail: "p@x.com", role: "viewer" });
    expect(s.roleForUser("w1", "u9")).toBeUndefined(); // still pending
    expect(s.findByWorkspaceEmail("w1", "p@x.com")?.role).toBe("viewer");
    const n = s.resolvePending("p@x.com", "u9");
    expect(n).toBe(1);
    expect(s.roleForUser("w1", "u9")).toBe("viewer");
    expect(s.listByUser("u9")).toHaveLength(1);
  });
  it("removes a membership by id", () => {
    const s = new MembershipStore(":memory:");
    const m = s.add({ ...base, userId: "u1" });
    s.remove(m.id);
    expect(s.getById(m.id)).toBeUndefined();
    expect(s.listByWorkspace("w1")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/membership-store.test.ts`
Expected: FAIL — cannot find module `./membership-store`.

- [ ] **Step 3: Implement `server/src/membership-store.ts`**

```ts
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type Role = "editor" | "viewer";
export type Membership = { id: string; workspaceId: string; userId?: string; pendingEmail?: string; role: Role; permissionId: string };

type Row = { id: string; workspace_id: string; user_id: string | null; pending_email: string | null; role: Role; permission_id: string };
const toM = (r: Row): Membership => ({
  id: r.id, workspaceId: r.workspace_id, userId: r.user_id ?? undefined,
  pendingEmail: r.pending_email ?? undefined, role: r.role, permissionId: r.permission_id,
});

export class MembershipStore {
  private db: Database.Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT,
      pending_email TEXT,
      role TEXT NOT NULL,
      permission_id TEXT NOT NULL
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_membership_ws ON memberships(workspace_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_membership_user ON memberships(user_id)`);
  }

  add(m: Omit<Membership, "id">): Membership {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO memberships (id, workspace_id, user_id, pending_email, role, permission_id)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, m.workspaceId, m.userId ?? null, m.pendingEmail ?? null, m.role, m.permissionId);
    return { id, ...m };
  }
  getById(id: string): Membership | undefined {
    const r = this.db.prepare("SELECT * FROM memberships WHERE id = ?").get(id) as Row | undefined;
    return r ? toM(r) : undefined;
  }
  listByWorkspace(workspaceId: string): Membership[] {
    return (this.db.prepare("SELECT * FROM memberships WHERE workspace_id = ?").all(workspaceId) as Row[]).map(toM);
  }
  listByUser(userId: string): Membership[] {
    return (this.db.prepare("SELECT * FROM memberships WHERE user_id = ?").all(userId) as Row[]).map(toM);
  }
  roleForUser(workspaceId: string, userId: string): Role | undefined {
    const r = this.db.prepare("SELECT * FROM memberships WHERE workspace_id = ? AND user_id = ?").get(workspaceId, userId) as Row | undefined;
    return r?.role;
  }
  findByWorkspaceEmail(workspaceId: string, email: string): Membership | undefined {
    const r = this.db.prepare("SELECT * FROM memberships WHERE workspace_id = ? AND pending_email = ?").get(workspaceId, email) as Row | undefined;
    return r ? toM(r) : undefined;
  }
  resolvePending(email: string, userId: string): number {
    const info = this.db.prepare("UPDATE memberships SET user_id = ?, pending_email = NULL WHERE pending_email = ?").run(userId, email);
    return info.changes;
  }
  remove(id: string): void {
    this.db.prepare("DELETE FROM memberships WHERE id = ?").run(id);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/membership-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/membership-store.ts server/src/membership-store.test.ts
git commit -m "feat(server): MembershipStore (memberships table)"
```

---

### Task 3: `DriveClient` — `createPermission`, `deletePermission`

**Files:**
- Modify: `server/src/drive-client.ts` (interface + `GoogleDriveClient` + `FakeDriveClient`)
- Test: `server/src/drive-client.test.ts` (extend)

**Interfaces:**
- Produces (added to `DriveClient`):
  - `createPermission(fileId: string, opts: { email: string; role: "writer" | "reader"; sendNotificationEmail?: boolean }): Promise<{ permissionId: string }>`
  - `deletePermission(fileId: string, permissionId: string): Promise<void>`
  - `FakeDriveClient` records permissions per file and exposes a `permissions(fileId): { permissionId, email, role }[]` test helper.

- [ ] **Step 1: Add failing tests** — append to `server/src/drive-client.test.ts`

```ts
describe("FakeDriveClient permissions", () => {
  it("creates and lists a permission, and deletes it", async () => {
    const d = new FakeDriveClient();
    const { fileId } = await d.createFile("f", "n", "{}");
    const { permissionId } = await d.createPermission(fileId, { email: "m@x.com", role: "writer", sendNotificationEmail: true });
    expect(permissionId).toBeTypeOf("string");
    expect(d.permissions(fileId)).toEqual([{ permissionId, email: "m@x.com", role: "writer" }]);
    await d.deletePermission(fileId, permissionId);
    expect(d.permissions(fileId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/drive-client.test.ts`
Expected: FAIL — `createPermission`/`deletePermission`/`permissions` not defined.

- [ ] **Step 3: Extend `server/src/drive-client.ts`**

Add to the `DriveClient` interface:

```ts
  createPermission(fileId: string, opts: { email: string; role: "writer" | "reader"; sendNotificationEmail?: boolean }): Promise<{ permissionId: string }>;
  deletePermission(fileId: string, permissionId: string): Promise<void>;
```

In `GoogleDriveClient`:

```ts
  async createPermission(fileId: string, opts: { email: string; role: "writer" | "reader"; sendNotificationEmail?: boolean }): Promise<{ permissionId: string }> {
    const q = `sendNotificationEmail=${opts.sendNotificationEmail ? "true" : "false"}&fields=id`;
    const res = await this.fetchImpl(`${DRIVE}/files/${fileId}/permissions?${q}`, {
      method: "POST",
      headers: { ...(await this.auth()), "content-type": "application/json" },
      body: JSON.stringify({ role: opts.role, type: "user", emailAddress: opts.email }),
    });
    if (!res.ok) throw new Error(`Drive permission create failed: ${res.status}`);
    return { permissionId: ((await res.json()) as { id: string }).id };
  }

  async deletePermission(fileId: string, permissionId: string): Promise<void> {
    const res = await this.fetchImpl(`${DRIVE}/files/${fileId}/permissions/${permissionId}`, {
      method: "DELETE",
      headers: await this.auth(),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Drive permission delete failed: ${res.status}`);
  }
```

In `FakeDriveClient` (add a permissions map + methods; put the map near the other private fields):

```ts
  private perms = new Map<string, { permissionId: string; email: string; role: "writer" | "reader" }[]>();
  private permSeq = 0;

  async createPermission(fileId: string, opts: { email: string; role: "writer" | "reader"; sendNotificationEmail?: boolean }): Promise<{ permissionId: string }> {
    const permissionId = `perm-${++this.permSeq}`;
    const list = this.perms.get(fileId) ?? [];
    list.push({ permissionId, email: opts.email, role: opts.role });
    this.perms.set(fileId, list);
    return { permissionId };
  }
  async deletePermission(fileId: string, permissionId: string): Promise<void> {
    this.perms.set(fileId, (this.perms.get(fileId) ?? []).filter((p) => p.permissionId !== permissionId));
  }
  // test helper
  permissions(fileId: string) { return this.perms.get(fileId) ?? []; }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/drive-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck + commit**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: green, clean.

```bash
git add server/src/drive-client.ts server/src/drive-client.test.ts
git commit -m "feat(server): DriveClient create/delete permission"
```

---

### Task 4: `authz.ts` — `resolveRole` + `ownerDriveFor`

**Files:**
- Create: `server/src/authz.ts`
- Test: `server/src/authz.test.ts`

**Interfaces:**
- Consumes: `WorkspaceStore`, `UserStore`, `MembershipStore`, `DriveFactory`, `User`.
- Produces:
  - `type AuthzDeps = { workspaces: WorkspaceStore; users: UserStore; memberships: MembershipStore; driveFor: DriveFactory }`
  - `resolveRole(deps: AuthzDeps, workspaceId: string, userId: string): "owner" | "editor" | "viewer" | null` — owner if `ws.ownerUserId === userId`; else the membership role; else null (or unknown workspace → null).
  - `ownerDriveFor(deps: AuthzDeps, ws: { ownerUserId: string }): DriveClient | undefined` — `driveFor(users.getById(ws.ownerUserId))`, or undefined if the owner user is missing.

- [ ] **Step 1: Write the failing test** — `server/src/authz.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { resolveRole, ownerDriveFor } from "./authz";
import { WorkspaceStore } from "./workspace-store";
import { UserStore } from "./user-store";
import { MembershipStore } from "./membership-store";
import { FakeDriveClient } from "./drive-client";

function setup() {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "go", email: "o@x.com", refreshToken: "rt" });
  const member = users.upsertByGoogle({ googleSub: "gm", email: "m@x.com", refreshToken: "rt2" });
  const workspaces = new WorkspaceStore(":memory:");
  workspaces.upsert({ id: "w1", name: "W", ownerUserId: owner.id, driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
  const memberships = new MembershipStore(":memory:");
  const drive = new FakeDriveClient();
  return { users, owner, member, workspaces, memberships, deps: { workspaces, users, memberships, driveFor: () => drive } };
}

describe("resolveRole", () => {
  it("returns owner/editor/viewer/null correctly", () => {
    const t = setup();
    expect(resolveRole(t.deps, "w1", t.owner.id)).toBe("owner");
    expect(resolveRole(t.deps, "w1", t.member.id)).toBeNull();
    t.memberships.add({ workspaceId: "w1", userId: t.member.id, role: "editor", permissionId: "p" });
    expect(resolveRole(t.deps, "w1", t.member.id)).toBe("editor");
    expect(resolveRole(t.deps, "missing", t.owner.id)).toBeNull();
  });
});

describe("ownerDriveFor", () => {
  it("returns a drive client for the workspace owner", () => {
    const t = setup();
    expect(ownerDriveFor(t.deps, t.workspaces.get("w1")!)).toBeDefined();
    expect(ownerDriveFor(t.deps, { ownerUserId: "nobody" })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/authz.test.ts`
Expected: FAIL — cannot find module `./authz`.

- [ ] **Step 3: Implement `server/src/authz.ts`**

```ts
import type { WorkspaceStore } from "./workspace-store.js";
import type { UserStore } from "./user-store.js";
import type { MembershipStore } from "./membership-store.js";
import type { DriveFactory } from "./drive-factory.js";
import type { DriveClient } from "./drive-client.js";

export type AuthzDeps = { workspaces: WorkspaceStore; users: UserStore; memberships: MembershipStore; driveFor: DriveFactory };
export type WorkspaceRole = "owner" | "editor" | "viewer";

export function resolveRole(deps: AuthzDeps, workspaceId: string, userId: string): WorkspaceRole | null {
  const ws = deps.workspaces.get(workspaceId);
  if (!ws) return null;
  if (ws.ownerUserId === userId) return "owner";
  return deps.memberships.roleForUser(workspaceId, userId) ?? null;
}

export function ownerDriveFor(deps: AuthzDeps, ws: { ownerUserId: string }): DriveClient | undefined {
  const owner = deps.users.getById(ws.ownerUserId);
  return owner ? deps.driveFor(owner) : undefined;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/authz.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/authz.ts server/src/authz.test.ts
git commit -m "feat(server): authz resolveRole + ownerDriveFor"
```

---

### Task 5: Wire `memberships` into `AppDeps`; relax `GET /workspaces/:id` (pull) to any role

**Files:**
- Modify: `server/src/app.ts` (add `memberships: MembershipStore` to `AppDeps`; rewrite `GET /workspaces/:id`)
- Modify: every existing test that calls `buildApp({...})` — add `memberships`
- Test: `server/src/app.workspaces-share-read.test.ts`

**Interfaces:**
- Consumes: `MembershipStore`, `resolveRole`/`ownerDriveFor` from `./authz`.
- Produces: `AppDeps` gains `memberships: MembershipStore` (required). `GET /workspaces/:id`: `role = resolveRole(...)`; `null` → 403; else read the snapshot via the **owner's** Drive client; return `{ snapshot, revision, role }`.

- [ ] **Step 1: Write the failing test** — `server/src/app.workspaces-share-read.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { MembershipStore } from "./membership-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";
import { signSession } from "./jwt";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "c", googleClientSecret: "s", googleRedirectUri: "http://localhost:8787/auth/callback", pollIntervalMs: 60000, channelTtlSeconds: 604800 } as any;
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "c");

async function seeded() {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "go", email: "o@x.com", refreshToken: "rt" });
  const viewer = users.upsertByGoogle({ googleSub: "gv", email: "v@x.com", refreshToken: "rt2" });
  const stranger = users.upsertByGoogle({ googleSub: "gs", email: "s@x.com", refreshToken: "rt3" });
  const workspaces = new WorkspaceStore(":memory:");
  const memberships = new MembershipStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime(), memberships });
  const tok = signSession(owner.id, "j");
  await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${tok}` }, payload: { workspaceId: "w1", name: "W", snapshot: '{"v":1}' } });
  memberships.add({ workspaceId: "w1", userId: viewer.id, role: "viewer", permissionId: "p" });
  return { app, owner, viewer, stranger };
}

describe("GET /workspaces/:id with roles", () => {
  it("owner reads with role=owner", async () => {
    const { app, owner } = await seeded();
    const res = await app.inject({ method: "GET", url: "/workspaces/w1", headers: { authorization: `Bearer ${signSession(owner.id, "j")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ snapshot: '{"v":1}', role: "owner" });
  });
  it("viewer member reads with role=viewer", async () => {
    const { app, viewer } = await seeded();
    const res = await app.inject({ method: "GET", url: "/workspaces/w1", headers: { authorization: `Bearer ${signSession(viewer.id, "j")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("viewer");
  });
  it("a non-member is forbidden", async () => {
    const { app, stranger } = await seeded();
    const res = await app.inject({ method: "GET", url: "/workspaces/w1", headers: { authorization: `Bearer ${signSession(stranger.id, "j")}` } });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/app.workspaces-share-read.test.ts`
Expected: FAIL — `AppDeps` has no `memberships`; `GET /workspaces/:id` is owner-only and returns no `role`.

- [ ] **Step 3: Extend `AppDeps` + rewrite `GET /workspaces/:id` in `server/src/app.ts`**

Add imports:

```ts
import type { MembershipStore } from "./membership-store.js";
import { resolveRole, ownerDriveFor } from "./authz.js";
```

Add to `AppDeps`:

```ts
  memberships: MembershipStore;
```

Replace the existing `GET /workspaces/:id` handler with:

```ts
  app.get("/workspaces/:id", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const id = (req.params as { id: string }).id;
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    const role = resolveRole(deps, id, user.id);
    if (!role) return reply.code(403).send({ error: "forbidden" });
    const drive = ownerDriveFor(deps, ws);
    if (!drive) return reply.code(500).send({ error: "owner unavailable" });
    const snapshot = await drive.readFile(ws.driveFileId);
    return { snapshot, revision: ws.revision, role };
  });
```

- [ ] **Step 4: Update every existing `buildApp({...})` caller to pass `memberships`**

In `app.health.test.ts`, `app.auth.test.ts`, `app.me.test.ts`, `app.webhook.test.ts`, `app.workspaces-create.test.ts`, `app.workspaces-rw.test.ts`, `app.workspaces-conflict.test.ts`: add `import { MembershipStore } from "./membership-store";` and add `memberships: new MembershipStore(":memory:"),` to each `buildApp({...})` deps object. (Where a test needs to assert on memberships it should construct a named `const memberships = new MembershipStore(":memory:")` and pass that; otherwise an inline `new MembershipStore(":memory:")` is fine.)

- [ ] **Step 5: Full server suite + typecheck**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: all green (incl. the 3 new share-read tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/app.ts server/src/app.workspaces-share-read.test.ts server/src/app.health.test.ts server/src/app.auth.test.ts server/src/app.me.test.ts server/src/app.webhook.test.ts server/src/app.workspaces-create.test.ts server/src/app.workspaces-rw.test.ts server/src/app.workspaces-conflict.test.ts
git commit -m "feat(server): memberships dep + role-gated pull returning role"
```

---

### Task 6: Relax `PUT /workspaces/:id` (push) — owner/editor allowed, viewer 403, owner-drive write

**Files:**
- Modify: `server/src/app.ts` (`PUT /workspaces/:id`)
- Test: `server/src/app.workspaces-share-write.test.ts`

**Interfaces:**
- Consumes: `resolveRole`/`ownerDriveFor`.
- Produces: `PUT /workspaces/:id` uses `resolveRole`: `null` → 403 (not a member); `viewer` → 403; `owner`/`editor` → proceed. The Drive write uses the **owner's** Drive client (`ownerDriveFor`), not the requester's. The revision guard (409) + broadcast are unchanged; `updatedBy` remains the acting user's email.

- [ ] **Step 1: Write the failing test** — `server/src/app.workspaces-share-write.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { MembershipStore } from "./membership-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";
import { signSession } from "./jwt";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "c", googleClientSecret: "s", googleRedirectUri: "http://localhost:8787/auth/callback", pollIntervalMs: 60000, channelTtlSeconds: 604800 } as any;
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "c");

async function seeded() {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "go", email: "o@x.com", refreshToken: "rt" });
  const editor = users.upsertByGoogle({ googleSub: "ge", email: "e@x.com", refreshToken: "rt2" });
  const viewer = users.upsertByGoogle({ googleSub: "gv", email: "v@x.com", refreshToken: "rt3" });
  const workspaces = new WorkspaceStore(":memory:");
  const memberships = new MembershipStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime(), memberships });
  const otok = signSession(owner.id, "j");
  await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${otok}` }, payload: { workspaceId: "w1", name: "W", snapshot: '{"v":1}' } });
  memberships.add({ workspaceId: "w1", userId: editor.id, role: "editor", permissionId: "pe" });
  memberships.add({ workspaceId: "w1", userId: viewer.id, role: "viewer", permissionId: "pv" });
  const rev = workspaces.get("w1")!.revision;
  return { app, owner, editor, viewer, rev };
}

describe("PUT /workspaces/:id role enforcement", () => {
  it("editor member can push", async () => {
    const { app, editor, rev } = await seeded();
    const res = await app.inject({ method: "PUT", url: "/workspaces/w1", headers: { authorization: `Bearer ${signSession(editor.id, "j")}` }, payload: { snapshot: '{"v":2}', baseRevision: rev } });
    expect(res.statusCode).toBe(200);
  });
  it("viewer member is forbidden from pushing", async () => {
    const { app, viewer, rev } = await seeded();
    const res = await app.inject({ method: "PUT", url: "/workspaces/w1", headers: { authorization: `Bearer ${signSession(viewer.id, "j")}` }, payload: { snapshot: '{"v":2}', baseRevision: rev } });
    expect(res.statusCode).toBe(403);
  });
}); 
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/app.workspaces-share-write.test.ts`
Expected: FAIL — editor gets 403 (owner-only guard), so the "editor can push" test fails.

- [ ] **Step 3: Rewrite the `PUT /workspaces/:id` handler in `server/src/app.ts`**

Replace the owner-only guard + drive resolution. The handler becomes:

```ts
  app.put("/workspaces/:id", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const id = (req.params as { id: string }).id;
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    const role = resolveRole(deps, id, user.id);
    if (role !== "owner" && role !== "editor") return reply.code(403).send({ error: "forbidden" });
    const { snapshot, baseRevision } = req.body as { snapshot?: string; baseRevision?: string };
    if (typeof snapshot !== "string" || typeof baseRevision !== "string") return reply.code(400).send({ error: "snapshot + baseRevision required" });
    const drive = ownerDriveFor(deps, ws);
    if (!drive) return reply.code(500).send({ error: "owner unavailable" });
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

(This preserves the 404/400/409 behavior and the broadcast; it swaps the owner-only guard for a role check and switches the Drive client from `deps.driveFor(user)` to `ownerDriveFor(deps, ws)`.)

- [ ] **Step 4: Full server suite + typecheck**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: all green (the existing `app.workspaces-rw.test.ts` still passes — the owner is `owner` role; the conflict test still passes). Note: the pre-existing rw/conflict tests seed via `POST /workspaces` as the owner, so `resolveRole` returns `owner` and they behave as before.

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/app.workspaces-share-write.test.ts
git commit -m "feat(server): role-gated push (viewer 403, owner-drive write)"
```

---

### Task 7: `GET /workspaces` returns owned + shared, each with role

**Files:**
- Modify: `server/src/app.ts` (`GET /workspaces`)
- Test: `server/src/app.workspaces-list-shared.test.ts`

**Interfaces:**
- Consumes: `workspaces.listByOwner`, `memberships.listByUser`, `workspaces.get`.
- Produces: `GET /workspaces` returns an array of `{ ...SyncedWorkspace, role }` — owned workspaces with `role: "owner"`, plus each shared workspace (from the caller's memberships) with its membership role. A workspace the caller both owns and is a member of appears once (owner wins).

- [ ] **Step 1: Write the failing test** — `server/src/app.workspaces-list-shared.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { MembershipStore } from "./membership-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";
import { signSession } from "./jwt";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "c", googleClientSecret: "s", googleRedirectUri: "http://localhost:8787/auth/callback", pollIntervalMs: 60000, channelTtlSeconds: 604800 } as any;
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "c");

describe("GET /workspaces owned + shared", () => {
  it("returns owned (role owner) and shared (membership role) workspaces", async () => {
    const users = new UserStore(":memory:", "k");
    const owner = users.upsertByGoogle({ googleSub: "go", email: "o@x.com", refreshToken: "rt" });
    const me = users.upsertByGoogle({ googleSub: "gm", email: "m@x.com", refreshToken: "rt2" });
    const workspaces = new WorkspaceStore(":memory:");
    const memberships = new MembershipStore(":memory:");
    const drive = new FakeDriveClient();
    const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime(), memberships });
    // me owns wo; owner owns ws, shares ws with me as editor
    await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${signSession(me.id, "j")}` }, payload: { workspaceId: "wo", name: "Mine", snapshot: "{}" } });
    await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${signSession(owner.id, "j")}` }, payload: { workspaceId: "ws", name: "Shared", snapshot: "{}" } });
    memberships.add({ workspaceId: "ws", userId: me.id, role: "editor", permissionId: "p" });
    const res = await app.inject({ method: "GET", url: "/workspaces", headers: { authorization: `Bearer ${signSession(me.id, "j")}` } });
    expect(res.statusCode).toBe(200);
    const byId = Object.fromEntries((res.json() as any[]).map((w) => [w.id, w.role]));
    expect(byId).toEqual({ wo: "owner", ws: "editor" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/app.workspaces-list-shared.test.ts`
Expected: FAIL — the current `GET /workspaces` returns only owned workspaces without a `role`.

- [ ] **Step 3: Rewrite `GET /workspaces` in `server/src/app.ts`**

```ts
  app.get("/workspaces", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const owned = deps.workspaces.listByOwner(user.id).map((w) => ({ ...w, role: "owner" as const }));
    const ownedIds = new Set(owned.map((w) => w.id));
    const shared = deps.memberships.listByUser(user.id)
      .filter((m) => !ownedIds.has(m.workspaceId))
      .map((m) => { const w = deps.workspaces.get(m.workspaceId); return w ? { ...w, role: m.role } : undefined; })
      .filter((w): w is NonNullable<typeof w> => !!w);
    return [...owned, ...shared];
  });
```

- [ ] **Step 4: Full server suite + typecheck**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: all green (existing `GET /workspaces` callers that only checked owned still see their owned workspaces, now with an added `role` field — verify none assert exact object equality that a new field would break; if one does, update it to `toMatchObject`).

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/app.workspaces-list-shared.test.ts
git commit -m "feat(server): GET /workspaces returns owned + shared with roles"
```

---

### Task 8: `POST /workspaces/:id/members` (add member: Drive permission + membership/pending)

**Files:**
- Modify: `server/src/app.ts` (add route)
- Test: `server/src/app.members-add.test.ts`

**Interfaces:**
- Consumes: `resolveRole` (owner-only), `deps.driveFor(user)` (the owner is the requester), `users.getByEmail`, `memberships.add`.
- Produces: `POST /workspaces/:id/members` body `{ email: string; role: "editor" | "viewer" }`:
  - not owner → 403; bad role → 400.
  - `drive.createPermission(ws.driveFileId, { email, role: role === "editor" ? "writer" : "reader", sendNotificationEmail: true })` → permissionId.
  - existing account (`users.getByEmail`) → `memberships.add({ workspaceId, userId, role, permissionId })`; else `memberships.add({ workspaceId, pendingEmail: email, role, permissionId })`.
  - reply `201 { id, email, role, pending }`.

- [ ] **Step 1: Write the failing test** — `server/src/app.members-add.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { MembershipStore } from "./membership-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";
import { signSession } from "./jwt";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "c", googleClientSecret: "s", googleRedirectUri: "http://localhost:8787/auth/callback", pollIntervalMs: 60000, channelTtlSeconds: 604800 } as any;
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "c");

async function seeded() {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "go", email: "o@x.com", refreshToken: "rt" });
  const existing = users.upsertByGoogle({ googleSub: "ge", email: "e@x.com", refreshToken: "rt2" });
  const stranger = users.upsertByGoogle({ googleSub: "gs", email: "s@x.com", refreshToken: "rt3" });
  const workspaces = new WorkspaceStore(":memory:");
  const memberships = new MembershipStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime(), memberships });
  await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${signSession(owner.id, "j")}` }, payload: { workspaceId: "w1", name: "W", snapshot: "{}" } });
  const fileId = workspaces.get("w1")!.driveFileId;
  return { app, owner, existing, stranger, memberships, drive, fileId };
}

describe("POST /workspaces/:id/members", () => {
  it("owner adds an existing-account member: Drive permission + resolved membership", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "POST", url: "/workspaces/w1/members", headers: { authorization: `Bearer ${signSession(t.owner.id, "j")}` }, payload: { email: "e@x.com", role: "editor" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: "e@x.com", role: "editor", pending: false });
    expect(t.drive.permissions(t.fileId)).toEqual([{ permissionId: expect.any(String), email: "e@x.com", role: "writer" }]);
    expect(t.memberships.listByWorkspace("w1")[0]).toMatchObject({ userId: t.existing.id, role: "editor" });
  });
  it("owner adds an unknown email: pending membership, reader permission for viewer", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "POST", url: "/workspaces/w1/members", headers: { authorization: `Bearer ${signSession(t.owner.id, "j")}` }, payload: { email: "new@x.com", role: "viewer" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: "new@x.com", role: "viewer", pending: true });
    expect(t.drive.permissions(t.fileId)[0]).toMatchObject({ email: "new@x.com", role: "reader" });
    expect(t.memberships.listByWorkspace("w1")[0]).toMatchObject({ pendingEmail: "new@x.com", role: "viewer" });
  });
  it("a non-owner cannot add members", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "POST", url: "/workspaces/w1/members", headers: { authorization: `Bearer ${signSession(t.stranger.id, "j")}` }, payload: { email: "e@x.com", role: "editor" } });
    expect(res.statusCode).toBe(403);
  });
  it("rejects an invalid role", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "POST", url: "/workspaces/w1/members", headers: { authorization: `Bearer ${signSession(t.owner.id, "j")}` }, payload: { email: "e@x.com", role: "owner" } });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/app.members-add.test.ts`
Expected: FAIL — no `/workspaces/:id/members` route (404).

- [ ] **Step 3: Add the route in `server/src/app.ts`** (after the `GET /workspaces/:id` route)

```ts
  app.post("/workspaces/:id/members", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const id = (req.params as { id: string }).id;
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    if (resolveRole(deps, id, user.id) !== "owner") return reply.code(403).send({ error: "forbidden" });
    const { email, role } = req.body as { email?: string; role?: string };
    if (!email || (role !== "editor" && role !== "viewer")) return reply.code(400).send({ error: "email + role (editor|viewer) required" });
    const drive = ownerDriveFor(deps, ws);
    if (!drive) return reply.code(500).send({ error: "owner unavailable" });
    const { permissionId } = await drive.createPermission(ws.driveFileId, { email, role: role === "editor" ? "writer" : "reader", sendNotificationEmail: true });
    const account = deps.users.getByEmail(email);
    const m = deps.memberships.add(account
      ? { workspaceId: id, userId: account.id, role, permissionId }
      : { workspaceId: id, pendingEmail: email, role, permissionId });
    return reply.code(201).send({ id: m.id, email, role, pending: !account });
  });
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/app.members-add.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full suite + typecheck + commit**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: green, clean.

```bash
git add server/src/app.ts server/src/app.members-add.test.ts
git commit -m "feat(server): POST /workspaces/:id/members (share by email + role)"
```

---

### Task 9: `GET` + `DELETE /workspaces/:id/members` (list + remove)

**Files:**
- Modify: `server/src/app.ts` (two routes)
- Test: `server/src/app.members-list-remove.test.ts`

**Interfaces:**
- Consumes: `resolveRole`, `memberships.listByWorkspace`/`getById`/`remove`, `users.getById`, `ownerDriveFor`, `drive.deletePermission`.
- Produces:
  - `GET /workspaces/:id/members` — any member (role != null); returns `{ members: Array<{ id?: string; email: string; role: "owner"|"editor"|"viewer"; pending: boolean }> }` — the owner first (`{ email: <owner email>, role: "owner", pending: false }`, no id), then each membership (`{ id, email: <resolved user email | pendingEmail>, role, pending: !userId }`).
  - `DELETE /workspaces/:id/members/:memberId` — owner-only; looks up the membership by id (must belong to this workspace); best-effort `drive.deletePermission(ws.driveFileId, permissionId)`; `memberships.remove(id)`; reply `200 { ok: true }`. Unknown membership → 404.

- [ ] **Step 1: Write the failing test** — `server/src/app.members-list-remove.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { MembershipStore } from "./membership-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";
import { signSession } from "./jwt";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "c", googleClientSecret: "s", googleRedirectUri: "http://localhost:8787/auth/callback", pollIntervalMs: 60000, channelTtlSeconds: 604800 } as any;
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "c");

async function seeded() {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "go", email: "o@x.com", refreshToken: "rt" });
  const editor = users.upsertByGoogle({ googleSub: "ge", email: "e@x.com", refreshToken: "rt2" });
  const workspaces = new WorkspaceStore(":memory:");
  const memberships = new MembershipStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime(), memberships });
  await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${signSession(owner.id, "j")}` }, payload: { workspaceId: "w1", name: "W", snapshot: "{}" } });
  const fileId = workspaces.get("w1")!.driveFileId;
  const perm = await drive.createPermission(fileId, { email: "e@x.com", role: "writer" });
  const m = memberships.add({ workspaceId: "w1", userId: editor.id, role: "editor", permissionId: perm.permissionId });
  return { app, owner, editor, memberships, drive, fileId, membershipId: m.id };
}

describe("GET /workspaces/:id/members", () => {
  it("lists owner first then members", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "GET", url: "/workspaces/w1/members", headers: { authorization: `Bearer ${signSession(t.owner.id, "j")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().members).toEqual([
      { email: "o@x.com", role: "owner", pending: false },
      { id: t.membershipId, email: "e@x.com", role: "editor", pending: false },
    ]);
  });
});

describe("DELETE /workspaces/:id/members/:memberId", () => {
  it("owner removes a member (drive permission + row)", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "DELETE", url: `/workspaces/w1/members/${t.membershipId}`, headers: { authorization: `Bearer ${signSession(t.owner.id, "j")}` } });
    expect(res.statusCode).toBe(200);
    expect(t.memberships.getById(t.membershipId)).toBeUndefined();
    expect(t.drive.permissions(t.fileId)).toEqual([]);
  });
  it("a non-owner cannot remove members", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "DELETE", url: `/workspaces/w1/members/${t.membershipId}`, headers: { authorization: `Bearer ${signSession(t.editor.id, "j")}` } });
    expect(res.statusCode).toBe(403);
    expect(t.memberships.getById(t.membershipId)).toBeDefined();
  });
}); 
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/app.members-list-remove.test.ts`
Expected: FAIL — routes missing (404).

- [ ] **Step 3: Add the routes in `server/src/app.ts`**

```ts
  app.get("/workspaces/:id/members", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const id = (req.params as { id: string }).id;
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    if (!resolveRole(deps, id, user.id)) return reply.code(403).send({ error: "forbidden" });
    const ownerEmail = deps.users.getById(ws.ownerUserId)?.email ?? "";
    const members = [
      { email: ownerEmail, role: "owner" as const, pending: false },
      ...deps.memberships.listByWorkspace(id).map((m) => ({
        id: m.id,
        email: m.userId ? (deps.users.getById(m.userId)?.email ?? "") : (m.pendingEmail ?? ""),
        role: m.role,
        pending: !m.userId,
      })),
    ];
    return { members };
  });

  app.delete("/workspaces/:id/members/:memberId", async (req, reply) => {
    const user = requireUser(req, deps);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { id, memberId } = req.params as { id: string; memberId: string };
    const ws = deps.workspaces.get(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    if (resolveRole(deps, id, user.id) !== "owner") return reply.code(403).send({ error: "forbidden" });
    const m = deps.memberships.getById(memberId);
    if (!m || m.workspaceId !== id) return reply.code(404).send({ error: "member not found" });
    const drive = ownerDriveFor(deps, ws);
    if (drive) { try { await drive.deletePermission(ws.driveFileId, m.permissionId); } catch { /* best-effort */ } }
    deps.memberships.remove(memberId);
    return { ok: true };
  });
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/app.members-list-remove.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite + typecheck + commit**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: green, clean.

```bash
git add server/src/app.ts server/src/app.members-list-remove.test.ts
git commit -m "feat(server): GET/DELETE workspace members"
```

---

### Task 10: Pending resolution on `/auth/callback` + `subscriptionsFor` member fan-out

**Files:**
- Modify: `server/src/app.ts` (`/auth/callback`)
- Modify: `server/src/ws-server.ts` (`subscriptionsFor` + `attachWsServer` signature)
- Test: `server/src/app.pending-resolve.test.ts`, extend `server/src/ws-server.test.ts`

**Interfaces:**
- Consumes: `memberships.resolvePending`, `memberships.listByUser`.
- Produces:
  - `/auth/callback` calls `deps.memberships.resolvePending(user.email, user.id)` immediately after `upsertByGoogle`.
  - `subscriptionsFor(userId: string, workspaces: WorkspaceStore, memberships: MembershipStore): string[]` — owned ids ∪ the user's membership workspace ids (deduped).
  - `attachWsServer(opts)` gains `memberships: MembershipStore` and passes it into `subscriptionsFor`.

- [ ] **Step 1: Extend the ws-server test** — `server/src/ws-server.test.ts`

Replace the `subscriptionsFor` test with one that also seeds a membership:

```ts
import { describe, it, expect } from "vitest";
import { subscriptionsFor } from "./ws-server";
import { WorkspaceStore } from "./workspace-store";
import { MembershipStore } from "./membership-store";

describe("subscriptionsFor", () => {
  it("returns owned workspace ids plus the user's shared (membership) workspace ids", () => {
    const ws = new WorkspaceStore(":memory:");
    ws.upsert({ id: "a", name: "A", ownerUserId: "u1", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    ws.upsert({ id: "b", name: "B", ownerUserId: "u2", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    ws.upsert({ id: "c", name: "C", ownerUserId: "u1", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    const m = new MembershipStore(":memory:");
    m.add({ workspaceId: "b", userId: "u1", role: "viewer", permissionId: "p" }); // u1 shares into b
    expect(subscriptionsFor("u1", ws, m).sort()).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Write the pending-resolution test** — `server/src/app.pending-resolve.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { MembershipStore } from "./membership-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "c", googleClientSecret: "s", googleRedirectUri: "http://localhost:8787/auth/callback", pollIntervalMs: 60000, channelTtlSeconds: 604800 } as any;

describe("/auth/callback resolves pending memberships", () => {
  it("links a pending_email membership to the new user id on first sign-in", async () => {
    const users = new UserStore(":memory:", "k");
    const memberships = new MembershipStore(":memory:");
    memberships.add({ workspaceId: "w1", pendingEmail: "invitee@x.com", role: "editor", permissionId: "p" });
    // GoogleOAuth stub whose exchange returns the invitee's profile
    const google = { authUrl: () => "g", exchange: async () => ({ googleSub: "gi", email: "invitee@x.com", refreshToken: "rt" }) } as any;
    const states = new PendingStates();
    const app = buildApp({ config: cfg, users, google, states, workspaces: new WorkspaceStore(":memory:"), driveFor: () => new FakeDriveClient(), realtime: new Realtime(), memberships });
    // seed a valid state so /auth/callback accepts the cb
    const start = await app.inject({ method: "GET", url: "/auth/start?cb=http://localhost:5000" });
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    const res = await app.inject({ method: "GET", url: `/auth/callback?code=x&state=${state}` });
    expect(res.statusCode).toBe(302);
    const u = users.getByEmail("invitee@x.com")!;
    expect(memberships.roleForUser("w1", u.id)).toBe("editor");
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd server && npx vitest run src/ws-server.test.ts src/app.pending-resolve.test.ts`
Expected: FAIL — `subscriptionsFor` takes 2 args (no memberships); `/auth/callback` doesn't resolve pending.

- [ ] **Step 4: Update `server/src/ws-server.ts`**

```ts
import type { MembershipStore } from "./membership-store.js";
```

```ts
export function subscriptionsFor(userId: string, workspaces: WorkspaceStore, memberships: MembershipStore): string[] {
  const owned = workspaces.listByOwner(userId).map((w) => w.id);
  const shared = memberships.listByUser(userId).map((m) => m.workspaceId);
  return [...new Set([...owned, ...shared])];
}
```

In `attachWsServer`, add `memberships: MembershipStore` to the opts type and pass it through:

```ts
export function attachWsServer(opts: { server: Server; jwtSecret: string; workspaces: WorkspaceStore; memberships: MembershipStore; realtime: Realtime }): void {
```

and change the `register` call's subscriptions to `subscriptionsFor(session.userId, opts.workspaces, opts.memberships)`.

- [ ] **Step 5: Update `/auth/callback` in `server/src/app.ts`**

After `const user = deps.users.upsertByGoogle(profile);` add:

```ts
      deps.memberships.resolvePending(user.email, user.id);
```

- [ ] **Step 6: Run both to verify they pass**

Run: `cd server && npx vitest run src/ws-server.test.ts src/app.pending-resolve.test.ts`
Expected: PASS.

- [ ] **Step 7: Full suite + typecheck**

Run: `cd server && npx vitest run && npm run typecheck`
Expected: all green (note `server.ts` still calls `attachWsServer` with the old signature — it will be fixed in Task 11; if typecheck flags `server.ts` here, that is expected and Task 11 resolves it. If you prefer green-at-every-commit, apply the Task 11 `server.ts` change now — but the brief keeps them separate. Either way, do not leave the suite red at the end of Task 11.)

- [ ] **Step 8: Commit**

```bash
git add server/src/app.ts server/src/ws-server.ts server/src/ws-server.test.ts server/src/app.pending-resolve.test.ts
git commit -m "feat(server): resolve pending memberships on sign-in + member ws fan-out"
```

---

### Task 11: `server.ts` wiring + manual verification doc

**Files:**
- Modify: `server/src/server.ts` (construct `MembershipStore`; pass to `buildApp` + `attachWsServer`)
- Create: `docs/sync-phase-5a-verification.md`

**Interfaces:**
- Consumes: `MembershipStore`.
- Produces: `server.ts` constructs one `const memberships = new MembershipStore(config.dbPath)` shared by `buildApp` (deps) and `attachWsServer`.

- [ ] **Step 1: Wire `server/src/server.ts`**

Add import `import { MembershipStore } from "./membership-store.js";`. Construct `const memberships = new MembershipStore(config.dbPath);` (near the other stores). Add `memberships` to the `buildApp({ ... })` deps object. Change the `attachWsServer({ server: app.server, jwtSecret: config.jwtSecret, workspaces, realtime })` call to also pass `memberships`.

- [ ] **Step 2: Typecheck + full suite**

Run: `cd server && npm run typecheck && npx vitest run`
Expected: typecheck clean (this resolves any `server.ts` `attachWsServer` arity error from Task 10); all tests green.

- [ ] **Step 3: Create `docs/sync-phase-5a-verification.md`**

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add server/src/server.ts docs/sync-phase-5a-verification.md
git commit -m "feat(server): wire MembershipStore; docs phase 5a verification"
```

---

## Self-Review

**Spec coverage (build-order #5 backend half = "Sharing: members, roles, Drive permissions + notify, pending memberships, viewer read-only enforcement"):**
- Members: add by email + role → Task 8; list + remove (owner) → Task 9. ✓
- Roles owner/editor/viewer, enforced backend-side: pull any role (Task 5), push owner/editor & viewer→403 (Task 6), add/remove owner-only (Tasks 8/9). ✓
- Drive permissions + notify: `createPermission(..., sendNotificationEmail:true)` writer/reader (Task 3 + Task 8); revoke on remove (`deletePermission`, Task 9). ✓
- Pending memberships resolved on first sign-in: `resolvePending` (Task 2) called from `/auth/callback` (Task 10). ✓
- `memberships(workspace_id, user_id | pending_email, role)` table (spec line 58) → Task 2 (adds `id` PK + `permission_id` for revoke). ✓
- Realtime fans `workspace-changed` to members (spec line 146): `subscriptionsFor` includes shared ids (Task 10). ✓
- Owner-credential rule for member Drive I/O (Task 5/6 use `ownerDriveFor`, not the requester's client). ✓
- `GET /workspaces` returns owned + shared (spec lines 93-94) with roles → Task 7. ✓

Explicitly out of DS-Phase 5a (→ DS-Phase 5b, extension): `SyncClient` member methods, viewer read-only UI enforcement (extension disables edits), the Workspace/Members webview panel + switcher, member-removed-mid-edit 403 handling on the extension push path, and "owner deletes workspace → members notified" UX. The **backend** viewer-read-only enforcement (viewer PUT → 403) is done here (Task 6).

**Placeholder scan:** none — every code step carries full code. Task 5 Step 4 and Task 7 Step 4 describe additive edits to existing test files (adding a required dep / tolerating a new `role` field) in prose because they adapt to each file's current contents; both state exactly what to add.

**Type consistency:** `Role`/`Membership` (Task 2) used by `authz` (Task 4) and every members endpoint. `resolveRole` returns `"owner"|"editor"|"viewer"|null`; push checks `!== "owner" && !== "editor"`; add/remove check `!== "owner"`; pull/list check `!role`/truthiness — all consistent. `AppDeps.memberships` (added Task 5, required) then consumed by Tasks 6-10; every `buildApp` caller updated in Task 5. `subscriptionsFor` gains a 3rd `memberships` param (Task 10) and its sole non-test caller `attachWsServer`/`server.ts` is updated (Tasks 10/11). `ownerDriveFor` returns `DriveClient | undefined`; every call site guards undefined → 500. Drive role mapping editor→writer / viewer→reader is applied identically in Task 8 and asserted in its tests.

**Owner-credential invariant check:** Tasks 5, 6, 8, 9 all resolve the Drive client via `ownerDriveFor(deps, ws)` (owner's creds) — no endpoint uses `deps.driveFor(user)` for a shared workspace except `POST /workspaces` (create/enable, owner-only, where user IS the owner). Verified no member path triggers a Drive call under member credentials.

**Security review:** viewer PUT → 403 (Task 6); non-member GET/PUT → 403; add/remove owner-only; the Drive permission is revoked on member removal so a removed member loses Drive visibility; pending memberships never grant access until the email actually authenticates as that Google account (resolved by `google_sub`→email at `/auth/callback`). Secret-strip + revision invariants unchanged. `updatedBy` carries the acting member's email so collaborators see who changed what.

**Integration risk called out:** `server.ts` wiring (Task 11) is not unit-tested against a live process — every store/endpoint/authz/fan-out unit is tested; the real Google `permissions.create` email + cross-account share is covered by the Task 11 manual runbook (needs two Google accounts). Between Task 10 and Task 11, `server.ts` may transiently fail typecheck on the `attachWsServer` arity; Task 11 resolves it and the suite must be green at Task 11's end.
