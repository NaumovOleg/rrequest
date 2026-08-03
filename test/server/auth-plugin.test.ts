import { describe, it, expect, vi } from "vitest";
import { authorize } from "../../server/src/auth-plugin.js";
import type { User } from "../../server/src/stores/types.js";

const USER: User = { id: "u1", email: "alice@example.com", googleSub: "sub-1", refreshToken: "rt-1" };

function verifyOk(_token: string): { userId: string } | null {
  return { userId: USER.id };
}

async function loadUserOk(id: string): Promise<User | undefined> {
  return id === USER.id ? USER : undefined;
}

describe("authorize", () => {
  it("returns the user for a valid Bearer token", async () => {
    const user = await authorize("Bearer good-token", verifyOk, loadUserOk);
    expect(user).toEqual(USER);
  });

  it("returns null when the Authorization header is missing", async () => {
    const user = await authorize(undefined, verifyOk, loadUserOk);
    expect(user).toBeNull();
  });

  it("returns null when the header isn't a Bearer token", async () => {
    const user = await authorize("Basic abc123", verifyOk, loadUserOk);
    expect(user).toBeNull();
  });

  it("returns null when the Bearer token is empty", async () => {
    const user = await authorize("Bearer ", verifyOk, loadUserOk);
    expect(user).toBeNull();
  });

  it("returns null when verify rejects the token", async () => {
    const user = await authorize("Bearer bad-token", () => null, loadUserOk);
    expect(user).toBeNull();
  });

  it("returns null when the verified user no longer exists in the store", async () => {
    const loadUser = vi.fn(async () => undefined);
    const user = await authorize("Bearer good-token", verifyOk, loadUser);
    expect(user).toBeNull();
    expect(loadUser).toHaveBeenCalledWith(USER.id);
  });

  it("uses the first value when the header arrives as an array (multi-value headers)", async () => {
    const user = await authorize(["Bearer good-token", "Bearer other"], verifyOk, loadUserOk);
    expect(user).toEqual(USER);
  });
});
