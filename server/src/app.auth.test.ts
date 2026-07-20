import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { UserStore } from "./user-store";
import { GoogleOAuth } from "./google-oauth";
import { PendingStates } from "./pending-states";
import { verifySession } from "./jwt";

const cfg = {
  port: 8787, dbPath: ":memory:", jwtSecret: "j", tokenEncKey: "k",
  googleClientId: "cid", googleClientSecret: "sec", googleRedirectUri: "http://localhost:8787/auth/callback",
};
function makeGoogle() {
  return new GoogleOAuth({
    generateAuthUrl: (o: any) => `https://accounts.google.com/o/oauth2/v2/auth?state=${o.state}`,
    getToken: async () => ({ tokens: { id_token: "i", refresh_token: "rt" } }),
    verifyIdToken: async () => ({ getPayload: () => ({ sub: "g-sub", email: "a@x.com" }) }),
  } as any, "cid");
}
function make() {
  const states = new PendingStates();
  const users = new UserStore(":memory:", "k");
  const app = buildApp({ config: cfg, users, google: makeGoogle(), states });
  return { app, states, users };
}

describe("auth routes", () => {
  it("/auth/start redirects to Google and stores the callback", async () => {
    const { app, states } = make();
    const res = await app.inject({ method: "GET", url: "/auth/start?cb=http%3A%2F%2Flocalhost%3A5000" });
    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc).toContain("accounts.google.com");
    const state = new URL(loc).searchParams.get("state")!;
    expect(states.take(state)).toBe("http://localhost:5000");
  });

  it("/auth/start returns 400 without cb", async () => {
    const { app } = make();
    const res = await app.inject({ method: "GET", url: "/auth/start" });
    expect(res.statusCode).toBe(400);
  });

  it("/auth/start rejects a non-loopback cb", async () => {
    const { app } = make();
    const res = await app.inject({ method: "GET", url: "/auth/start?cb=https%3A%2F%2Fevil.com%2Fcatch" });
    expect(res.statusCode).toBe(400);
  });

  it("/auth/callback exchanges the code, upserts a user, and redirects with a JWT", async () => {
    const { app, states, users } = make();
    states.put("state-1", "http://localhost:5000");
    const res = await app.inject({ method: "GET", url: "/auth/callback?code=abc&state=state-1" });
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.origin + loc.pathname).toBe("http://localhost:5000/");
    const token = loc.searchParams.get("token")!;
    const session = verifySession(token, "j")!;
    expect(users.getById(session.userId)?.email).toBe("a@x.com");
  });

  it("/auth/callback returns 400 for an unknown state", async () => {
    const { app } = make();
    const res = await app.inject({ method: "GET", url: "/auth/callback?code=abc&state=nope" });
    expect(res.statusCode).toBe(400);
  });

  it("/auth/callback returns 400 when the code exchange fails", async () => {
    const states = new PendingStates();
    const users = new UserStore(":memory:", "k");
    const google = new GoogleOAuth({
      generateAuthUrl: (o: any) => `https://g/?state=${o.state}`,
      getToken: async () => { throw new Error("bad code"); },
      verifyIdToken: async () => ({ getPayload: () => ({}) }),
    } as any, "cid");
    const app = buildApp({ config: cfg, users, google, states });
    states.put("state-x", "http://localhost:5000");
    const res = await app.inject({ method: "GET", url: "/auth/callback?code=bad&state=state-x" });
    expect(res.statusCode).toBe(400);
  });
});
