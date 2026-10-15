import { afterEach, describe, expect, it } from "vitest";
import { callTool, makeAccess, makePort, sampleData, start } from "./harness";

const running: { stop: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const s of running.splice(0)) await s.stop();
});

async function serve(opts: {
  grants?: string[];
  reply?: (m: any) => any[];
}): Promise<{
  url: string;
  dispatched: any[];
  granted: Set<string>;
  setReply: (r: any) => void;
}> {
  const { port, dispatched, setReply } = makePort(sampleData());
  if (opts.reply) setReply(opts.reply);
  const { access, granted } = makeAccess(opts.grants ?? []);
  const { url, stop } = await start(port, access);
  running.push({ stop });
  return { url, dispatched, granted, setReply };
}

describe("MCP manage tools (gated writes)", () => {
  it("create_collection dispatches createCollection and returns the new id", async () => {
    const { url, dispatched } = await serve({ grants: ["workspace:ws-1"] });
    const res = await callTool(url, "create_collection", { name: "New" });
    expect(res.isError).toBe(false);
    expect((res.data as any).name).toBe("New");
    expect((res.data as any).id).toMatch(/^c-new-/);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe("createCollection");
    expect(dispatched[0].name).toBe("New");
  });

  it("create_folder dispatches createFolder and returns the new id", async () => {
    const { url, dispatched } = await serve({ grants: ["collection:c1"] });
    const res = await callTool(url, "create_folder", {
      collectionId: "c1",
      name: "Auth",
    });
    expect(res.isError).toBe(false);
    expect((res.data as any).id).toMatch(/^f-new-/);
    expect(dispatched[0].type).toBe("createFolder");
    expect(dispatched[0].collectionId).toBe("c1");
  });

  it("denies a write without a grant and never dispatches", async () => {
    const { url, dispatched } = await serve({ grants: [] });
    const res = await callTool(url, "create_collection", { name: "Nope" });
    expect((res.data as any).reason).toBe("access_required");
    expect((res.data as any).resource.type).toBe("workspace");
    expect(dispatched).toHaveLength(0);
  });

  it("surfaces the workspace read-only error as a tool error", async () => {
    const { url, dispatched } = await serve({
      grants: ["workspace:ws-1"],
      reply: () => [
        {
          type: "toast",
          level: "error",
          message: "This workspace is read-only (viewer access).",
        },
      ],
    });
    const res = await callTool(url, "create_collection", { name: "X" });
    expect(res.isError).toBe(true);
    expect(res.raw).toContain("read-only");
    expect(dispatched).toHaveLength(1);
  });

  it("create_request posts saveRequest (not createRequest) and returns its id", async () => {
    const { url, dispatched } = await serve({ grants: ["collection:c1"] });
    const res = await callTool(url, "create_request", {
      collectionId: "c1",
      name: "Ping",
      method: "HEAD",
      url: "https://example.com/ping",
    });
    expect(res.isError).toBe(false);
    expect((res.data as any).id).toBeTruthy();
    expect(dispatched[0].type).toBe("saveRequest");
    expect(dispatched[0].folderId).toBeNull();
    expect(dispatched[0].request.id).toBe((res.data as any).id);
    expect(dispatched[0].request.method).toBe("HEAD");
  });

  it("update_request merges the patch but preserves the id", async () => {
    const { url, dispatched } = await serve({ grants: ["collection:c1"] });
    const res = await callTool(url, "update_request", {
      collectionId: "c1",
      requestId: "r1",
      patch: { method: "PUT", url: "https://example.com/users/1" },
    });
    expect(res.isError).toBe(false);
    expect((res.data as any).id).toBe("r1");
    expect(dispatched[0].type).toBe("saveRequest");
    expect(dispatched[0].request.id).toBe("r1");
    expect(dispatched[0].request.method).toBe("PUT");
    expect(dispatched[0].request.name).toBe("Get users"); // untouched field
  });

  it("move_request requires BOTH grants; one is not enough", async () => {
    const { url, dispatched, granted } = await serve({
      grants: ["collection:c1"],
    });

    const denied = await callTool(url, "move_request", {
      requestId: "r1",
      fromCollectionId: "c1",
      toCollectionId: "c2",
    });
    expect((denied.data as any).reason).toBe("access_required");
    expect((denied.data as any).resource.id).toBe("c2");
    expect(dispatched).toHaveLength(0);

    granted.add("collection:c2"); // the user Allow for the destination
    const okRes = await callTool(url, "move_request", {
      requestId: "r1",
      fromCollectionId: "c1",
      toCollectionId: "c2",
    });
    expect(okRes.isError).toBe(false);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe("moveRequest");
    expect(dispatched[0].fromCollectionId).toBe("c1");
    expect(dispatched[0].toCollectionId).toBe("c2");
  });

  it("delete_request dispatches deleteRequest", async () => {
    const { url, dispatched } = await serve({ grants: ["collection:c1"] });
    const res = await callTool(url, "delete_request", {
      collectionId: "c1",
      requestId: "r1",
    });
    expect(res.isError).toBe(false);
    expect((res.data as any).id).toBe("r1");
    expect(dispatched[0].type).toBe("deleteRequest");
    expect(dispatched[0].requestId).toBe("r1");
  });

  it("create_request accepts markdown documentation", async () => {
    const { url, dispatched } = await serve({ grants: ["collection:c1"] });
    const res = await callTool(url, "create_request", {
      collectionId: "c1",
      name: "Documented",
      description: "# How to use\n\nBearer token required.",
    });
    expect(res.isError).toBe(false);
    expect(dispatched[0].type).toBe("saveRequest");
    expect(dispatched[0].request.description).toBe(
      "# How to use\n\nBearer token required."
    );
  });

  it("writes docs through update_request and never wipes them by accident", async () => {
    const { url, dispatched } = await serve({ grants: ["collection:c1"] });

    const write = await callTool(url, "update_request", {
      collectionId: "c1",
      requestId: "r1",
      patch: { description: "# Users\n\nLists all users." },
    });
    expect(write.isError).toBe(false);
    expect(dispatched[0].request.description).toBe(
      "# Users\n\nLists all users."
    );
    expect(dispatched[0].request.method).toBe("GET"); // untouched

    // Docs are visible to the agent through the read tool too.
    const read = await callTool(url, "get_request", {
      collectionId: "c1",
      requestId: "r1",
    });
    expect((read.data as any).request.description).toContain(
      "Lists all users."
    );

    // A patch that doesn't mention docs must not wipe them.
    const other = await callTool(url, "update_request", {
      collectionId: "c1",
      requestId: "r1",
      patch: { method: "PUT" },
    });
    expect(other.isError).toBe(false);
    expect(dispatched[1].request.description).toBe(
      "# Users\n\nLists all users."
    );
    expect(dispatched[1].request.method).toBe("PUT");
    expect(dispatched[1].request.id).toBe("r1");
  });
});
