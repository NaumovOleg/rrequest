import { describe, it, expect } from "vitest";
import { MemoryMembershipStore } from "../../../../server/src/stores/memory/membership-store";

const base = { workspaceId: "w1", role: "editor" as const, permissionId: "p1" };

describe("MemoryMembershipStore", () => {
  it("adds a resolved membership and reads it back by id/workspace/user", async () => {
    const s = new MemoryMembershipStore();
    const m = await s.add({ ...base, userId: "u1" });
    expect(m.id).toBeTypeOf("string");
    expect(await s.getById(m.id)).toMatchObject({ workspaceId: "w1", userId: "u1", role: "editor" });
    expect(await s.listByWorkspace("w1")).toHaveLength(1);
    expect((await s.listByUser("u1")).map((x) => x.workspaceId)).toEqual(["w1"]);
    expect(await s.roleForUser("w1", "u1")).toBe("editor");
    expect(await s.roleForUser("w1", "nobody")).toBeUndefined();
  });
  it("adds a pending membership (no userId) and resolves it by email", async () => {
    const s = new MemoryMembershipStore();
    await s.add({ ...base, pendingEmail: "p@x.com", role: "viewer" });
    expect(await s.roleForUser("w1", "u9")).toBeUndefined(); // still pending
    expect((await s.findByWorkspaceEmail("w1", "p@x.com"))?.role).toBe("viewer");
    const n = await s.resolvePending("p@x.com", "u9");
    expect(n).toBe(1);
    expect(await s.roleForUser("w1", "u9")).toBe("viewer");
    expect(await s.listByUser("u9")).toHaveLength(1);
  });
  it("removes a membership by id", async () => {
    const s = new MemoryMembershipStore();
    const m = await s.add({ ...base, userId: "u1" });
    await s.remove(m.id);
    expect(await s.getById(m.id)).toBeUndefined();
    expect(await s.listByWorkspace("w1")).toHaveLength(0);
  });

  describe("findByWorkspaceUser / update", () => {
    it("findByWorkspaceUser returns the resolved membership; undefined for a non-member", async () => {
      const s = new MemoryMembershipStore();
      const m = await s.add({ ...base, userId: "u1" });
      expect(await s.findByWorkspaceUser("w1", "u1")).toMatchObject({ id: m.id, workspaceId: "w1", userId: "u1", role: "editor" });
      expect(await s.findByWorkspaceUser("w1", "nobody")).toBeUndefined();
      expect(await s.findByWorkspaceUser("other-ws", "u1")).toBeUndefined();
    });
    it("update changes role and/or permissionId in place, leaving other fields intact", async () => {
      const s = new MemoryMembershipStore();
      const m = await s.add({ ...base, userId: "u1" });
      await s.update(m.id, { role: "viewer", permissionId: "p2" });
      expect(await s.getById(m.id)).toMatchObject({ id: m.id, workspaceId: "w1", userId: "u1", role: "viewer", permissionId: "p2" });
      expect(await s.listByWorkspace("w1")).toHaveLength(1);
      // partial patch: only role changes, permissionId retained
      await s.update(m.id, { role: "editor" });
      expect(await s.getById(m.id)).toMatchObject({ role: "editor", permissionId: "p2" });
    });
  });
});
