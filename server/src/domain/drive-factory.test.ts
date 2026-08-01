import { describe, it, expect } from "vitest";
import { folderNameForUser } from "./drive-factory";

describe("folderNameForUser", () => {
  it("is stable per user and ends with -rrequest", () => {
    const a = folderNameForUser("user-123");
    expect(a).toMatch(/^[0-9a-f]{8}-rrequest$/);
    expect(folderNameForUser("user-123")).toBe(a);
    expect(folderNameForUser("user-999")).not.toBe(a);
  });
});
