import { describe, expect, it, vi } from "vitest";
import { McpAccess, type AccessDecision } from "../../src/extension/mcp/access";

const collection = { type: "collection" as const, id: "c1", name: "Foo" };

type PromptArg = {
  type: string;
  id: string;
  name: string;
  write: boolean;
  alreadyRead: boolean;
};

function make(values: AccessDecision[]) {
  const prompt = vi.fn(async (_req: PromptArg) => values.shift() ?? "deny");
  const access = new McpAccess({ prompt });
  return { access, prompt };
}

describe("McpAccess", () => {
  it("grants read on allow and does not re-prompt", async () => {
    const { access, prompt } = make(["allow"]);
    expect(await access.require(collection, "read")).toEqual({ ok: true });
    expect(access.has(collection, "read")).toBe(true);
    expect(access.has(collection, "write")).toBe(false);
    expect(await access.require(collection, "read")).toEqual({ ok: true });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("grants write (implies read) on allow-write", async () => {
    const { access } = make(["allow-write"]);
    await access.require(collection, "write");
    expect(access.has(collection, "write")).toBe(true);
    expect(access.has(collection, "read")).toBe(true);
  });

  it("remembers a deny and returns access_denied once, without re-prompting", async () => {
    const { access, prompt } = make(["deny"]);
    const first = await access.require(collection, "read");
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.reason).toBe("access_denied");
    const second = await access.require(collection, "read");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("access_denied");
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("prompts to upgrade read -> write and keeps the write grant", async () => {
    const { access, prompt } = make(["allow", "allow-write"]);
    await access.require(collection, "read");
    await access.require(collection, "write");
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls[1][0].alreadyRead).toBe(true);
    expect(access.has(collection, "write")).toBe(true);
  });

  it("does not downgrade a write grant when read is re-requested", async () => {
    const { access } = make(["allow-write"]);
    await access.require(collection, "write");
    await access.require(collection, "read");
    expect(access.has(collection, "write")).toBe(true);
  });

  it("clear() drops grants and denials", async () => {
    const { access, prompt } = make(["allow-write", "deny"]);
    await access.require(collection, "write");
    await access.require(
      { type: "environment", id: "e1", name: "Env" },
      "read"
    );
    expect(access.list()).toHaveLength(1);
    access.clear();
    expect(access.list()).toHaveLength(0);
    // A cleared denial is re-asked (3rd prompt: collection + env + this one).
    await access.require(collection, "read");
    expect(prompt).toHaveBeenCalledTimes(3);
  });

  it("revoke() removes a single grant and re-prompts next time", async () => {
    const { access, prompt } = make(["allow", "allow"]);
    await access.require(collection, "read");
    access.revoke(collection);
    expect(access.has(collection, "read")).toBe(false);
    await access.require(collection, "read");
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("keeps different resources independent", async () => {
    const { access } = make(["allow"]);
    await access.require(collection, "read");
    expect(
      access.has({ type: "environment", id: "c1", name: "x" }, "read")
    ).toBe(false);
  });
});
