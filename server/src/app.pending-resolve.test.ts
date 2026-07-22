import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { MembershipStore } from "./membership-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";

const cfg = { port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k", googleClientId: "c", googleClientSecret: "s", googleRedirectUri: "http://localhost:8787/auth/callback", pollIntervalMs: 60000, channelTtlSeconds: 604800 } as any;

describe("/auth/callback resolves pending memberships", () => {
  it("links a pending_email membership to the new user id on first sign-in", async () => {
    const users = new UserStore(":memory:", "k");
    const memberships = new MembershipStore(":memory:");
    memberships.add({ workspaceId: "w1", pendingEmail: "invitee@x.com", role: "editor", permissionId: "p" });
    // GoogleOAuth stub whose exchange returns the invitee's profile
    const google = { authUrl: (state: string) => `http://g/?state=${state}`, exchange: async () => ({ googleSub: "gi", email: "invitee@x.com", refreshToken: "rt" }) } as any;
    const states = new PendingStates();
    const app = buildApp({ config: cfg, users, google, states, workspaces: new WorkspaceStore(":memory:"), driveFor: () => new FakeDriveClient(), realtime: new Realtime(), memberships });
    // seed a valid state so /auth/callback accepts the cb
    const start = await app.inject({ method: "GET", url: "/auth/start?cb=http://localhost:5000" });
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    const res = await app.inject({ method: "GET", url: `/auth/callback?code=x&state=${state}` });
    expect(res.statusCode).toBe(302);
    const u = users.getByEmail("invitee@x.com")!;
    expect(memberships.roleForUser("w1", u.id)).toBe("editor");
  });
});
