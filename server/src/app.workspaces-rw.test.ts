import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { GoogleOAuth } from "./domain/google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./domain/drive-client";
import { Realtime } from "./realtime";
import { MembershipStore } from "./membership-store";
import { signSession } from "./domain/jwt";

const cfg = {
  port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k",
  googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback",
  pollIntervalMs: 60000, channelTtlSeconds: 604800,
};
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "cid");

async function seeded() {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "g1", email: "o@x.com", refreshToken: "rt" });
  const other = users.upsertByGoogle({ googleSub: "g2", email: "b@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime(), memberships: new MembershipStore(":memory:") });
  const tokenOwner = signSession(owner.id, "j");
  await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${tokenOwner}` }, payload: { workspaceId: "ws1", name: "Team", snapshot: '{"v":1}' } });
  return { app, workspaces, tokenOwner, tokenOther: signSession(other.id, "j") };
}

describe("workspace read/write", () => {
  it("GET /workspaces lists the owner's workspaces", async () => {
    const { app, tokenOwner } = await seeded();
    const res = await app.inject({ method: "GET", url: "/workspaces", headers: { authorization: `Bearer ${tokenOwner}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((w: any) => w.id)).toEqual(["ws1"]);
  });
  it("PUT pushes a new snapshot and bumps the revision", async () => {
    const { app, tokenOwner, workspaces } = await seeded();
    const res = await app.inject({ method: "PUT", url: "/workspaces/ws1", headers: { authorization: `Bearer ${tokenOwner}` }, payload: { snapshot: '{"v":2}', baseRevision: "1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().revision).toBe("2");
    expect(workspaces.get("ws1")?.revision).toBe("2");
  });
  it("GET /workspaces/:id pulls the current snapshot", async () => {
    const { app, tokenOwner } = await seeded();
    await app.inject({ method: "PUT", url: "/workspaces/ws1", headers: { authorization: `Bearer ${tokenOwner}` }, payload: { snapshot: '{"v":2}', baseRevision: "1" } });
    const res = await app.inject({ method: "GET", url: "/workspaces/ws1", headers: { authorization: `Bearer ${tokenOwner}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ snapshot: '{"v":2}', revision: "2", role: "owner" });
  });
  it("403 when a non-owner tries to push", async () => {
    const { app, tokenOther } = await seeded();
    const res = await app.inject({ method: "PUT", url: "/workspaces/ws1", headers: { authorization: `Bearer ${tokenOther}` }, payload: { snapshot: "{}" } });
    expect(res.statusCode).toBe(403);
  });
  it("404 for an unknown workspace", async () => {
    const { app, tokenOwner } = await seeded();
    const res = await app.inject({ method: "GET", url: "/workspaces/nope", headers: { authorization: `Bearer ${tokenOwner}` } });
    expect(res.statusCode).toBe(404);
  });
});
