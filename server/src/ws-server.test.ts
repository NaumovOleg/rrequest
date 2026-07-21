import { describe, it, expect } from "vitest";
import { subscriptionsFor } from "./ws-server";
import { WorkspaceStore } from "./workspace-store";

describe("subscriptionsFor", () => {
  it("returns the workspace ids owned by the user", () => {
    const ws = new WorkspaceStore(":memory:");
    ws.upsert({ id: "a", name: "A", ownerUserId: "u1", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    ws.upsert({ id: "b", name: "B", ownerUserId: "u2", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    ws.upsert({ id: "c", name: "C", ownerUserId: "u1", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    expect(subscriptionsFor("u1", ws).sort()).toEqual(["a", "c"]);
  });
});
