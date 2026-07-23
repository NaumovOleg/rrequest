import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { MembershipStore } from "./membership-store";
import { GoogleOAuth } from "./domain/google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./domain/drive-client";
import { Realtime } from "./realtime";
import { signSession } from "./domain/jwt";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "c", googleClientSecret: "s", googleRedirectUri: "http://localhost:8787/auth/callback", pollIntervalMs: 60000, channelTtlSeconds: 604800 } as any;
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "c");

async function seeded() {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "go", email: "o@x.com", refreshToken: "rt" });
  const viewer = users.upsertByGoogle({ googleSub: "gv", email: "v@x.com", refreshToken: "rt2" });
  const stranger = users.upsertByGoogle({ googleSub: "gs", email: "s@x.com", refreshToken: "rt3" });
  const workspaces = new WorkspaceStore(":memory:");
  const memberships = new MembershipStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime(), memberships });
  const tok = signSession(owner.id, "j");
  await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${tok}` }, payload: { workspaceId: "w1", name: "W", snapshot: '{"v":1}' } });
  memberships.add({ workspaceId: "w1", userId: viewer.id, role: "viewer", permissionId: "p" });
  return { app, owner, viewer, stranger };
}

describe("GET /workspaces/:id with roles", () => {
  it("owner reads with role=owner", async () => {
    const { app, owner } = await seeded();
    const res = await app.inject({ method: "GET", url: "/workspaces/w1", headers: { authorization: `Bearer ${signSession(owner.id, "j")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ snapshot: '{"v":1}', role: "owner" });
  });
  it("viewer member reads with role=viewer", async () => {
    const { app, viewer } = await seeded();
    const res = await app.inject({ method: "GET", url: "/workspaces/w1", headers: { authorization: `Bearer ${signSession(viewer.id, "j")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("viewer");
  });
  it("a non-member is forbidden", async () => {
    const { app, stranger } = await seeded();
    const res = await app.inject({ method: "GET", url: "/workspaces/w1", headers: { authorization: `Bearer ${signSession(stranger.id, "j")}` } });
    expect(res.statusCode).toBe(403);
  });
});
