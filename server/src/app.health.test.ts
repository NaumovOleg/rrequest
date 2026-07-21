import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { WorkspaceStore } from "./workspace-store";
import { FakeDriveClient } from "./drive-client";
import { Realtime } from "./realtime";

const cfg = {
  port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k",
  googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback",
};
const fakeGoogle = new GoogleOAuth({
  generateAuthUrl: (o: any) => `https://g/?state=${o.state}`,
  getToken: async () => ({ tokens: { id_token: "i", refresh_token: "rt" } }),
  verifyIdToken: async () => ({ getPayload: () => ({ sub: "g", email: "a@x.com" }) }),
} as any, "cid");

function app() {
  return buildApp({ config: cfg, users: new UserStore(":memory:", "k"), google: fakeGoogle, states: new PendingStates(), workspaces: new WorkspaceStore(":memory:"), driveFor: () => new FakeDriveClient(), realtime: new Realtime() });
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app().inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
