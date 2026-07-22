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
  const existing = users.upsertByGoogle({ googleSub: "ge", email: "e@x.com", refreshToken: "rt2" });
  const stranger = users.upsertByGoogle({ googleSub: "gs", email: "s@x.com", refreshToken: "rt3" });
  const workspaces = new WorkspaceStore(":memory:");
  const memberships = new MembershipStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime(), memberships });
  await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${signSession(owner.id, "j")}` }, payload: { workspaceId: "w1", name: "W", snapshot: "{}" } });
  const fileId = workspaces.get("w1")!.driveFileId;
  return { app, owner, existing, stranger, memberships, drive, fileId };
}

describe("POST /workspaces/:id/members", () => {
  it("owner adds an existing-account member: Drive permission + resolved membership", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "POST", url: "/workspaces/w1/members", headers: { authorization: `Bearer ${signSession(t.owner.id, "j")}` }, payload: { email: "e@x.com", role: "editor" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: "e@x.com", role: "editor", pending: false });
    expect(t.drive.permissions(t.fileId)).toEqual([{ permissionId: expect.any(String), email: "e@x.com", role: "writer" }]);
    expect(t.memberships.listByWorkspace("w1")[0]).toMatchObject({ userId: t.existing.id, role: "editor" });
  });
  it("owner adds an unknown email: pending membership, reader permission for viewer", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "POST", url: "/workspaces/w1/members", headers: { authorization: `Bearer ${signSession(t.owner.id, "j")}` }, payload: { email: "new@x.com", role: "viewer" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: "new@x.com", role: "viewer", pending: true });
    expect(t.drive.permissions(t.fileId)[0]).toMatchObject({ email: "new@x.com", role: "reader" });
    expect(t.memberships.listByWorkspace("w1")[0]).toMatchObject({ pendingEmail: "new@x.com", role: "viewer" });
  });
  it("a non-owner cannot add members", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "POST", url: "/workspaces/w1/members", headers: { authorization: `Bearer ${signSession(t.stranger.id, "j")}` }, payload: { email: "e@x.com", role: "editor" } });
    expect(res.statusCode).toBe(403);
  });
  it("rejects an invalid role", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "POST", url: "/workspaces/w1/members", headers: { authorization: `Bearer ${signSession(t.owner.id, "j")}` }, payload: { email: "e@x.com", role: "owner" } });
    expect(res.statusCode).toBe(400);
  });
  it("re-inviting the same email updates the existing membership in place instead of duplicating it", async () => {
    const t = await seeded();
    const first = await t.app.inject({ method: "POST", url: "/workspaces/w1/members", headers: { authorization: `Bearer ${signSession(t.owner.id, "j")}` }, payload: { email: "e@x.com", role: "editor" } });
    expect(first.statusCode).toBe(201);

    const second = await t.app.inject({ method: "POST", url: "/workspaces/w1/members", headers: { authorization: `Bearer ${signSession(t.owner.id, "j")}` }, payload: { email: "e@x.com", role: "viewer" } });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ role: "viewer" });

    expect(t.memberships.listByWorkspace("w1")).toHaveLength(1);
    expect(t.memberships.roleForUser("w1", t.existing.id)).toBe("viewer");

    const perms = t.drive.permissions(t.fileId).filter((p) => p.email === "e@x.com");
    expect(perms).toHaveLength(1);
    expect(perms[0]).toMatchObject({ email: "e@x.com", role: "reader" });
  });
});
