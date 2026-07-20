import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { signSession } from "./jwt";
import { WorkspaceStore } from "./workspace-store";
import { FakeDriveClient } from "./drive-client";

const cfg = {
  port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k",
  googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback",
};
const google = new GoogleOAuth({
  generateAuthUrl: () => "https://g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }),
} as any, "cid");

describe("GET /me", () => {
  it("returns the user for a valid token", async () => {
    const users = new UserStore(":memory:", "k");
    const u = users.upsertByGoogle({ googleSub: "g", email: "a@x.com", refreshToken: "rt" });
    const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces: new WorkspaceStore(":memory:"), driveFor: () => new FakeDriveClient() });
    const res = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${signSession(u.id, "j")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: u.id, email: "a@x.com" });
  });
  it("401 without a token", async () => {
    const app = buildApp({ config: cfg, users: new UserStore(":memory:", "k"), google, states: new PendingStates(), workspaces: new WorkspaceStore(":memory:"), driveFor: () => new FakeDriveClient() });
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
  });
  it("401 for a valid token whose user no longer exists", async () => {
    const app = buildApp({ config: cfg, users: new UserStore(":memory:", "k"), google, states: new PendingStates(), workspaces: new WorkspaceStore(":memory:"), driveFor: () => new FakeDriveClient() });
    const res = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${signSession("ghost", "j")}` } });
    expect(res.statusCode).toBe(401);
  });
});
