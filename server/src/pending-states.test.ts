import { describe, it, expect } from "vitest";
import { PendingStates } from "./pending-states";

describe("PendingStates", () => {
  it("stores and takes a callback exactly once", () => {
    const s = new PendingStates();
    s.put("state-1", "http://localhost:5000");
    expect(s.take("state-1")).toBe("http://localhost:5000");
    expect(s.take("state-1")).toBeUndefined();
  });
  it("returns undefined for an unknown state", () => {
    expect(new PendingStates().take("nope")).toBeUndefined();
  });
  it("expires a state past its ttl", () => {
    const s = new PendingStates(-1); // everything is immediately expired
    s.put("state-1", "http://localhost:5000");
    expect(s.take("state-1")).toBeUndefined();
  });
});
