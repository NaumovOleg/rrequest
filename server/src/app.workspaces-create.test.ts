import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { WorkspaceStore } from "./workspace-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { FakeDriveClient } from "./drive-client";
import { signSession } from "./jwt";

const cfg = {
  port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k",
  googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback",
};
const google = new GoogleOAuth({ generateAuthUrl: () => "g", getToken: async () => ({ tokens: {} }), verifyIdToken: async () => ({ getPayload: () => ({}) }) } as any, "cid");

function make() {
  const users = new UserStore(":memory:", "k");
  const user = users.upsertByGoogle({ googleSub: "g", email: "a@x.com", refreshToken: "rt" });
  const workspaces = new WorkspaceStore(":memory:");
  const drive = new FakeDriveClient();
  const app = buildApp({ config: cfg, users, google, states: new PendingStates(), workspaces, driveFor: () => drive });
  return { app, user, workspaces, token: signSession(user.id, "j") };
}

describe("POST /workspaces", () => {
  it("creates the Drive file, stores a row, returns driveFileId + revision", async () => {
    const { app, user, workspaces, token } = make();
    const res = await app.inject({
      method: "POST", url: "/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId: "ws1", name: "Team", snapshot: '{"version":1}' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.driveFileId).toBeTruthy();
    expect(body.revision).toBe("1");
    const row = workspaces.get("ws1")!;
    expect(row.ownerUserId).toBe(user.id);
    expect(row.driveFileId).toBe(body.driveFileId);
  });
  it("401 without a token", async () => {
    const { app } = make();
    const res = await app.inject({ method: "POST", url: "/workspaces", payload: { workspaceId: "ws1", name: "T", snapshot: "{}" } });
    expect(res.statusCode).toBe(401);
  });
});
