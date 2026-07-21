import { describe, it, expect, vi } from "vitest";
import { subscriptionsFor, handleWsConnection } from "./ws-server";
import { WorkspaceStore } from "./workspace-store";
import { Realtime } from "./realtime";
import { signSession } from "./jwt";

describe("subscriptionsFor", () => {
  it("returns the workspace ids owned by the user", () => {
    const ws = new WorkspaceStore(":memory:");
    ws.upsert({ id: "a", name: "A", ownerUserId: "u1", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    ws.upsert({ id: "b", name: "B", ownerUserId: "u2", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    ws.upsert({ id: "c", name: "C", ownerUserId: "u1", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    expect(subscriptionsFor("u1", ws).sort()).toEqual(["a", "c"]);
  });
});

describe("handleWsConnection", () => {
  const jwtSecret = "test-secret";

  function fakeSocket() {
    return { close: vi.fn(), on: vi.fn(), send: vi.fn() };
  }

  it("closes with 4001 and never registers when the token is invalid/absent", () => {
    const workspaces = new WorkspaceStore(":memory:");
    const realtime = new Realtime();
    const registerSpy = vi.spyOn(realtime, "register");
    const socket = fakeSocket();

    handleWsConnection(socket, "/ws?token=not-a-real-token", { jwtSecret, workspaces, realtime });

    expect(socket.close).toHaveBeenCalledWith(4001, "unauthorized");
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it("registers the connection with the user's owned workspaces when the token is valid", () => {
    const workspaces = new WorkspaceStore(":memory:");
    workspaces.upsert({ id: "a", name: "A", ownerUserId: "u1", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    workspaces.upsert({ id: "b", name: "B", ownerUserId: "u2", driveFileId: "f", hashFolderId: "h", revision: "1", updatedAt: 1 });
    const realtime = new Realtime();
    const registerSpy = vi.spyOn(realtime, "register");
    const socket = fakeSocket();
    const token = signSession("u1", jwtSecret);

    handleWsConnection(socket, `/ws?token=${token}`, { jwtSecret, workspaces, realtime });

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0][1]).toBe("u1");
    expect(registerSpy.mock.calls[0][2]).toEqual(["a"]);
    expect(socket.close).not.toHaveBeenCalled();
  });
});
