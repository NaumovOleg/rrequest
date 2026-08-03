import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDynalite, type DynaliteHarness } from "../../test-support/dynalite";
import { DynamoWorkspaceStore } from "../../../../server/src/stores/dynamo/workspace-store";
import type { SyncedWorkspace } from "../../../../server/src/stores/types";

const TABLE = "Workspaces";

const w = (over: Partial<SyncedWorkspace> = {}): SyncedWorkspace => ({
  id: "ws1", name: "Team", ownerUserId: "u1", driveFileId: "f1", hashFolderId: "fold1", revision: "r0", updatedAt: 1, ...over,
});

describe("DynamoWorkspaceStore", () => {
  let harness: DynaliteHarness;
  let store: DynamoWorkspaceStore;

  beforeAll(async () => {
    harness = await startDynalite();
    await harness.createTable({
      TableName: TABLE,
      AttributeDefinitions: [
        { AttributeName: "workspaceId", AttributeType: "S" },
        { AttributeName: "ownerUserId", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "workspaceId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "gsi_owner",
          KeySchema: [{ AttributeName: "ownerUserId", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    });
    store = new DynamoWorkspaceStore({ doc: harness.doc, table: TABLE });
  }, 20000);

  afterAll(async () => {
    await harness.stop();
  });

  it("upserts (insert then update) and reads back", async () => {
    await store.upsert(w());
    expect((await store.get("ws1"))?.driveFileId).toBe("f1");
    await store.upsert(w({ name: "Renamed", driveFileId: "f2" }));
    expect((await store.get("ws1"))?.name).toBe("Renamed");
    expect((await store.get("ws1"))?.driveFileId).toBe("f2");
  });

  it("returns undefined for unknown id", async () => {
    expect(await store.get("nope")).toBeUndefined();
  });

  it("lists by owner via gsi_owner", async () => {
    await store.upsert(w({ id: "a", ownerUserId: "owner1" }));
    await store.upsert(w({ id: "b", ownerUserId: "owner2" }));
    await store.upsert(w({ id: "c", ownerUserId: "owner1" }));
    const list = await store.listByOwner("owner1");
    expect(list.map((x) => x.id).sort()).toEqual(["a", "c"]);
    expect(list.every((x) => x.ownerUserId === "owner1")).toBe(true);
  });

  it("updates revision + updatedAt", async () => {
    await store.upsert(w({ id: "rev-ws" }));
    await store.setRevision("rev-ws", "r5", 999);
    expect((await store.get("rev-ws"))?.revision).toBe("r5");
    expect((await store.get("rev-ws"))?.updatedAt).toBe(999);
  });

  it("returns all ids via scan", async () => {
    await store.upsert(w({ id: "scan-a", ownerUserId: "scan-owner" }));
    await store.upsert(w({ id: "scan-b", ownerUserId: "scan-owner" }));
    const ids = await store.allIds();
    expect(ids).toContain("scan-a");
    expect(ids).toContain("scan-b");
  });

  it("deletes a workspace row", async () => {
    await store.upsert(w({ id: "del-ws" }));
    expect(await store.get("del-ws")).toBeDefined();
    await store.delete("del-ws");
    expect(await store.get("del-ws")).toBeUndefined();
  });

  it("delete is a no-op for an unknown id", async () => {
    await expect(store.delete("never-existed")).resolves.toBeUndefined();
  });
});
