import { describe, it, expect } from "vitest";
import { WatchChannelStore } from "./watch-channel-store";

const ch = (over = {}) => ({ workspaceId: "w1", channelId: "c1", resourceId: "r1", token: "t1", expiration: 1000, ...over });

describe("WatchChannelStore", () => {
  it("upserts and reads back by channel id and workspace id", () => {
    const s = new WatchChannelStore(":memory:");
    s.upsert(ch());
    expect(s.getByChannelId("c1")).toEqual(ch());
    expect(s.getByWorkspaceId("w1")).toEqual(ch());
  });
  it("upsert replaces the row for the same workspace (one channel per workspace)", () => {
    const s = new WatchChannelStore(":memory:");
    s.upsert(ch());
    s.upsert(ch({ channelId: "c2", resourceId: "r2", token: "t2", expiration: 2000 }));
    expect(s.getByChannelId("c1")).toBeUndefined();
    expect(s.getByWorkspaceId("w1")).toMatchObject({ channelId: "c2", expiration: 2000 });
  });
  it("all() lists every channel; delete removes by workspace", () => {
    const s = new WatchChannelStore(":memory:");
    s.upsert(ch());
    s.upsert(ch({ workspaceId: "w2", channelId: "c9", resourceId: "r9" }));
    expect(s.all()).toHaveLength(2);
    s.delete("w1");
    expect(s.getByWorkspaceId("w1")).toBeUndefined();
    expect(s.all()).toHaveLength(1);
  });
});
