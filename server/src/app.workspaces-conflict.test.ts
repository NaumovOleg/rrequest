import { describe, it, expect, vi } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";
import { signSession } from "./jwt";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback", pollIntervalMs: 60000, channelTtlSeconds: 604800 };
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "cid");

async function seeded() {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "g", email: "o@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const drive = new FakeDriveClient();
  const realtime = new Realtime();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime });
  const token = signSession(owner.id, "j");
  await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${token}` }, payload: { workspaceId: "ws1", name: "T", snapshot: '{"v":1}' } });
  return { app, token, workspaces, realtime };
}

describe("PUT /workspaces/:id revision guard", () => {
  it("writes and bumps when baseRevision matches, and broadcasts", async () => {
    const { app, token, workspaces, realtime } = await seeded();
    const heard = vi.fn();
    realtime.register("other", "u2", ["ws1"], heard);
    const res = await app.inject({ method: "PUT", url: "/workspaces/ws1", headers: { authorization: `Bearer ${token}` }, payload: { snapshot: '{"v":2}', baseRevision: "1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().revision).toBe("2");
    expect(workspaces.get("ws1")?.revision).toBe("2");
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ type: "workspace-changed", workspaceId: "ws1", revision: "2" }));
  });
  it("409s with the current snapshot + revision when baseRevision is stale", async () => {
    const { app, token } = await seeded();
    // first push moves revision 1 -> 2
    await app.inject({ method: "PUT", url: "/workspaces/ws1", headers: { authorization: `Bearer ${token}` }, payload: { snapshot: '{"v":2}', baseRevision: "1" } });
    // second push with the now-stale base "1"
    const res = await app.inject({ method: "PUT", url: "/workspaces/ws1", headers: { authorization: `Bearer ${token}` }, payload: { snapshot: '{"v":3}', baseRevision: "1" } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ snapshot: '{"v":2}', revision: "2" });
  });
});
