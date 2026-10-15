import { describe, expect, it } from "vitest";
import {
  ensureToken,
  mintToken,
  type TokenStore,
} from "../../src/extension/mcp/token";

/** In-memory stand-in for Secret Storage. */
function fakeStore(seed?: string): TokenStore & { value: string | undefined } {
  const s = {
    value: seed,
    get: async () => s.value,
    set: async (v: string) => {
      s.value = v;
    },
    delete: async () => {
      s.value = undefined;
    },
  };
  return s;
}

describe("MCP token", () => {
  it("mints a 48-hex-char token", () => {
    expect(mintToken()).toMatch(/^[0-9a-f]{48}$/);
  });

  it("mints once and stays stable across restarts", async () => {
    const store = fakeStore();
    const first = await ensureToken(store);
    const second = await ensureToken(store); // e.g. next server start
    const third = await ensureToken(store);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(store.value).toBe(first);
  });

  it("returns an existing stored token untouched", async () => {
    const store = fakeStore("abc123");
    expect(await ensureToken(store)).toBe("abc123");
  });

  it("mints a different token after the stored one is deleted", async () => {
    const store = fakeStore();
    const first = await ensureToken(store);
    await store.delete();
    const second = await ensureToken(store);
    expect(second).not.toBe(first);
    expect(second).toMatch(/^[0-9a-f]{48}$/);
  });
});
