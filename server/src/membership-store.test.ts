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

  describe("findByWorkspaceUser / update", () => {
    it("findByWorkspaceUser returns the resolved membership; undefined for a non-member", () => {
      const s = new MembershipStore(":memory:");
      const m = s.add({ ...base, userId: "u1" });
      expect(s.findByWorkspaceUser("w1", "u1")).toMatchObject({ id: m.id, workspaceId: "w1", userId: "u1", role: "editor" });
      expect(s.findByWorkspaceUser("w1", "nobody")).toBeUndefined();
      expect(s.findByWorkspaceUser("other-ws", "u1")).toBeUndefined();
    });
    it("update changes role and/or permissionId in place, leaving other fields intact", () => {
      const s = new MembershipStore(":memory:");
      const m = s.add({ ...base, userId: "u1" });
      s.update(m.id, { role: "viewer", permissionId: "p2" });
      expect(s.getById(m.id)).toMatchObject({ id: m.id, workspaceId: "w1", userId: "u1", role: "viewer", permissionId: "p2" });
      expect(s.listByWorkspace("w1")).toHaveLength(1);
      // partial patch: only role changes, permissionId retained
      s.update(m.id, { role: "editor" });
      expect(s.getById(m.id)).toMatchObject({ role: "editor", permissionId: "p2" });
    });
  });
});
