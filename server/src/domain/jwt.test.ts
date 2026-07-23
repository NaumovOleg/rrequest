import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "./jwt";

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
});
