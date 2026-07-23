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

describe("GET /workspaces owned + shared", () => {
  it("returns owned (role owner) and shared (membership role) workspaces", async () => {
    const users = new UserStore(":memory:", "k");
    const owner = users.upsertByGoogle({ googleSub: "go", email: "o@x.com", refreshToken: "rt" });
    const me = users.upsertByGoogle({ googleSub: "gm", email: "m@x.com", refreshToken: "rt2" });
    const workspaces = new WorkspaceStore(":memory:");
    const memberships = new MembershipStore(":memory:");
    const drive = new FakeDriveClient();
    const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive, realtime: new Realtime(), memberships });
    // me owns wo; owner owns ws, shares ws with me as editor
    await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${signSession(me.id, "j")}` }, payload: { workspaceId: "wo", name: "Mine", snapshot: "{}" } });
    await app.inject({ method: "POST", url: "/workspaces", headers: { authorization: `Bearer ${signSession(owner.id, "j")}` }, payload: { workspaceId: "ws", name: "Shared", snapshot: "{}" } });
    memberships.add({ workspaceId: "ws", userId: me.id, role: "editor", permissionId: "p" });
    const res = await app.inject({ method: "GET", url: "/workspaces", headers: { authorization: `Bearer ${signSession(me.id, "j")}` } });
    expect(res.statusCode).toBe(200);
    const byId = Object.fromEntries((res.json() as any[]).map((w) => [w.id, w.role]));
    expect(byId).toEqual({ wo: "owner", ws: "editor" });
  });
});
