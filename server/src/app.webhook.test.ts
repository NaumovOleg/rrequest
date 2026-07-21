import { describe, it, expect, vi } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { WatchChannelStore } from "./watch-channel-store";
import { WatchService } from "./watch-service";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback", publicWebhookUrl: "https://x", pollIntervalMs: 60000, channelTtlSeconds: 604800 } as any;
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "cid");

describe("POST /webhook", () => {
  it("passes Google notification headers to the WatchService and always returns 200", async () => {
    const users = new UserStore(":memory:", "k");
    const workspaces = new WorkspaceStore(":memory:");
    const watch = new WatchChannelStore(":memory:");
    const drive = new FakeDriveClient();
    const realtime = new Realtime();
    const watchService = new WatchService({ config: cfg, users, workspaces, watch, driveFor: () => drive, realtime });
    const spy = vi.spyOn(watchService, "handleNotification");
    const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime, watchService });
    const res = await app.inject({ method: "POST", url: "/webhook", headers: {
      "x-goog-channel-id": "c1", "x-goog-channel-token": "t1", "x-goog-resource-state": "update",
    }, payload: "" });
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith({ channelId: "c1", token: "t1", resourceState: "update" });
  });
  it("returns 200 even when no watchService is configured", async () => {
    const app = buildApp({ config: cfg, users: new UserStore(":memory:", "k"), google, states: new PendingStates(), workspaces: new WorkspaceStore(":memory:"), driveFor: () => new FakeDriveClient(), realtime: new Realtime() });
    const res = await app.inject({ method: "POST", url: "/webhook", headers: { "x-goog-resource-state": "update" }, payload: "" });
    expect(res.statusCode).toBe(200);
  });
});
