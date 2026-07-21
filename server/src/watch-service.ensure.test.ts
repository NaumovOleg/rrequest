import { describe, it, expect } from "vitest";
import { WatchService } from "./watch-service";
import { WorkspaceStore } from "./workspace-store";
import { UserStore } from "./user-store";
import { WatchChannelStore } from "./watch-channel-store";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";

function make(publicWebhookUrl?: string) {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "g", email: "o@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const watch = new WatchChannelStore(":memory:");
  const drive = new FakeDriveClient();
  const svc = new WatchService({ config: { publicWebhookUrl, channelTtlSeconds: 604800 } as any, users, workspaces, watch, driveFor: () => drive, realtime: new Realtime() });
  return { users, owner, workspaces, watch, drive, svc };
}

describe("WatchService.ensureWatch", () => {
  it("registers a channel and stores it when a public webhook url is set", async () => {
    const t = make("https://pub.example");
    const { fileId, revision } = await t.drive.createFile("f", "n", "{}");
    t.workspaces.upsert({ id: "w1", name: "W", ownerUserId: t.owner.id, driveFileId: fileId, hashFolderId: "h", revision, updatedAt: 1 });
    await t.svc.ensureWatch("w1");
    const row = t.watch.getByWorkspaceId("w1")!;
    expect(row.channelId).toBeTypeOf("string");
    expect(t.drive.watched(row.channelId)).toMatchObject({ fileId, token: row.token });
  });
  it("is a no-op when no public webhook url is configured", async () => {
    const t = make(undefined);
    const { fileId, revision } = await t.drive.createFile("f", "n", "{}");
    t.workspaces.upsert({ id: "w1", name: "W", ownerUserId: t.owner.id, driveFileId: fileId, hashFolderId: "h", revision, updatedAt: 1 });
    await t.svc.ensureWatch("w1");
    expect(t.watch.getByWorkspaceId("w1")).toBeUndefined();
  });
  it("stops the previous channel when re-registering", async () => {
    const t = make("https://pub.example");
    const { fileId, revision } = await t.drive.createFile("f", "n", "{}");
    t.workspaces.upsert({ id: "w1", name: "W", ownerUserId: t.owner.id, driveFileId: fileId, hashFolderId: "h", revision, updatedAt: 1 });
    await t.svc.ensureWatch("w1");
    const first = t.watch.getByWorkspaceId("w1")!.channelId;
    await t.svc.ensureWatch("w1");
    const second = t.watch.getByWorkspaceId("w1")!.channelId;
    expect(second).not.toBe(first);
    expect(t.drive.watched(first)).toBeUndefined(); // old channel stopped
  });
});
