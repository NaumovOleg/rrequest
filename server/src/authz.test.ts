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
