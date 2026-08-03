import { describe, it, expect } from "vitest";
import { WorkspaceService } from "../../../server/src/services/workspace-service.js";
import { MemoryWorkspaceStore } from "../../../server/src/stores/memory/workspace-store.js";
import { MemoryUserStore } from "../../../server/src/stores/memory/user-store.js";
import { MemoryMembershipStore } from "../../../server/src/stores/memory/membership-store.js";
import { FakeDriveClient } from "../../../server/src/domain/drive-client.js";
import type { User } from "../../../server/src/stores/types.js";

function makeService() {
  const workspaces = new MemoryWorkspaceStore();
  const users = new MemoryUserStore();
  const memberships = new MemoryMembershipStore();
  const drive = new FakeDriveClient();
  const driveFor = () => drive;
  const service = new WorkspaceService({ workspaces, memberships, users, driveFor });
  return { service, workspaces, users, memberships, drive };
}

async function makeUser(users: MemoryUserStore, email: string): Promise<User> {
  return users.upsertByGoogle({ googleSub: `sub-${email}`, email, refreshToken: `rt-${email}` });
}

describe("WorkspaceService.enable", () => {
  it("creates a new workspace, strips secret env values, and returns driveFileId + revision", async () => {
    const { service, users, drive } = makeService();
    const u = await makeUser(users, "alice@x.com");
    const snapshot = JSON.stringify({
      environments: [{ variables: [{ secret: true, value: "shh" }, { secret: false, value: "keep" }] }],
    });
    const result = await service.enable(u, { workspaceId: "w1", name: "My WS", snapshot });
    expect("status" in result).toBe(false);
    const ok = result as { driveFileId: string; revision: string };
    expect(ok.driveFileId).toBeTruthy();
    expect(ok.revision).toBeTruthy();
    const stored = JSON.parse(await drive.readFile(ok.driveFileId));
    expect(stored.environments[0].variables[0].value).toBe("");
    expect(stored.environments[0].variables[1].value).toBe("keep");
  });

  it("updates an existing workspace owned by the same user", async () => {
    const { service, users, drive } = makeService();
    const u = await makeUser(users, "alice@x.com");
    const created = await service.enable(u, { workspaceId: "w1", name: "WS", snapshot: "{}" }) as { driveFileId: string; revision: string };
    const updated = await service.enable(u, { workspaceId: "w1", name: "WS renamed", snapshot: '{"a":1}' }) as { driveFileId: string; revision: string };
    expect(updated.driveFileId).toBe(created.driveFileId);
    expect(updated.revision).not.toBe(created.revision);
    const content = await drive.readFile(updated.driveFileId);
    expect(content).toBe('{"a":1}');
  });

  it("403s when the workspace already exists and is owned by someone else", async () => {
    const { service, users } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const intruder = await makeUser(users, "intruder@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    const result = await service.enable(intruder, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    expect(result).toEqual({ status: 403 });
  });
});

describe("WorkspaceService.list", () => {
  it("returns owned workspaces with role owner and shared workspaces with their membership role, deduped", async () => {
    const { service, users, memberships } = makeService();
    const alice = await makeUser(users, "alice@x.com");
    const bob = await makeUser(users, "bob@x.com");

    await service.enable(alice, { workspaceId: "owned-1", name: "Owned", snapshot: "{}" });
    await service.enable(bob, { workspaceId: "shared-1", name: "Shared", snapshot: "{}" });
    await memberships.add({ workspaceId: "shared-1", userId: alice.id, role: "editor", permissionId: "p1" });

    // Edge case: alice also has a stray membership row on her own workspace -- owner must win, no dupes.
    await memberships.add({ workspaceId: "owned-1", userId: alice.id, role: "viewer", permissionId: "p2" });

    const list = await service.list(alice);
    expect(list).toHaveLength(2);
    const byId = Object.fromEntries(list.map((w) => [w.id, w.role]));
    expect(byId["owned-1"]).toBe("owner");
    expect(byId["shared-1"]).toBe("editor");
  });

  it("returns an empty list for a user with no workspaces", async () => {
    const { service, users } = makeService();
    const u = await makeUser(users, "lonely@x.com");
    expect(await service.list(u)).toEqual([]);
  });
});

describe("WorkspaceService.pull", () => {
  it("404s for an unknown workspace", async () => {
    const { service, users } = makeService();
    const u = await makeUser(users, "alice@x.com");
    expect(await service.pull(u, "missing")).toEqual({ status: 404 });
  });

  it("403s for a non-member", async () => {
    const { service, users } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const stranger = await makeUser(users, "stranger@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    expect(await service.pull(stranger, "w1")).toEqual({ status: 403 });
  });

  it("returns snapshot + revision + role for the owner", async () => {
    const { service, users } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const created = await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: '{"x":1}' }) as { driveFileId: string; revision: string };
    const result = await service.pull(owner, "w1");
    expect(result).toEqual({ snapshot: '{"x":1}', revision: created.revision, role: "owner" });
  });

  it("returns snapshot + revision + role for a member (editor/viewer)", async () => {
    const { service, users, memberships } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const viewer = await makeUser(users, "viewer@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: '{"x":1}' });
    await memberships.add({ workspaceId: "w1", userId: viewer.id, role: "viewer", permissionId: "p1" });
    const result = await service.pull(viewer, "w1");
    expect(result).toEqual({ snapshot: '{"x":1}', revision: "1", role: "viewer" });
  });

  it("500s when the workspace owner account no longer exists (role resolved via membership)", async () => {
    const { service, users, memberships, workspaces } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const viewer = await makeUser(users, "viewer@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    await memberships.add({ workspaceId: "w1", userId: viewer.id, role: "viewer", permissionId: "p1" });
    // Simulate a dangling owner reference -- the viewer's membership role still resolves fine.
    const ws = await workspaces.get("w1");
    await workspaces.upsert({ ...ws!, ownerUserId: "ghost-user" });
    expect(await service.pull(viewer, "w1")).toEqual({ status: 500 });
  });
});

describe("WorkspaceService.push", () => {
  it("404s for an unknown workspace", async () => {
    const { service, users } = makeService();
    const u = await makeUser(users, "alice@x.com");
    const result = await service.push(u, "missing", { snapshot: "{}", baseRevision: "1" });
    expect(result).toEqual({ status: 404 });
  });

  it("403s for a non-member", async () => {
    const { service, users } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const stranger = await makeUser(users, "stranger@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    const result = await service.push(stranger, "w1", { snapshot: "{}", baseRevision: "1" });
    expect(result).toEqual({ status: 403 });
  });

  it("403s for a viewer", async () => {
    const { service, users, memberships } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const viewer = await makeUser(users, "viewer@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    await memberships.add({ workspaceId: "w1", userId: viewer.id, role: "viewer", permissionId: "p1" });
    const result = await service.push(viewer, "w1", { snapshot: '{"a":1}', baseRevision: "1" });
    expect(result).toEqual({ status: 403 });
  });

  it("400s when snapshot or baseRevision is missing", async () => {
    const { service, users } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    expect(await service.push(owner, "w1", { baseRevision: "1" })).toEqual({ status: 400 });
    expect(await service.push(owner, "w1", { snapshot: "{}" })).toEqual({ status: 400 });
  });

  it("succeeds for the owner, strips secrets, and bumps revision", async () => {
    const { service, users, workspaces } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    const snapshot = JSON.stringify({ environments: [{ variables: [{ secret: true, value: "shh" }] }] });
    const result = await service.push(owner, "w1", { snapshot, baseRevision: "1" });
    expect(result).toEqual({ revision: "2" });
    const ws = await workspaces.get("w1");
    expect(ws!.revision).toBe("2");
  });

  it("succeeds for an editor", async () => {
    const { service, users, memberships } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const editor = await makeUser(users, "editor@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    await memberships.add({ workspaceId: "w1", userId: editor.id, role: "editor", permissionId: "p1" });
    const result = await service.push(editor, "w1", { snapshot: '{"a":1}', baseRevision: "1" });
    expect(result).toEqual({ revision: "2" });
  });

  it("updates the workspace row name from the pushed snapshot (rename propagates to DynamoDB)", async () => {
    const { service, users, workspaces } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "Old Name", snapshot: '{"name":"Old Name"}' });
    await service.push(owner, "w1", { snapshot: '{"name":"New Name","collections":[]}', baseRevision: "1" });
    const ws = await workspaces.get("w1");
    expect(ws!.name).toBe("New Name");
  });

  it("renames the Drive file (its filename) when the pushed name changes", async () => {
    const { service, users, workspaces, drive } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "Old", snapshot: '{"name":"Old"}' });
    const fileId = (await workspaces.get("w1"))!.driveFileId;
    expect(drive.nameOf(fileId)).toBe("Old-w1.json");
    await service.push(owner, "w1", { snapshot: '{"name":"New","collections":[]}', baseRevision: "1" });
    expect(drive.nameOf(fileId)).toBe("New-w1.json");
  });

  it("409s with the current snapshot + revision on a stale baseRevision", async () => {
    const { service, users } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: '{"orig":true}' });
    // Someone else already pushed, bumping revision to 2.
    await service.push(owner, "w1", { snapshot: '{"v":2}', baseRevision: "1" });
    const result = await service.push(owner, "w1", { snapshot: '{"stale":true}', baseRevision: "1" });
    expect(result).toEqual({ status: 409, body: { snapshot: '{"v":2}', revision: "2" } });
  });

  it("500s when the workspace owner account no longer exists (role resolved via membership)", async () => {
    const { service, users, memberships, workspaces } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const editor = await makeUser(users, "editor@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    await memberships.add({ workspaceId: "w1", userId: editor.id, role: "editor", permissionId: "p1" });
    const ws = await workspaces.get("w1");
    await workspaces.upsert({ ...ws!, ownerUserId: "ghost-user" });
    const result = await service.push(editor, "w1", { snapshot: "{}", baseRevision: "1" });
    expect(result).toEqual({ status: 500 });
  });
});

describe("WorkspaceService.recover", () => {
  it("rebuilds a missing workspace row from the surviving Drive file (DynamoDB desync)", async () => {
    const { service, users, workspaces } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "Test", snapshot: JSON.stringify({ workspaceId: "w1", name: "Test", collections: [] }) });
    // Simulate the desync: the Drive file remains, the DynamoDB row is gone.
    await workspaces.delete("w1");
    expect(await workspaces.get("w1")).toBeUndefined();

    const res = await service.recover(owner);
    expect(res).toEqual({ recovered: ["w1"], total: 1 });
    const ws = await workspaces.get("w1");
    expect(ws!.name).toBe("Test");
    expect(ws!.ownerUserId).toBe(owner.id);
  });

  it("skips workspaces that are already indexed (no duplicate rows)", async () => {
    const { service, users } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "Test", snapshot: JSON.stringify({ workspaceId: "w1", name: "Test" }) });
    const res = await service.recover(owner);
    expect(res).toEqual({ recovered: [], total: 1 });
  });
});
