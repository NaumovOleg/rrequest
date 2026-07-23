import { describe, it, expect } from "vitest";
import { MemoryWorkspaceStore } from "./workspace-store";
import type { SyncedWorkspace } from "../types";

const w = (over: Partial<SyncedWorkspace> = {}): SyncedWorkspace => ({
  id: "ws1", name: "Team", ownerUserId: "u1", driveFileId: "f1", hashFolderId: "fold1", revision: "r0", updatedAt: 1, ...over,
});

describe("MemoryWorkspaceStore", () => {
  it("upserts (insert then update) and reads back", async () => {
    const s = new MemoryWorkspaceStore();
    await s.upsert(w());
    expect((await s.get("ws1"))?.driveFileId).toBe("f1");
    await s.upsert(w({ name: "Renamed", driveFileId: "f2" }));
    expect((await s.get("ws1"))?.name).toBe("Renamed");
    expect((await s.get("ws1"))?.driveFileId).toBe("f2");
  });
  it("lists by owner", async () => {
    const s = new MemoryWorkspaceStore();
    await s.upsert(w({ id: "a", ownerUserId: "u1" }));
    await s.upsert(w({ id: "b", ownerUserId: "u2" }));
    await s.upsert(w({ id: "c", ownerUserId: "u1" }));
    expect((await s.listByOwner("u1")).map((x) => x.id).sort()).toEqual(["a", "c"]);
  });
  it("updates revision + updatedAt", async () => {
    const s = new MemoryWorkspaceStore();
    await s.upsert(w());
    await s.setRevision("ws1", "r5", 999);
    expect((await s.get("ws1"))?.revision).toBe("r5");
    expect((await s.get("ws1"))?.updatedAt).toBe(999);
  });
  it("returns undefined for unknown id", async () => {
    expect(await new MemoryWorkspaceStore().get("nope")).toBeUndefined();
  });
  it("returns all ids", async () => {
    const s = new MemoryWorkspaceStore();
    await s.upsert(w({ id: "a" }));
    await s.upsert(w({ id: "b" }));
    expect((await s.allIds()).sort()).toEqual(["a", "b"]);
  });
});
