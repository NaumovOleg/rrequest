import { afterEach, describe, expect, it } from "vitest";
import { McpHttpServer } from "../../src/extension/mcp/server";
import { createServer } from "../../src/extension/mcp/server";
import { McpAccess } from "../../src/extension/mcp/access";
import type { McpPort } from "../../src/extension/mcp/port";

const TOKEN = "test-token-1234567890";

// Minimal port: the `about` tool only reads activeWorkspaceId.
const port = {
  listWorkspaces: async () => [],
  listCollections: async () => [],
  getCollection: async () => undefined,
  listEnvironments: async () => [],
  activeWorkspaceId: () => "ws-1",
  dispatch: async () => [],
} as unknown as McpPort;

const servers: McpHttpServer[] = [];

async function start(): Promise<string> {
  const access = new McpAccess({ prompt: async () => "deny" });
  const http = new McpHttpServer(() =>
    createServer(port, access, { version: "0.0.0" })
  );
  const url = await http.start({ port: 0, token: TOKEN });
  servers.push(http);
  return url;
}

function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${TOKEN}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
};

afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
});

describe("McpHttpServer", () => {
  it("completes an initialize handshake", async () => {
    const url = await start();
    const res = await post(url, initialize);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.result.serverInfo.name).toBe("rrequest");
  });

  it("lists the about tool", async () => {
    const url = await start();
    const res = await post(url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const names = body.result.tools.map((t: any) => t.name);
    expect(names).toContain("about");
  });

  it("rejects a missing or wrong token", async () => {
    const url = await start();
    expect((await post(url, initialize, { authorization: "" })).status).toBe(
      401
    );
    expect(
      (await post(url, initialize, { authorization: "Bearer nope" })).status
    ).toBe(401);
  });

  it("rejects a browser Origin (DNS-rebinding guard)", async () => {
    const url = await start();
    const res = await post(url, initialize, { origin: "http://evil.example" });
    expect(res.status).toBe(403);
  });

  it("rejects GET with 405", async () => {
    const url = await start();
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(405);
  });

  it("frees the port on stop", async () => {
    const url = await start();
    await servers.pop()!.stop();
    await expect(post(url, initialize)).rejects.toThrow();
  });
});
