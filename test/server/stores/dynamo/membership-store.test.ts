import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDynalite, type DynaliteHarness } from "../../test-support/dynalite";
import { DynamoMembershipStore } from "../../../../server/src/stores/dynamo/membership-store";
import type { Membership } from "../../../../server/src/stores/types";

const TABLE = "Memberships";

const base = { workspaceId: "w1", role: "editor" as const, permissionId: "p1" };

describe("DynamoMembershipStore", () => {
  let harness: DynaliteHarness;
  let store: DynamoMembershipStore;

  beforeAll(async () => {
    harness = await startDynalite();
    await harness.createTable({
      TableName: TABLE,
      AttributeDefinitions: [
        { AttributeName: "membershipId", AttributeType: "S" },
        { AttributeName: "workspaceId", AttributeType: "S" },
        { AttributeName: "userId", AttributeType: "S" },
        { AttributeName: "pendingEmail", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "membershipId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "gsi_ws",
          KeySchema: [{ AttributeName: "workspaceId", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
        {
          IndexName: "gsi_user",
          KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
        {
          IndexName: "gsi_pendingEmail",
          KeySchema: [{ AttributeName: "pendingEmail", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    });
    store = new DynamoMembershipStore({ doc: harness.doc, table: TABLE });
  }, 20000);

  afterAll(async () => {
    await harness.stop();
  });

  it("adds a resolved membership and reads it back by id/workspace/user", async () => {
    const m = await store.add({ ...base, userId: "u1" });
    expect(m.id).toBeTypeOf("string");
    expect(await store.getById(m.id)).toMatchObject({ workspaceId: "w1", userId: "u1", role: "editor" });
    expect(await store.listByWorkspace("w1")).toHaveLength(1);
    expect((await store.listByUser("u1")).map((x) => x.workspaceId)).toEqual(["w1"]);
    expect(await store.roleForUser("w1", "u1")).toBe("editor");
    expect(await store.roleForUser("w1", "nobody")).toBeUndefined();
  });

  it("adds a pending membership (no userId) and resolves it by email", async () => {
    await store.add({ workspaceId: "w2", pendingEmail: "p@x.com", role: "viewer", permissionId: "p1" });
    expect(await store.roleForUser("w2", "u9")).toBeUndefined(); // still pending
    expect((await store.findByWorkspaceEmail("w2", "p@x.com"))?.role).toBe("viewer");
    const n = await store.resolvePending("p@x.com", "u9");
    expect(n).toBe(1);
    expect(await store.roleForUser("w2", "u9")).toBe("viewer");
    expect(await store.listByUser("u9")).toHaveLength(1);
    // resolved membership no longer visible via gsi_pendingEmail
    expect(await store.findByWorkspaceEmail("w2", "p@x.com")).toBeUndefined();
  });

  it("resolvePending updates all pending rows for the email across workspaces", async () => {
    await store.add({ workspaceId: "w3", pendingEmail: "multi@x.com", role: "viewer", permissionId: "p1" });
    await store.add({ workspaceId: "w4", pendingEmail: "multi@x.com", role: "editor", permissionId: "p2" });
    const n = await store.resolvePending("multi@x.com", "u-multi");
    expect(n).toBe(2);
    expect(await store.roleForUser("w3", "u-multi")).toBe("viewer");
    expect(await store.roleForUser("w4", "u-multi")).toBe("editor");
    const byUser = await store.listByUser("u-multi");
    expect(byUser).toHaveLength(2);
    expect(byUser.every((m) => m.pendingEmail === undefined)).toBe(true);
  });

  it("removes a membership by id", async () => {
    const m = await store.add({ workspaceId: "w-rm", role: "editor", permissionId: "p1", userId: "u-rm" });
    await store.remove(m.id);
    expect(await store.getById(m.id)).toBeUndefined();
    expect(await store.listByWorkspace("w-rm")).toHaveLength(0);
  });

  describe("findByWorkspaceUser / update", () => {
    it("findByWorkspaceUser returns the resolved membership; undefined for a non-member", async () => {
      const m = await store.add({ workspaceId: "w-fwu", role: "editor", permissionId: "p1", userId: "u-fwu" });
      expect(await store.findByWorkspaceUser("w-fwu", "u-fwu")).toMatchObject({
        id: m.id,
        workspaceId: "w-fwu",
        userId: "u-fwu",
        role: "editor",
      });
      expect(await store.findByWorkspaceUser("w-fwu", "nobody")).toBeUndefined();
      expect(await store.findByWorkspaceUser("other-ws", "u-fwu")).toBeUndefined();
    });

    it("update changes role and/or permissionId in place, leaving other fields intact", async () => {
      const m = await store.add({ workspaceId: "w-upd", role: "editor", permissionId: "p1", userId: "u-upd" });
      await store.update(m.id, { role: "viewer", permissionId: "p2" });
      expect(await store.getById(m.id)).toMatchObject({
        id: m.id,
        workspaceId: "w-upd",
        userId: "u-upd",
        role: "viewer",
        permissionId: "p2",
      });
      expect(await store.listByWorkspace("w-upd")).toHaveLength(1);
      // partial patch: only role changes, permissionId retained
      await store.update(m.id, { role: "editor" });
      expect(await store.getById(m.id)).toMatchObject({ role: "editor", permissionId: "p2" });
    });

    it("re-invite: update on a pending membership changes role without creating a duplicate row", async () => {
      const m = await store.add({ workspaceId: "w-reinv", pendingEmail: "reinv@x.com", role: "viewer", permissionId: "p1" });
      await store.update(m.id, { role: "editor" });
      expect(await store.listByWorkspace("w-reinv")).toHaveLength(1);
      const found = await store.findByWorkspaceEmail("w-reinv", "reinv@x.com");
      expect(found).toMatchObject({ id: m.id, role: "editor", permissionId: "p1" });
    });
  });

  it("does not write undefined userId/pendingEmail attrs (GSIs only index items that have the key)", async () => {
    const resolved: Membership = await store.add({ workspaceId: "w-attr", role: "editor", permissionId: "p1", userId: "u-attr" });
    expect(await store.findByWorkspaceEmail("w-attr", "irrelevant")).toBeUndefined();
    expect(resolved.pendingEmail).toBeUndefined();

    const pending = await store.add({ workspaceId: "w-attr", pendingEmail: "attr@x.com", role: "viewer", permissionId: "p1" });
    expect(pending.userId).toBeUndefined();
    // pending item has no userId attr, so it's invisible via gsi_user
    expect(await store.findByWorkspaceUser("w-attr", "u-attr")).toMatchObject({ id: resolved.id });
    expect(await store.listByWorkspace("w-attr")).toHaveLength(2);
  });
});
