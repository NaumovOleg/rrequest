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
  const editor = users.upsertByGoogle({ googleSub: "ge", email: "e@x.com", refreshToken: "rt2" });
  const workspaces = new WorkspaceStore(":memory:");
  const memberships = new MembershipStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime(), memberships });
  await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${signSession(owner.id, "j")}` }, payload: { workspaceId: "w1", name: "W", snapshot: "{}" } });
  const fileId = workspaces.get("w1")!.driveFileId;
  const perm = await drive.createPermission(fileId, { email: "e@x.com", role: "writer" });
  const m = memberships.add({ workspaceId: "w1", userId: editor.id, role: "editor", permissionId: perm.permissionId });
  return { app, owner, editor, memberships, drive, fileId, membershipId: m.id };
}

describe("GET /workspaces/:id/members", () => {
  it("lists owner first then members", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "GET", url: "/workspaces/w1/members", headers: { authorization: `Bearer ${signSession(t.owner.id, "j")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().members).toEqual([
      { email: "o@x.com", role: "owner", pending: false },
      { id: t.membershipId, email: "e@x.com", role: "editor", pending: false },
    ]);
  });
});

describe("DELETE /workspaces/:id/members/:memberId", () => {
  it("owner removes a member (drive permission + row)", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "DELETE", url: `/workspaces/w1/members/${t.membershipId}`, headers: { authorization: `Bearer ${signSession(t.owner.id, "j")}` } });
    expect(res.statusCode).toBe(200);
    expect(t.memberships.getById(t.membershipId)).toBeUndefined();
    expect(t.drive.permissions(t.fileId)).toEqual([]);
  });
  it("a non-owner cannot remove members", async () => {
    const t = await seeded();
    const res = await t.app.inject({ method: "DELETE", url: `/workspaces/w1/members/${t.membershipId}`, headers: { authorization: `Bearer ${signSession(t.editor.id, "j")}` } });
    expect(res.statusCode).toBe(403);
    expect(t.memberships.getById(t.membershipId)).toBeDefined();
  });
});
