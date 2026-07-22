import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { WatchChannelStore } from "./watch-channel-store";
import { WatchService } from "./watch-service";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";
import { signSession } from "./jwt";

const cfg = {
  port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k",
  googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback",
  pollIntervalMs: 60000, channelTtlSeconds: 604800,
};
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "cid");

function make() {
  const users = new UserStore(":memory:", "k");
  const user = users.upsertByGoogle({ googleSub: "g", email: "a@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime() });
  return { app, user, users, workspaces, drive, token: signSession(user.id, "j") };
}

describe("POST /workspaces", () => {
  it("creates the Drive file, stores a row, returns driveFileId + revision", async () => {
    const { app, user, workspaces, token } = make();
    const res = await app.inject({
      method: "POST", url: "/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId: "ws1", name: "Team", snapshot: '{"version":1}' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.driveFileId).toBeTruthy();
    expect(body.revision).toBe("1");
    const row = workspaces.get("ws1")!;
    expect(row.ownerUserId).toBe(user.id);
    expect(row.driveFileId).toBe(body.driveFileId);
  });
  it("401 without a token", async () => {
    const { app } = make();
    const res = await app.inject({ method: "POST", url: "/workspaces", payload: { workspaceId: "ws1", name: "T", snapshot: "{}" } });
    expect(res.statusCode).toBe(401);
  });

  it("403 when a different user posts an existing workspaceId", async () => {
    const { app, users, token } = make();
    const create = await app.inject({
      method: "POST", url: "/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId: "ws1", name: "Team", snapshot: '{"version":1}' },
    });
    expect(create.statusCode).toBe(201);

    const userB = users.upsertByGoogle({ googleSub: "g2", email: "b@x.com", refreshToken: "rt2" });
    const tokenB = signSession(userB.id, "j");
    const res = await app.inject({
      method: "POST", url: "/workspaces",
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { workspaceId: "ws1", name: "Team", snapshot: '{"version":1}' },
    });
    expect(res.statusCode).toBe(403);
  });

  it("re-enabling (same owner, same workspaceId) reuses the same driveFileId", async () => {
    const { app, token } = make();
    const res1 = await app.inject({
      method: "POST", url: "/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId: "ws1", name: "Team", snapshot: '{"version":1}' },
    });
    expect(res1.statusCode).toBe(201);
    const body1 = res1.json();

    const res2 = await app.inject({
      method: "POST", url: "/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId: "ws1", name: "Team", snapshot: '{"version":2}' },
    });
    expect(res2.statusCode).toBe(201);
    const body2 = res2.json();

    expect(body2.driveFileId).toBe(body1.driveFileId);
  });

  it("strips secret variable values server-side before storing the snapshot", async () => {
    const { app, token } = make();
    const snapshot = JSON.stringify({
      environments: [{ variables: [{ key: "TOKEN", secret: true, value: "sekret" }, { key: "PLAIN", secret: false, value: "visible" }] }],
    });
    const create = await app.inject({
      method: "POST", url: "/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId: "ws1", name: "Team", snapshot },
    });
    expect(create.statusCode).toBe(201);

    const get = await app.inject({
      method: "GET", url: "/workspaces/ws1",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(get.statusCode).toBe(200);
    const stored = JSON.parse(get.json().snapshot);
    expect(stored.environments[0].variables[0].value).toBe("");
    expect(stored.environments[0].variables[1].value).toBe("visible");
  });

  it("registers a watch channel when a watchService is configured", async () => {
    const users = new UserStore(":memory:", "k");
    const user = users.upsertByGoogle({ googleSub: "g", email: "a@x.com", refreshToken: "rt" });
    const workspaces = new WorkspaceStore(":memory:");
    const watch = new WatchChannelStore(":memory:");
    const drive = new FakeDriveClient();
    const watchService = new WatchService({
      config: { publicWebhookUrl: "https://x", channelTtlSeconds: 604800 },
      users, workspaces, watch, driveFor: () => drive, realtime: new Realtime(),
    });
    const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime(), watchService });
    const token = signSession(user.id, "j");

    const res = await app.inject({
      method: "POST", url: "/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId: "ws1", name: "Team", snapshot: '{"version":1}' },
    });
    expect(res.statusCode).toBe(201);
    expect(watch.getByWorkspaceId("ws1")).toBeDefined();
  });
});
