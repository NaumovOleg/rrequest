import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDynalite, type DynaliteHarness } from "../../test-support/dynalite";
import { DynamoUserStore } from "../../../../server/src/stores/dynamo/user-store";

const TABLE = "Users";
const ENC_KEY = "test-secret-key";

describe("DynamoUserStore", () => {
  let harness: DynaliteHarness;
  let store: DynamoUserStore;

  beforeAll(async () => {
    harness = await startDynalite();
    await harness.createTable({
      TableName: TABLE,
      AttributeDefinitions: [
        { AttributeName: "userId", AttributeType: "S" },
        { AttributeName: "googleSub", AttributeType: "S" },
        { AttributeName: "email", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "gsi_googleSub",
          KeySchema: [{ AttributeName: "googleSub", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
        {
          IndexName: "gsi_email",
          KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    });
    store = new DynamoUserStore({ doc: harness.doc, table: TABLE, encKey: ENC_KEY });
  }, 20000);

  afterAll(async () => {
    await harness.stop();
  });

  it("inserts a new user and returns it with a generated id + decrypted token", async () => {
    const u = await store.upsertByGoogle({ googleSub: "g1", email: "a@x.com", refreshToken: "rt1" });
    expect(u.id).toBeTruthy();
    expect(u.email).toBe("a@x.com");
    expect(u.googleSub).toBe("g1");
    expect(u.refreshToken).toBe("rt1");
  });

  it("getById returns the decrypted user", async () => {
    const u = await store.upsertByGoogle({ googleSub: "g2", email: "b@x.com", refreshToken: "rt2" });
    const found = await store.getById(u.id);
    expect(found?.email).toBe("b@x.com");
    expect(found?.refreshToken).toBe("rt2");
  });

  it("returns undefined for an unknown id", async () => {
    expect(await store.getById("nope")).toBeUndefined();
  });

  it("upserts by googleSub (same id, updated email + token)", async () => {
    const first = await store.upsertByGoogle({ googleSub: "g3", email: "c@x.com", refreshToken: "rt3" });
    const second = await store.upsertByGoogle({ googleSub: "g3", email: "c2@x.com", refreshToken: "rt3b" });
    expect(second.id).toBe(first.id);
    const found = await store.getById(first.id);
    expect(found?.email).toBe("c2@x.com");
    expect(found?.refreshToken).toBe("rt3b");
  });

  it("getByEmail finds the user via the email GSI, or undefined on miss", async () => {
    const u = await store.upsertByGoogle({ googleSub: "g4", email: "d@x.com", refreshToken: "rt4" });
    const found = await store.getByEmail("d@x.com");
    expect(found?.id).toBe(u.id);
    expect(found?.refreshToken).toBe("rt4");
    expect(await store.getByEmail("missing@x.com")).toBeUndefined();
  });
});
