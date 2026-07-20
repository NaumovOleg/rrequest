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
