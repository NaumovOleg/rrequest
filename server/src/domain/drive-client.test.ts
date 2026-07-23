import { describe, it, expect } from "vitest";
import { FakeDriveClient } from "./drive-client";

describe("FakeDriveClient", () => {
  it("ensures a folder idempotently (same id for the same name)", async () => {
    const d = new FakeDriveClient();
    const a = await d.ensureFolder("h-restman");
    const b = await d.ensureFolder("h-restman");
    expect(a).toBe(b);
  });
  it("creates, reads, and updates a file, bumping the revision", async () => {
    const d = new FakeDriveClient();
    const folder = await d.ensureFolder("h-restman");
    const created = await d.createFile(folder, "w.json", "v1");
    expect(await d.readFile(created.fileId)).toBe("v1");
    const updated = await d.updateFile(created.fileId, "v2");
    expect(await d.readFile(created.fileId)).toBe("v2");
    expect(updated.revision).not.toBe(created.revision);
  });
  it("throws reading an unknown file", async () => {
    await expect(new FakeDriveClient().readFile("nope")).rejects.toThrow();
  });
});

describe("FakeDriveClient watch surface", () => {
  it("getHeadRevision returns the current revision as a string and tracks updates", async () => {
    const d = new FakeDriveClient();
    const { fileId, revision } = await d.createFile("f", "n", "{}");
    expect(await d.getHeadRevision(fileId)).toBe(revision);
    const { revision: r2 } = await d.updateFile(fileId, "{\"v\":2}");
    expect(await d.getHeadRevision(fileId)).toBe(r2);
    expect(r2).not.toBe(revision);
  });
  it("watchFile records a channel and returns channelId/resourceId/expiration", async () => {
    const d = new FakeDriveClient();
    const { fileId } = await d.createFile("f", "n", "{}");
    const info = await d.watchFile(fileId, { channelId: "ch1", address: "https://x/webhook", token: "tok" });
    expect(info.channelId).toBe("ch1");
    expect(info.resourceId).toBeTypeOf("string");
    expect(info.expiration).toBeGreaterThan(Date.now());
    expect(d.watched("ch1")).toMatchObject({ fileId, token: "tok" });
  });
  it("stopChannel removes a recorded channel", async () => {
    const d = new FakeDriveClient();
    const { fileId } = await d.createFile("f", "n", "{}");
    const info = await d.watchFile(fileId, { channelId: "ch1", address: "a", token: "t" });
    await d.stopChannel({ channelId: "ch1", resourceId: info.resourceId });
    expect(d.watched("ch1")).toBeUndefined();
  });
});

describe("FakeDriveClient permissions", () => {
  it("creates and lists a permission, and deletes it", async () => {
    const d = new FakeDriveClient();
    const { fileId } = await d.createFile("f", "n", "{}");
    const { permissionId } = await d.createPermission(fileId, { email: "m@x.com", role: "writer", sendNotificationEmail: true });
    expect(permissionId).toBeTypeOf("string");
    expect(d.permissions(fileId)).toEqual([{ permissionId, email: "m@x.com", role: "writer" }]);
    await d.deletePermission(fileId, permissionId);
    expect(d.permissions(fileId)).toEqual([]);
  });
});
