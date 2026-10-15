import { afterEach, describe, expect, it, vi } from "vitest";
import {
  McpAccess,
  type AccessDecision,
  type PromptRequest,
} from "../../src/extension/mcp/access";
import { callTool, makeAccess, makePort, sampleData, start } from "./harness";

const running: { stop: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const s of running.splice(0)) await s.stop();
});

async function serve(access: McpAccess): Promise<string> {
  const { port } = makePort(sampleData());
  const { url, stop } = await start(port, access);
  running.push({ stop });
  return url;
}

describe("MCP read tools (access gating)", () => {
  it("list_collections is ungated and never prompts", async () => {
    const prompt = vi.fn(
      async (_req: PromptRequest): Promise<AccessDecision> => "deny"
    );
    const url = await serve(new McpAccess({ prompt }));
    const res = await callTool(url, "list_collections");
    expect(res.isError).toBe(false);
    expect((res.data as any).map((c: any) => c.name)).toEqual(["API", "Blog"]);
    expect((res.data as any)[0].requestCount).toBe(2);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("list_requests without a grant returns access_required", async () => {
    const { access } = makeAccess();
    const url = await serve(access);
    const res = await callTool(url, "list_requests", { collectionId: "c1" });
    expect((res.data as any).reason).toBe("access_required");
    expect((res.data as any).resource.id).toBe("c1");
    expect((res.data as any).hint).toContain("request_access");
  });

  it("after granting, list_requests flattens nested folders", async () => {
    const { access, granted } = makeAccess();
    const url = await serve(access);
    granted.add("collection:c1"); // the user pressed Allow
    const res = await callTool(url, "list_requests", { collectionId: "c1" });
    const items = res.data as any[];
    expect(items).toHaveLength(2);
    const top = items.find((i) => i.id === "r1");
    const nested = items.find((i) => i.id === "r2");
    expect(top.method).toBe("GET");
    expect(top.folder).toBeNull();
    expect(nested.method).toBe("POST");
    expect(nested.folder).toBe("Users");
  });

  it("get_request returns the stored definition once granted", async () => {
    const { access } = makeAccess(["collection:c1"]);
    const url = await serve(access);
    const res = await callTool(url, "get_request", {
      collectionId: "c1",
      requestId: "r1",
    });
    const data = res.data as any;
    expect(data.folder).toBeNull();
    expect(data.request.method).toBe("GET");
    expect(data.request.url).toBe("https://example.com/users");
    expect(data.request.id).toBe("r1");
  });

  it("get_environment is gated and redacts secret values", async () => {
    const { access, granted } = makeAccess();
    const url = await serve(access);

    const denied = await callTool(url, "get_environment", {
      environmentId: "e1",
    });
    expect((denied.data as any).reason).toBe("access_required");

    granted.add("environment:e1");
    const okRes = await callTool(url, "get_environment", {
      environmentId: "e1",
    });
    const vars = (okRes.data as any).variables;
    expect(vars.find((v: any) => v.key === "TOKEN").value).toBe("");
    expect(vars.find((v: any) => v.key === "TOKEN").secret).toBe(true);
    expect(vars.find((v: any) => v.key === "HOST").value).toBe(
      "prod.example.com"
    );
  });

  it("request_access prompts the user and records the grant", async () => {
    const prompt = vi.fn(
      async (_req: PromptRequest): Promise<AccessDecision> => "allow"
    );
    const access = new McpAccess({ prompt });
    const url = await serve(access);

    const res = await callTool(url, "request_access", {
      resource: "collection",
      id: "c1",
    });
    expect((res.data as any).ok).toBe(true);
    expect((res.data as any).granted).toBe("read");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0][0]).toMatchObject({
      type: "collection",
      id: "c1",
      write: false,
    });
    // Grant survives: a gated read now succeeds without another prompt.
    const read = await callTool(url, "list_requests", { collectionId: "c1" });
    expect(read.data as any).toHaveLength(2);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("request_access resolves by name and errors on unknown ids", async () => {
    const access = new McpAccess({ prompt: async () => "allow" });
    const url = await serve(access);

    const byName = await callTool(url, "request_access", {
      resource: "collection",
      name: "api",
    });
    expect((byName.data as any).ok).toBe(true);
    expect((byName.data as any).resource.id).toBe("c1");

    const missing = await callTool(url, "request_access", {
      resource: "collection",
      id: "nope",
    });
    expect(missing.isError).toBe(true);
    expect(missing.raw).toContain("Candidates");
  });
});
