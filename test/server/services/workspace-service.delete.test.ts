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
  const fakeDrive = new FakeDriveClient();
  const driveFor = () => fakeDrive;
  const service = new WorkspaceService({ workspaces, memberships, users, driveFor });
  return { service, workspaces, users, memberships, fakeDrive };
}

async function makeUser(users: MemoryUserStore, email: string): Promise<User> {
  return users.upsertByGoogle({ googleSub: `sub-${email}`, email, refreshToken: `rt-${email}` });
}

describe("WorkspaceService.deleteSync", () => {
  it("owner deletes: workspace row gone, its memberships gone, Drive file trashed, returns {ok:true}", async () => {
    const { service, workspaces, users, memberships, fakeDrive } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    const other = await makeUser(users, "other@x.com");
    const enabled = await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    if (!("driveFileId" in enabled)) throw new Error("enable failed");
    const m1 = await memberships.add({ workspaceId: "w1", userId: other.id, role: "viewer", permissionId: "perm-1" });
    const m2 = await memberships.add({ workspaceId: "w1", userId: other.id, role: "editor", permissionId: "perm-2" });

    const result = await service.deleteSync(owner, "w1");

    expect(result).toEqual({ ok: true });
    expect(await workspaces.get("w1")).toBeUndefined();
    expect(await memberships.getById(m1.id)).toBeUndefined();
    expect(await memberships.getById(m2.id)).toBeUndefined();
    expect(fakeDrive.trashed(enabled.driveFileId)).toBe(true);
  });

  it("non-owner cannot delete: 403, row + Drive file intact", async () => {
    const { service, workspaces, users, fakeDrive } = makeService();
    const owner = await makeUser(users, "owner2@x.com");
    const other = await makeUser(users, "other2@x.com");
    const enabled = await service.enable(owner, { workspaceId: "w2", name: "WS2", snapshot: "{}" });
    if (!("driveFileId" in enabled)) throw new Error("enable failed");

    const result = await service.deleteSync(other, "w2");

    expect(result).toEqual({ status: 403 });
    expect(await workspaces.get("w2")).toBeDefined();
    expect(fakeDrive.trashed(enabled.driveFileId)).toBe(false);
  });

  it("unknown workspace: 404", async () => {
    const { service, users } = makeService();
    const owner = await makeUser(users, "owner3@x.com");

    const result = await service.deleteSync(owner, "nope");

    expect(result).toEqual({ status: 404 });
  });
});
