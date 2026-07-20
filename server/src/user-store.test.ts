import { describe, it, expect } from "vitest";
import { UserStore } from "./user-store";

describe("UserStore", () => {
  it("inserts a new user and returns it with a generated id", () => {
    const store = new UserStore(":memory:", "enc");
    const u = store.upsertByGoogle({ googleSub: "g1", email: "a@x.com", refreshToken: "rt1" });
    expect(u.id).toBeTruthy();
    expect(u.email).toBe("a@x.com");
    expect(store.getById(u.id)?.refreshToken).toBe("rt1");
  });
  it("upserts by googleSub (same id, updated email + token)", () => {
    const store = new UserStore(":memory:", "enc");
    const first = store.upsertByGoogle({ googleSub: "g1", email: "a@x.com", refreshToken: "rt1" });
    const second = store.upsertByGoogle({ googleSub: "g1", email: "b@x.com", refreshToken: "rt2" });
    expect(second.id).toBe(first.id);
    expect(store.getById(first.id)?.email).toBe("b@x.com");
    expect(store.getById(first.id)?.refreshToken).toBe("rt2");
  });
  it("returns undefined for an unknown id", () => {
    expect(new UserStore(":memory:", "enc").getById("nope")).toBeUndefined();
  });
});
