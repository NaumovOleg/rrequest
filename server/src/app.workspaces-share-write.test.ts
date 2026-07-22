import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { MembershipStore } from "./membership-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";
import { signSession } from "./jwt";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "c", googleClientSecret: "s", googleRedirectUri: "http://localhost:8787/auth/callback", pollIntervalMs: 60000, channelTtlSeconds: 604800 } as any;
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "c");

async function seeded() {
  const users = new UserStore(":memory:", "k");
  const owner = users.upsertByGoogle({ googleSub: "go", email: "o@x.com", refreshToken: "rt" });
  const editor = users.upsertByGoogle({ googleSub: "ge", email: "e@x.com", refreshToken: "rt2" });
  const viewer = users.upsertByGoogle({ googleSub: "gv", email: "v@x.com", refreshToken: "rt3" });
  const workspaces = new WorkspaceStore(":memory:");
  const memberships = new MembershipStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime(), memberships });
  const otok = signSession(owner.id, "j");
  await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${otok}` }, payload: { workspaceId: "w1", name: "W", snapshot: '{"v":1}' } });
  memberships.add({ workspaceId: "w1", userId: editor.id, role: "editor", permissionId: "pe" });
  memberships.add({ workspaceId: "w1", userId: viewer.id, role: "viewer", permissionId: "pv" });
  const rev = workspaces.get("w1")!.revision;
  return { app, owner, editor, viewer, rev };
}

describe("PUT /workspaces/:id role enforcement", () => {
  it("editor member can push", async () => {
    const { app, editor, rev } = await seeded();
    const res = await app.inject({ method: "PUT", url: "/workspaces/w1", headers: { authorization: `Bearer ${signSession(editor.id, "j")}` }, payload: { snapshot: '{"v":2}', baseRevision: rev } });
    expect(res.statusCode).toBe(200);
  });
  it("viewer member is forbidden from pushing", async () => {
    const { app, viewer, rev } = await seeded();
    const res = await app.inject({ method: "PUT", url: "/workspaces/w1", headers: { authorization: `Bearer ${signSession(viewer.id, "j")}` }, payload: { snapshot: '{"v":2}', baseRevision: rev } });
    expect(res.statusCode).toBe(403);
  });
});
