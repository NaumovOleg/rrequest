import { describe, it, expect, vi } from "vitest";
import { GoogleOAuth } from "./google-oauth";

function fakeClient() {
  return {
    generateAuthUrl: vi.fn((o: any) => `https://accounts.google.com/o/oauth2/v2/auth?state=${o.state}`),
    getToken: vi.fn(async () => ({ tokens: { id_token: "idtok", refresh_token: "rt-abc" } })),
    verifyIdToken: vi.fn(async () => ({ getPayload: () => ({ sub: "g-sub", email: "a@x.com" }) })),
  };
}

describe("GoogleOAuth", () => {
  it("builds an auth url carrying the state and requesting offline access", () => {
    const c = fakeClient();
    const url = new GoogleOAuth(c as any, "cid").authUrl("state-123");
    expect(url).toContain("state-123");
    expect(c.generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ access_type: "offline", prompt: "consent", state: "state-123" }),
    );
    const scopes = (c.generateAuthUrl.mock.calls[0][0] as any).scope as string[];
    expect(scopes).toContain("https://www.googleapis.com/auth/drive.file");
  });
  it("exchanges a code into a profile with the refresh token", async () => {
    const profile = await new GoogleOAuth(fakeClient() as any, "cid").exchange("code-1");
    expect(profile).toEqual({ googleSub: "g-sub", email: "a@x.com", refreshToken: "rt-abc" });
  });
  it("throws when Google returns no refresh token", async () => {
    const c = fakeClient();
    c.getToken = vi.fn(async () => ({ tokens: { id_token: "idtok", refresh_token: null } }));
    await expect(new GoogleOAuth(c as any, "cid").exchange("code-1")).rejects.toThrow(/refresh token/i);
  });
});
