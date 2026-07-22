import { describe, it, expect, vi, afterEach } from "vitest";
import { WatchScheduler } from "./watch-scheduler";

afterEach(() => { vi.useRealTimers(); });

describe("WatchScheduler", () => {
  it("calls pollAll on the poll interval and renewExpiring on the renew interval, and stops cleanly", async () => {
    vi.useFakeTimers();
    const service = { pollAll: vi.fn(async () => 0), renewExpiring: vi.fn(async () => 0) } as any;
    const s = new WatchScheduler({ service, pollIntervalMs: 1000, renewIntervalMs: 5000, renewWithinMs: 60000 });
    s.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(service.pollAll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000); // total 5000
    expect(service.pollAll).toHaveBeenCalledTimes(5);
    expect(service.renewExpiring).toHaveBeenCalledTimes(1);
    expect(service.renewExpiring).toHaveBeenCalledWith(60000);
    s.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(service.pollAll).toHaveBeenCalledTimes(5); // no more after stop
  });
});
