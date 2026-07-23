import { describe, it, expect } from "vitest";
import { requireUser } from "./auth";
import { UserStore } from "./user-store";
import { signSession } from "./domain/jwt";

const deps = () => {
  const users = new UserStore(":memory:", "k");
  const u = users.upsertByGoogle({ googleSub: "g", email: "a@x.com", refreshToken: "rt" });
  return { deps: { config: { jwtSecret: "j" }, users }, user: u };
};

describe("requireUser", () => {
  it("returns the user for a valid Bearer token", () => {
    const { deps: d, user } = deps();
    const req = { headers: { authorization: `Bearer ${signSession(user.id, "j")}` } };
    expect(requireUser(req, d)?.id).toBe(user.id);
  });
  it("returns null without a token", () => {
    const { deps: d } = deps();
    expect(requireUser({ headers: {} }, d)).toBeNull();
  });
  it("returns null when the user no longer exists", () => {
    const { deps: d } = deps();
    const req = { headers: { authorization: `Bearer ${signSession("ghost", "j")}` } };
    expect(requireUser(req, d)).toBeNull();
  });
});
