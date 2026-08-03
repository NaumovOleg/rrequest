import { describe, it, expect, vi } from "vitest";
import { AuthService, signState, verifyState, isLoopbackCb } from "../../../server/src/services/auth-service.js";
import { MemoryUserStore } from "../../../server/src/stores/memory/user-store.js";
import { MemoryMembershipStore } from "../../../server/src/stores/memory/membership-store.js";
import type { GoogleOAuth, GoogleProfile } from "../../../server/src/domain/google-oauth.js";
import { verifySession } from "../../../server/src/domain/jwt.js";

const JWT_SECRET = "test-jwt-secret";
const STATE_SECRET = "test-state-secret";

function makeGoogle(profile: GoogleProfile): GoogleOAuth {
  return {
    authUrl: (state: string) => `https://accounts.google.com/o/oauth2/auth?state=${state}`,
    exchange: async (_code: string) => profile,
  } as unknown as GoogleOAuth;
}

function makeService(opts?: { profile?: GoogleProfile; google?: GoogleOAuth }) {
  const users = new MemoryUserStore();
  const memberships = new MemoryMembershipStore();
  const profile: GoogleProfile = opts?.profile ?? { googleSub: "sub-1", email: "alice@example.com", refreshToken: "rt-1" };
  const google = opts?.google ?? makeGoogle(profile);
  const service = new AuthService({
    users,
    memberships,
    google,
    config: { jwtSecret: JWT_SECRET, stateSecret: STATE_SECRET },
  });
  return { service, users, memberships, profile, google };
}

describe("isLoopbackCb", () => {
  it("accepts http localhost / 127.0.0.1 / [::1]", () => {
    expect(isLoopbackCb("http://localhost:1234/cb")).toBe(true);
    expect(isLoopbackCb("http://127.0.0.1:1234/cb")).toBe(true);
    expect(isLoopbackCb("http://[::1]:1234/cb")).toBe(true);
  });

  it("rejects non-loopback and non-http urls", () => {
    expect(isLoopbackCb("https://localhost:1234/cb")).toBe(false);
    expect(isLoopbackCb("http://example.com/cb")).toBe(false);
    expect(isLoopbackCb("not a url")).toBe(false);
  });
});

describe("signState/verifyState", () => {
  it("round-trips the cb", () => {
    const token = signState("http://localhost:1234/cb", STATE_SECRET);
    const result = verifyState(token, STATE_SECRET);
    expect(result).toEqual({ cb: "http://localhost:1234/cb" });
  });

  it("rejects a tampered token", () => {
    const token = signState("http://localhost:1234/cb", STATE_SECRET);
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifyState(tampered, STATE_SECRET)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signState("http://localhost:1234/cb", "other-secret");
    expect(verifyState(token, STATE_SECRET)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
      const token = signState("http://localhost:1234/cb", STATE_SECRET);
      vi.setSystemTime(new Date("2020-01-01T01:00:00Z"));
      expect(verifyState(token, STATE_SECRET)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects garbage input", () => {
    expect(verifyState("not-a-valid-token", STATE_SECRET)).toBeNull();
    expect(verifyState("", STATE_SECRET)).toBeNull();
  });
});

describe("AuthService.startUrl", () => {
  it("rejects a non-loopback cb", () => {
    const { service } = makeService();
    expect(() => service.startUrl("https://evil.example.com/cb")).toThrow();
  });

  it("returns google.authUrl(signState(cb)) for a loopback cb", () => {
    const { service } = makeService();
    const url = service.startUrl("http://localhost:5555/cb");
    expect(url).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?state=/);
    const state = new URL(url).searchParams.get("state")!;
    expect(verifyState(state, STATE_SECRET)).toEqual({ cb: "http://localhost:5555/cb" });
  });
});

describe("AuthService.callback", () => {
  it("upserts the user, resolves pending memberships for that email, and redirects with a token", async () => {
    const { service, users, memberships, profile } = makeService();

    const pending = await memberships.add({ workspaceId: "ws-1", pendingEmail: profile.email, role: "editor", permissionId: "perm-1" });

    const state = signState("http://localhost:5555/cb", STATE_SECRET);
    const { redirectUrl } = await service.callback("auth-code", state);

    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe("http://localhost:5555/cb");
    const token = url.searchParams.get("token");
    expect(token).toBeTruthy();

    const decoded = verifySession(token!, JWT_SECRET);
    expect(decoded).not.toBeNull();

    const user = await users.getByEmail(profile.email);
    expect(user).toBeDefined();
    expect(decoded!.userId).toBe(user!.id);

    const updated = await memberships.getById(pending.id);
    expect(updated!.userId).toBe(user!.id);
    expect(updated!.pendingEmail).toBeUndefined();
  });

  it("throws on an invalid/tampered state", async () => {
    const { service } = makeService();
    await expect(service.callback("auth-code", "garbage-state")).rejects.toThrow();
  });

  it("throws on an expired state", async () => {
    const { service } = makeService();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
      const state = signState("http://localhost:5555/cb", STATE_SECRET);
      vi.setSystemTime(new Date("2020-01-01T01:00:00Z"));
      await expect(service.callback("auth-code", state)).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AuthService.me", () => {
  it("returns id + email for a known user", async () => {
    const { service, users } = makeService();
    const user = await users.upsertByGoogle({ googleSub: "sub-2", email: "bob@example.com", refreshToken: "rt-2" });
    const result = await service.me(user.id);
    expect(result).toEqual({ id: user.id, email: user.email });
  });

  it("returns undefined for an unknown user id", async () => {
    const { service } = makeService();
    const result = await service.me("does-not-exist");
    expect(result).toBeUndefined();
  });
});
