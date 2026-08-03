import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../../../server/src/domain/crypto";

describe("crypto", () => {
  it("round-trips a value", () => {
    const blob = encrypt("refresh-token-123", "secret");
    expect(blob).not.toContain("refresh-token-123");
    expect(decrypt(blob, "secret")).toBe("refresh-token-123");
  });
  it("fails to decrypt with the wrong key", () => {
    const blob = encrypt("x", "secret");
    expect(() => decrypt(blob, "wrong")).toThrow();
  });
});
