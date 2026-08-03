import { describe, it, expect } from "vitest";
import { MemoryUserStore } from "../../../../server/src/stores/memory/user-store";

describe("MemoryUserStore", () => {
  it("inserts a new user and returns it with a generated id", async () => {
    const store = new MemoryUserStore();
    const u = await store.upsertByGoogle({ googleSub: "g1", email: "a@x.com", refreshToken: "rt1" });
    expect(u.id).toBeTruthy();
    expect(u.email).toBe("a@x.com");
    expect((await store.getById(u.id))?.refreshToken).toBe("rt1");
  });
  it("upserts by googleSub (same id, updated email + token)", async () => {
    const store = new MemoryUserStore();
    const first = await store.upsertByGoogle({ googleSub: "g1", email: "a@x.com", refreshToken: "rt1" });
    const second = await store.upsertByGoogle({ googleSub: "g1", email: "b@x.com", refreshToken: "rt2" });
    expect(second.id).toBe(first.id);
    expect((await store.getById(first.id))?.email).toBe("b@x.com");
    expect((await store.getById(first.id))?.refreshToken).toBe("rt2");
  });
  it("returns undefined for an unknown id", async () => {
    expect(await new MemoryUserStore().getById("nope")).toBeUndefined();
  });
});

describe("MemoryUserStore.getByEmail", () => {
  it("returns the user with the given email, or undefined", async () => {
    const s = new MemoryUserStore();
    const u = await s.upsertByGoogle({ googleSub: "g1", email: "a@x.com", refreshToken: "rt1" });
    expect((await s.getByEmail("a@x.com"))?.id).toBe(u.id);
    expect((await s.getByEmail("a@x.com"))?.refreshToken).toBe("rt1");
    expect(await s.getByEmail("missing@x.com")).toBeUndefined();
  });
});
