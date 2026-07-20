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
