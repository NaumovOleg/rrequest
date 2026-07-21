import { describe, it, expect, vi } from "vitest";
import { Realtime, type ChangeMsg } from "./realtime";

const msg = (over: Partial<ChangeMsg> = {}): ChangeMsg => ({ type: "workspace-changed", workspaceId: "w1", revision: "2", updatedBy: "a@x.com", ...over });

describe("Realtime", () => {
  it("broadcasts to subscribers of a workspace, excluding the sender", () => {
    const r = new Realtime();
    const a = vi.fn(), b = vi.fn(), c = vi.fn();
    r.register("cA", "u1", ["w1"], a);
    r.register("cB", "u1", ["w1"], b);
    r.register("cC", "u1", ["w2"], c);
    r.broadcast("w1", msg(), "cA");
    expect(a).not.toHaveBeenCalled();     // excluded sender
    expect(b).toHaveBeenCalledWith(msg());
    expect(c).not.toHaveBeenCalled();     // different workspace
  });
  it("stops delivering after unregister", () => {
    const r = new Realtime();
    const b = vi.fn();
    const off = r.register("cB", "u1", ["w1"], b);
    off();
    r.broadcast("w1", msg());
    expect(b).not.toHaveBeenCalled();
  });
});
