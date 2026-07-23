import { describe, it, expect, vi } from "vitest";
import { WatchService } from "./watch-service";
import { WorkspaceStore } from "./workspace-store";
import { UserStore } from "./user-store";
import { WatchChannelStore } from "./watch-channel-store";
import { FakeDriveClient } from "./domain/drive-client";
import { Realtime } from "./realtime";

function make(now = () => 1_000_000) {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "g", email: "o@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const watch = new WatchChannelStore(":memory:");
  const drive = new FakeDriveClient();
  const svc = new WatchService({ config: { publicWebhookUrl: "https://x", channelTtlSeconds: 604800 } as any, users, workspaces, watch, driveFor: () => drive, realtime: new Realtime(), now });
  return { users, owner, workspaces, watch, drive, svc };
}
async function seed(t: ReturnType<typeof make>, id: string) {
  const { fileId, revision } = await t.drive.createFile("f", id, "{}");
  t.workspaces.upsert({ id, name: id, ownerUserId: t.owner.id, driveFileId: fileId, hashFolderId: "h", revision, updatedAt: 1 });
  return fileId;
}

describe("WatchService.pollAll", () => {
  it("broadcasts only for workspaces whose Drive head revision changed", async () => {
    const t = make();
    const f1 = await seed(t, "w1");
    await seed(t, "w2");
    await t.drive.updateFile(f1, "{\"x\":1}"); // only w1 changed outside
    expect(await t.svc.pollAll()).toBe(1);
    expect(t.workspaces.get("w1")!.revision).toBe(await t.drive.getHeadRevision(f1));
  });
});

describe("WatchService.renewExpiring", () => {
  it("re-registers channels within the expiry window and leaves fresh ones alone", async () => {
    const t = make(() => 1_000_000);
    await seed(t, "w1");
    await seed(t, "w2");
    t.watch.upsert({ workspaceId: "w1", channelId: "old1", resourceId: "r1", token: "t1", expiration: 1_000_000 + 5_000 }); // expiring soon
    t.watch.upsert({ workspaceId: "w2", channelId: "keep2", resourceId: "r2", token: "t2", expiration: 1_000_000 + 999_999 }); // fresh
    const renewed = await t.svc.renewExpiring(10_000);
    expect(renewed).toBe(1);
    expect(t.watch.getByWorkspaceId("w1")!.channelId).not.toBe("old1"); // renewed
    expect(t.watch.getByWorkspaceId("w2")!.channelId).toBe("keep2");     // untouched
  });
});
