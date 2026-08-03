import { describe, it, expect, vi } from "vitest";
import { GoogleDriveClient } from "../../../server/src/domain/drive-client";

function res(status: number, body = "{}", headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body), headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as any;
}

describe("GoogleDriveClient retry/backoff", () => {
  it("retries a 503 then succeeds, without real delay", async () => {
    const calls: number[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async () => { n++; calls.push(n); return n < 3 ? res(503) : res(200, JSON.stringify({ headRevisionId: "r1" })); });
    const sleep = vi.fn(async () => {});
    const d = new GoogleDriveClient(async () => "tok", fetchImpl as any, { maxRetries: 4, sleep });
    const rev = await d.getHeadRevision("f1");
    expect(rev).toBe("r1");
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 503, 503, 200
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it("does NOT retry a 404 (non-retryable 4xx)", async () => {
    const fetchImpl = vi.fn(async () => res(404));
    const sleep = vi.fn(async () => {});
    const d = new GoogleDriveClient(async () => "tok", fetchImpl as any, { maxRetries: 4, sleep });
    await expect(d.getHeadRevision("f1")).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("gives up after maxRetries on persistent 429", async () => {
    const fetchImpl = vi.fn(async () => res(429));
    const sleep = vi.fn(async () => {});
    const d = new GoogleDriveClient(async () => "tok", fetchImpl as any, { maxRetries: 2, sleep });
    await expect(d.getHeadRevision("f1")).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
