import { describe, it, expect } from "vitest";
import { buildMcpPort, type McpPortDeps } from "../../src/extension/mcp/port";
import type {
  Environment,
  HostMessage,
  WebviewMessage,
} from "../../src/shared/types";

function env(variables: Environment["variables"]): Environment {
  return { id: "e1", name: "E", workspaceId: "ws", variables };
}

const collections = {
  list: async () => [],
} as unknown as McpPortDeps["collections"];
const workspaces = {
  list: async () => [],
} as unknown as McpPortDeps["workspaces"];

describe("McpPort", () => {
  it("redacts secret variable values but keeps the secret flag", async () => {
    const environments = {
      list: async () => [
        env([
          { key: "HOST", value: "s3cr3t", enabled: true, secret: true },
          { key: "TOKEN", value: "plain", enabled: true },
        ]),
      ],
    } as unknown as McpPortDeps["environments"];
    const port = buildMcpPort({
      collections,
      environments,
      workspaces,
      getActiveWorkspaceId: () => "ws",
      dispatch: async () => [],
    });

    const [e] = await port.listEnvironments();
    const secret = e.variables.find((v) => v.secret)!;
    const plain = e.variables.find((v) => !v.secret)!;
    expect(secret.value).toBe("");
    expect(secret.secret).toBe(true);
    expect(plain.value).toBe("plain");
  });

  it("forwards dispatch to the injected router and returns its messages", async () => {
    const seen: WebviewMessage[] = [];
    const reply: HostMessage[] = [
      { type: "toast", level: "info", message: "ok" } as HostMessage,
    ];
    const port = buildMcpPort({
      collections,
      environments: {
        list: async () => [],
      } as unknown as McpPortDeps["environments"],
      workspaces,
      getActiveWorkspaceId: () => "ws",
      dispatch: async (m) => {
        seen.push(m);
        return reply;
      },
    });

    const out = await port.dispatch({} as unknown as WebviewMessage);
    expect(seen).toHaveLength(1);
    expect(out).toEqual(reply);
  });
});
