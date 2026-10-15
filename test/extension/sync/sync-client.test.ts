import { describe, it, expect, vi } from "vitest";
import {
  SyncClient,
  SyncForbiddenError,
  SyncAuthError,
  SyncGoneError,
  refreshSession,
} from "../../../src/extension/sync/sync-client";

function fetchMock(
  handler: (url: string, init: any) => { status: number; body: any }
) {
  return vi.fn(async (url: string, init: any) => {
    const { status, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as any;
  });
}

const client = (fetchImpl: any) =>
  new SyncClient({
    baseUrl: "http://localhost:8787",
    getToken: () => "jwt-1",
    fetchImpl,
  });

describe("SyncClient", () => {
  it("me() calls /me with the bearer token", async () => {
    let seen: any;
    const f = fetchMock((url, init) => {
      seen = { url, init };
      return { status: 200, body: { id: "u1", email: "a@x.com" } };
    });
    const me = await client(f).me();
    expect(me.email).toBe("a@x.com");
    expect(seen.url).toBe("http://localhost:8787/me");
    expect(seen.init.headers.authorization).toBe("Bearer jwt-1");
  });
  it("unwraps the Helios {success,data} envelope (Function URL backend)", async () => {
    const f = fetchMock(() => ({
      status: 200,
      body: {
        success: true,
        data: { id: "u9", email: "z@x.com" },
        timestamp: "t",
      },
    }));
    const me = await client(f).me();
    expect(me).toEqual({ id: "u9", email: "z@x.com" });
  });
  it("enableSync POSTs the snapshot and returns driveFileId + revision", async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe("http://localhost:8787/workspaces");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({
        workspaceId: "w1",
        name: "W",
        snapshot: '{"v":1}',
      });
      return { status: 201, body: { driveFileId: "f1", revision: "1" } };
    });
    expect(await client(f).enableSync("w1", "W", '{"v":1}')).toEqual({
      driveFileId: "f1",
      revision: "1",
    });
  });
  it("push PUTs {snapshot, baseRevision} and returns ok on 200", async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe("http://localhost:8787/workspaces/w1");
      expect(init.method).toBe("PUT");
      expect(JSON.parse(init.body)).toEqual({
        snapshot: '{"v":2}',
        baseRevision: "1",
      });
      return { status: 200, body: { revision: "2" } };
    });
    expect(await client(f).push("w1", '{"v":2}', "1")).toEqual({
      ok: true,
      revision: "2",
    });
  });
  it("push returns a conflict object on 409", async () => {
    const f = fetchMock(() => ({
      status: 409,
      body: { snapshot: '{"v":9}', revision: "5" },
    }));
    expect(await client(f).push("w1", '{"v":2}', "1")).toEqual({
      ok: false,
      conflict: true,
      snapshot: '{"v":9}',
      revision: "5",
    });
  });
  it("pull GETs /workspaces/:id", async () => {
    const f = fetchMock(() => ({
      status: 200,
      body: { snapshot: '{"v":2}', revision: "2" },
    }));
    expect(await client(f).pull("w1")).toEqual({
      snapshot: '{"v":2}',
      revision: "2",
    });
  });
  it("throws on a non-2xx response", async () => {
    const f = fetchMock(() => ({ status: 403, body: { error: "forbidden" } }));
    await expect(client(f).push("w1", "{}", "1")).rejects.toBeInstanceOf(
      SyncForbiddenError
    );
  });
});

describe("SyncClient members + 403", () => {
  it("listMembers GETs the members array", async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe("http://localhost:8787/workspaces/w1/members");
      expect(init.method ?? "GET").toBe("GET");
      return {
        status: 200,
        body: {
          members: [
            { email: "o@x.com", role: "owner", pending: false },
            { id: "m1", email: "e@x.com", role: "editor", pending: false },
          ],
        },
      };
    });
    const list = await client(f).listMembers("w1");
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ id: "m1", role: "editor" });
  });
  it("addMember POSTs email+role and returns the member", async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe("http://localhost:8787/workspaces/w1/members");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({
        email: "n@x.com",
        role: "viewer",
      });
      return {
        status: 201,
        body: { id: "m2", email: "n@x.com", role: "viewer", pending: true },
      };
    });
    expect(
      await client(f).addMember("w1", { email: "n@x.com", role: "viewer" })
    ).toMatchObject({ id: "m2", pending: true });
  });
  it("removeMember DELETEs the member", async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe("http://localhost:8787/workspaces/w1/members/m1");
      expect(init.method).toBe("DELETE");
      return { status: 200, body: { ok: true } };
    });
    await client(f).removeMember("w1", "m1");
  });
  it("a 403 on a GET throws SyncForbiddenError", async () => {
    const f = fetchMock(() => ({ status: 403, body: { error: "forbidden" } }));
    await expect(client(f).pull("w1")).rejects.toBeInstanceOf(
      SyncForbiddenError
    );
  });
  it("a 403 on push throws SyncForbiddenError", async () => {
    const f = fetchMock(() => ({ status: 403, body: { error: "forbidden" } }));
    await expect(client(f).push("w1", "{}", "1")).rejects.toBeInstanceOf(
      SyncForbiddenError
    );
  });
});

describe("SyncClient 401/404 + deleteWorkspace", () => {
  it("a 401 on pull throws SyncAuthError", async () => {
    const f = fetchMock(() => ({
      status: 401,
      body: { error: "unauthorized" },
    }));
    await expect(client(f).pull("w1")).rejects.toBeInstanceOf(SyncAuthError);
  });
  it("a 404 on pull throws SyncGoneError", async () => {
    const f = fetchMock(() => ({ status: 404, body: { error: "not found" } }));
    await expect(client(f).pull("w1")).rejects.toBeInstanceOf(SyncGoneError);
  });
  it("a 401 on push throws SyncAuthError", async () => {
    const f = fetchMock(() => ({
      status: 401,
      body: { error: "unauthorized" },
    }));
    await expect(client(f).push("w1", "{}", "1")).rejects.toBeInstanceOf(
      SyncAuthError
    );
  });
  it("a 404 on push throws SyncGoneError", async () => {
    const f = fetchMock(() => ({ status: 404, body: { error: "not found" } }));
    await expect(client(f).push("w1", "{}", "1")).rejects.toBeInstanceOf(
      SyncGoneError
    );
  });
  it("deleteWorkspace DELETEs /workspaces/:id", async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe("http://localhost:8787/workspaces/w1");
      expect(init.method).toBe("DELETE");
      return { status: 200, body: { ok: true } };
    });
    await client(f).deleteWorkspace("w1");
  });
  it("deleteWorkspace throws SyncForbiddenError on 403", async () => {
    const f = fetchMock(() => ({ status: 403, body: { error: "forbidden" } }));
    await expect(client(f).deleteWorkspace("w1")).rejects.toBeInstanceOf(
      SyncForbiddenError
    );
  });
  it("deleteWorkspace throws SyncGoneError on 404", async () => {
    const f = fetchMock(() => ({ status: 404, body: { error: "not found" } }));
    await expect(client(f).deleteWorkspace("w1")).rejects.toBeInstanceOf(
      SyncGoneError
    );
  });
});

// A response-like object for the refresh/retry tests, where the same mock must
// answer differently per call (401 first, 200 after refresh).
function res(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any;
}

describe("refreshSession", () => {
  it("POSTs the refresh token to /auth/refresh and returns the new access token", async () => {
    const f: any = vi.fn(async (url: string, init: any) => {
      expect(url).toBe("http://localhost:8787/auth/refresh");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ refresh: "r1" });
      return res(200, { token: "new-access" });
    });
    expect(await refreshSession("http://localhost:8787", "r1", f)).toBe(
      "new-access"
    );
  });
  it("unwraps the Helios {success,data} envelope", async () => {
    const f: any = vi.fn(async () =>
      res(200, { success: true, data: { token: "env-access" }, timestamp: "t" })
    );
    expect(await refreshSession("http://localhost:8787", "r1", f)).toBe(
      "env-access"
    );
  });
  it("returns undefined when the server rejects the refresh token", async () => {
    const f: any = vi.fn(async () => res(401, { error: "unauthorized" }));
    expect(
      await refreshSession("http://localhost:8787", "bad", f)
    ).toBeUndefined();
  });
});

describe("SyncClient auto-refresh on 401", () => {
  it("refreshes once and retries with the new token", async () => {
    const seen: string[] = [];
    const f: any = vi.fn(async (_url: string, init: any) => {
      seen.push(init.headers.authorization);
      return init.headers.authorization === "Bearer stale"
        ? res(401, { error: "unauthorized" })
        : res(200, { id: "u1", email: "a@x.com" });
    });
    const c = new SyncClient({
      baseUrl: "http://localhost:8787",
      getToken: () => "stale",
      fetchImpl: f,
      onAuth: async () => "fresh",
    });
    expect(await c.me()).toEqual({ id: "u1", email: "a@x.com" });
    expect(seen).toEqual(["Bearer stale", "Bearer fresh"]);
  });

  it("throws SyncAuthError when refresh yields nothing", async () => {
    const f: any = vi.fn(async () => res(401, { error: "unauthorized" }));
    const c = new SyncClient({
      baseUrl: "http://localhost:8787",
      getToken: () => "stale",
      fetchImpl: f,
      onAuth: async () => undefined,
    });
    await expect(c.me()).rejects.toBeInstanceOf(SyncAuthError);
    expect(f).toHaveBeenCalledTimes(1); // no point retrying without a new token
  });

  it("does not refresh on a non-401 error", async () => {
    const onAuth = vi.fn(async () => "fresh");
    const f: any = vi.fn(async () => res(403, { error: "forbidden" }));
    const c = new SyncClient({
      baseUrl: "http://localhost:8787",
      getToken: () => "ok",
      fetchImpl: f,
      onAuth,
    });
    await expect(c.pull("w1")).rejects.toBeInstanceOf(SyncForbiddenError);
    expect(onAuth).not.toHaveBeenCalled();
  });

  it("a push 401 is also refreshed and retried", async () => {
    const seen: string[] = [];
    const f: any = vi.fn(async (_url: string, init: any) => {
      seen.push(init.headers.authorization);
      return init.headers.authorization === "Bearer stale"
        ? res(401, { error: "unauthorized" })
        : res(200, { revision: "2" });
    });
    const c = new SyncClient({
      baseUrl: "http://localhost:8787",
      getToken: () => "stale",
      fetchImpl: f,
      onAuth: async () => "fresh",
    });
    expect(await c.push("w1", "{}", "1")).toEqual({ ok: true, revision: "2" });
    expect(seen).toEqual(["Bearer stale", "Bearer fresh"]);
  });
});
