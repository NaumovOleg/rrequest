import { describe, it, expect } from "vitest";
import * as http from "node:http";
import {
  extractToken,
  extractRefreshToken,
  signIn,
} from "../../../src/extension/sync/login";

describe("extractToken", () => {
  it("reads the token query param", () => {
    expect(extractToken("/?token=abc123")).toBe("abc123");
    expect(extractToken("/")).toBeUndefined();
  });
  it("reads the refresh query param", () => {
    expect(extractRefreshToken("/?token=abc&refresh=r1")).toBe("r1");
    expect(extractRefreshToken("/?token=abc")).toBeUndefined();
  });
});

describe("signIn", () => {
  it("opens the browser to /auth/start?cb=<loopback> and resolves with the captured tokens", async () => {
    let openedUrl = "";
    const openExternal = (url: string) => {
      openedUrl = url;
      // Simulate the browser (after Google) hitting the loopback callback with tokens.
      const cb = new URL(url).searchParams.get("cb")!;
      http.get(`${cb}?token=captured-jwt&refresh=captured-refresh`, () => {});
    };
    const result = await signIn({
      baseUrl: "http://localhost:8787",
      openExternal,
      timeoutMs: 3000,
    });
    expect(result).toEqual({
      token: "captured-jwt",
      refreshToken: "captured-refresh",
    });
    expect(openedUrl).toContain(
      "http://localhost:8787/auth/start?cb=http%3A%2F%2F127.0.0.1%3A"
    );
  });
});
