import { describe, it, expect } from "vitest";
import {
  signSession,
  signRefresh,
  verifySession,
  verifyRefresh,
} from "../../../server/src/domain/jwt";

describe("jwt session", () => {
  it("signs and verifies a session", () => {
    const token = signSession("user-1", "secret");
    expect(verifySession(token, "secret")).toEqual({ userId: "user-1" });
  });
  it("rejects a token signed with a different secret", () => {
    const token = signSession("user-1", "secret");
    expect(verifySession(token, "other")).toBeNull();
  });
  it("rejects garbage", () => {
    expect(verifySession("not-a-jwt", "secret")).toBeNull();
  });

  it("signs and verifies a refresh token", () => {
    const token = signRefresh("user-1", "secret");
    expect(verifyRefresh(token, "secret")).toEqual({ userId: "user-1" });
  });

  // An access token must not be usable as a long-lived refresh token, and a
  // refresh token must not be accepted as a request credential.
  it("keeps access and refresh tokens distinct", () => {
    expect(verifyRefresh(signSession("user-1", "secret"), "secret")).toBeNull();
    expect(verifySession(signRefresh("user-1", "secret"), "secret")).toBeNull();
  });

  it("rejects a refresh token signed with a different secret", () => {
    expect(verifyRefresh(signRefresh("user-1", "secret"), "other")).toBeNull();
  });
});
