import { describe, it, expect } from "vitest";
import { WorkspaceService } from "./workspace-service.js";
import { MemoryWorkspaceStore } from "../stores/memory/workspace-store.js";
import { MemoryUserStore } from "../stores/memory/user-store.js";
import { MemoryMembershipStore } from "../stores/memory/membership-store.js";
import { FakeDriveClient, type DriveClient, type WatchOpts, type WatchInfo } from "../domain/drive-client.js";
import { DriveAuthError } from "../domain/drive-factory.js";
import type { User } from "../stores/types.js";

// A DriveClient whose calls all fail as if the user's Google refresh token
// was revoked/expired -- what `makeDriveFactory`'s `getAccessToken` closure
// throws once `oauth.getAccessToken()` fails.
class AuthFailDriveClient implements DriveClient {
  async ensureFolder(): Promise<string> {
    throw new DriveAuthError();
  }
  async createFile(): Promise<{ fileId: string; revision: string }> {
    throw new DriveAuthError();
  }
  async updateFile(): Promise<{ revision: string }> {
    throw new DriveAuthError();
  }
  async readFile(): Promise<string> {
    throw new DriveAuthError();
  }
  async getHeadRevision(): Promise<string> {
    throw new DriveAuthError();
  }
  async watchFile(_fileId: string, _opts: WatchOpts): Promise<WatchInfo> {
    throw new DriveAuthError();
  }
  async stopChannel(): Promise<void> {
    throw new DriveAuthError();
  }
  async createPermission(): Promise<{ permissionId: string }> {
    throw new DriveAuthError();
  }
  async deletePermission(): Promise<void> {
    throw new DriveAuthError();
  }
}

function makeService() {
  const workspaces = new MemoryWorkspaceStore();
  const users = new MemoryUserStore();
  const memberships = new MemoryMembershipStore();
  const goodDrive = new FakeDriveClient();
  let activeDrive: DriveClient = goodDrive;
  const driveFor = () => activeDrive;
  const service = new WorkspaceService({ workspaces, memberships, users, driveFor });
  return {
    service,
    workspaces,
    users,
    memberships,
    goodDrive,
    // Flip the drive returned by `driveFor` to one that always throws
    // DriveAuthError, simulating a revoked refresh token discovered on the
    // next Drive call.
    revokeDrive: () => {
      activeDrive = new AuthFailDriveClient();
    },
  };
}

async function makeUser(users: MemoryUserStore, email: string): Promise<User> {
  return users.upsertByGoogle({ googleSub: `sub-${email}`, email, refreshToken: `rt-${email}` });
}

describe("WorkspaceService re-auth (revoked Google refresh token)", () => {
  it("pull returns { status: 401 } (not a thrown error / 500) when Drive auth fails, and leaves the store untouched", async () => {
    const { service, users, workspaces, revokeDrive } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: '{"x":1}' });
    const before = await workspaces.get("w1");

    revokeDrive();
    const result = await service.pull(owner, "w1");

    expect(result).toEqual({ status: 401 });
    expect(await workspaces.get("w1")).toEqual(before);
  });

  it("push returns { status: 401 } (not a thrown error / 500) when Drive auth fails, and does not bump the revision", async () => {
    const { service, users, workspaces, revokeDrive } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });
    const before = await workspaces.get("w1");

    revokeDrive();
    const result = await service.push(owner, "w1", { snapshot: '{"a":1}', baseRevision: "1" });

    expect(result).toEqual({ status: 401 });
    expect(await workspaces.get("w1")).toEqual(before);
  });

  it("push still 409s on a stale baseRevision without needing Drive access (checked before the drive call that can fail)", async () => {
    // Guards the ordering requirement: the read-current-snapshot-on-conflict
    // path also goes through drive.readFile, so it too should surface 401
    // rather than 500/throw when auth fails.
    const { service, users, revokeDrive } = makeService();
    const owner = await makeUser(users, "owner@x.com");
    await service.enable(owner, { workspaceId: "w1", name: "WS", snapshot: "{}" });

    revokeDrive();
    const result = await service.push(owner, "w1", { snapshot: '{"a":1}', baseRevision: "stale" });

    expect(result).toEqual({ status: 401 });
  });
});
