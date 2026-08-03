import { describe, it, expect } from "vitest";
import { PollService } from "../../../server/src/services/poll-service.js";
import { MemoryWorkspaceStore } from "../../../server/src/stores/memory/workspace-store.js";
import { MemoryUserStore } from "../../../server/src/stores/memory/user-store.js";
import { FakeDriveClient } from "../../../server/src/domain/drive-client.js";
import type { User } from "../../../server/src/stores/types.js";

function makeService() {
  const workspaces = new MemoryWorkspaceStore();
  const users = new MemoryUserStore();
  const drive = new FakeDriveClient();
  const driveFor = () => drive;
  const service = new PollService({ workspaces, users, driveFor });
  return { service, workspaces, users, drive };
}

async function makeUser(users: MemoryUserStore, email: string): Promise<User> {
  return users.upsertByGoogle({ googleSub: `sub-${email}`, email, refreshToken: `rt-${email}` });
}

describe("PollService.pollAll", () => {
  it("bumps only the workspace whose Drive file changed outside the app", async () => {
    const { service, workspaces, users, drive } = makeService();
    const owner = await makeUser(users, "owner@x.com");

    const created1 = await drive.createFile("folder", "a.json", "{}");
    await workspaces.upsert({
      id: "w1",
      name: "WS1",
      ownerUserId: owner.id,
      driveFileId: created1.fileId,
      hashFolderId: "folder",
      revision: created1.revision,
      updatedAt: Date.now(),
    });

    const created2 = await drive.createFile("folder", "b.json", "{}");
    await workspaces.upsert({
      id: "w2",
      name: "WS2",
      ownerUserId: owner.id,
      driveFileId: created2.fileId,
      hashFolderId: "folder",
      revision: created2.revision,
      updatedAt: Date.now(),
    });

    // Simulate an outside edit to w1's Drive file only (bumps its head revision).
    await drive.updateFile(created1.fileId, '{"edited":true}');
    const newHead = await drive.getHeadRevision(created1.fileId);
    expect(newHead).not.toBe(created1.revision);

    const bumped = await service.pollAll();

    expect(bumped).toBe(1);
    const ws1 = await workspaces.get("w1");
    const ws2 = await workspaces.get("w2");
    expect(ws1!.revision).toBe(newHead);
    expect(ws2!.revision).toBe(created2.revision);
  });

  it("skips a workspace whose owner user is missing, without throwing", async () => {
    const { service, workspaces } = makeService();
    await workspaces.upsert({
      id: "ghost-ws",
      name: "Ghost",
      ownerUserId: "no-such-user",
      driveFileId: "file-x",
      hashFolderId: "folder",
      revision: "1",
      updatedAt: Date.now(),
    });

    await expect(service.pollAll()).resolves.toBe(0);
    const ws = await workspaces.get("ghost-ws");
    expect(ws!.revision).toBe("1");
  });
});
