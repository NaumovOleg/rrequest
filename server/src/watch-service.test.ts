import { describe, it, expect, vi } from "vitest";
import { WatchService } from "./watch-service";
import { WorkspaceStore } from "./workspace-store";
import { UserStore } from "./user-store";
import { WatchChannelStore } from "./watch-channel-store";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";

function setup() {
  const users = new UserStore(":memory:", "enckey");
  const owner = users.upsertByGoogle({ googleSub: "g", email: "o@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const watch = new WatchChannelStore(":memory:");
  const drive = new FakeDriveClient();
  const realtime = new Realtime();
  const svc = new WatchService({ config: { publicWebhookUrl: "https://x" }, users, workspaces, watch, driveFor: () => drive, realtime });
  return { users, owner, workspaces, watch, drive, realtime, svc };
}

async function seedWorkspace(t: ReturnType<typeof setup>, id = "w1") {
  const { fileId, revision } = await t.drive.createFile("folder", "n", "{}");
  t.workspaces.upsert({ id, name: "W", ownerUserId: t.owner.id, driveFileId: fileId, hashFolderId: "h", revision, updatedAt: 1 });
  return { fileId, revision };
}

describe("WatchService.detectAndBroadcast", () => {
  it("returns 'echo' and does not broadcast when the head revision is unchanged", async () => {
    const t = setup(); await seedWorkspace(t);
    const heard = vi.fn(); t.realtime.register("c", t.owner.id, ["w1"], heard);
    expect(await t.svc.detectAndBroadcast("w1")).toBe("echo");
    expect(heard).not.toHaveBeenCalled();
  });
  it("bumps the stored revision and broadcasts on an outside change", async () => {
    const t = setup(); const { fileId } = await seedWorkspace(t);
    await t.drive.updateFile(fileId, "{\"outside\":true}"); // Drive head revision advances behind our back
    const heard = vi.fn(); t.realtime.register("c", t.owner.id, ["w1"], heard);
    expect(await t.svc.detectAndBroadcast("w1")).toBe("broadcast");
    const newRev = await t.drive.getHeadRevision(fileId);
    expect(t.workspaces.get("w1")?.revision).toBe(newRev);
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ type: "workspace-changed", workspaceId: "w1", revision: newRev, updatedBy: "drive" }));
  });
  it("returns 'unknown' for an unknown workspace", async () => {
    const t = setup();
    expect(await t.svc.detectAndBroadcast("nope")).toBe("unknown");
  });
});

describe("WatchService.handleNotification", () => {
  it("ignores the initial sync handshake", async () => {
    const t = setup(); await seedWorkspace(t);
    expect(await t.svc.handleNotification({ channelId: "c1", token: "t1", resourceState: "sync" })).toBe("ignored");
  });
  it("rejects an unknown channel and a bad token", async () => {
    const t = setup(); await seedWorkspace(t);
    t.watch.upsert({ workspaceId: "w1", channelId: "c1", resourceId: "r1", token: "good", expiration: 9e15 });
    expect(await t.svc.handleNotification({ channelId: "missing", token: "x", resourceState: "update" })).toBe("unknown");
    expect(await t.svc.handleNotification({ channelId: "c1", token: "bad", resourceState: "update" })).toBe("unauthorized");
  });
  it("detects a change for a valid channel+token", async () => {
    const t = setup(); const { fileId } = await seedWorkspace(t);
    t.watch.upsert({ workspaceId: "w1", channelId: "c1", resourceId: "r1", token: "good", expiration: 9e15 });
    await t.drive.updateFile(fileId, "{\"z\":1}");
    expect(await t.svc.handleNotification({ channelId: "c1", token: "good", resourceState: "update" })).toBe("broadcast");
  });
});
