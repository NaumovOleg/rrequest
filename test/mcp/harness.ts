import { McpHttpServer, createServer } from "../../src/extension/mcp/server";
import { McpAccess } from "../../src/extension/mcp/access";
import { buildMcpPort } from "../../src/extension/mcp/port";
import type { McpPort } from "../../src/extension/mcp/port";
import type {
  Collection,
  Environment,
  HostMessage,
  WebviewMessage,
  Workspace,
} from "../../src/shared/types";

const TOKEN = "test-token-1234567890";

/** Two collections: one with a nested folder, one environment with a secret. */
export function sampleData() {
  const workspaces: Workspace[] = [{ id: "ws-1", name: "Default" }];
  const collections: Collection[] = [
    {
      id: "c1",
      name: "API",
      workspaceId: "ws-1",
      requests: [
        {
          id: "r1",
          name: "Get users",
          method: "GET",
          url: "https://example.com/users",
          params: [],
          headers: [],
          body: { mode: "none" },
        },
      ],
      folders: [
        {
          id: "f1",
          name: "Users",
          requests: [
            {
              id: "r2",
              name: "Create user",
              method: "POST",
              url: "https://example.com/users",
              params: [],
              headers: [],
              body: { mode: "none" },
            },
          ],
        },
      ],
    },
    { id: "c2", name: "Blog", workspaceId: "ws-1", requests: [], folders: [] },
  ];
  const environments: Environment[] = [
    {
      id: "e1",
      name: "Prod",
      workspaceId: "ws-1",
      variables: [
        { key: "TOKEN", value: "s3cr3t", enabled: true, secret: true },
        { key: "HOST", value: "prod.example.com", enabled: true },
      ],
    },
  ];
  return { workspaces, collections, environments };
}

export type Sample = ReturnType<typeof sampleData>;

/** Port backed by the sample data; records dispatched messages and lets a test
 *  fake the reply (e.g. a viewer-workspace read-only error toast). */
export function makePort(sample: Sample): {
  port: McpPort;
  dispatched: WebviewMessage[];
  setReply: (r: HostMessage[] | ((m: WebviewMessage) => HostMessage[])) => void;
} {
  const dispatched: WebviewMessage[] = [];
  let reply: HostMessage[] | ((m: WebviewMessage) => HostMessage[]) = [];
  let n = 0;

  // Real port builder so environment redaction (secret values blanked) and the
  // exact read surface are production-faithful; only dispatch is faked.
  const port: McpPort = buildMcpPort({
    collections: { list: async () => sample.collections },
    environments: { list: async () => sample.environments },
    workspaces: { list: async () => sample.workspaces },
    getActiveWorkspaceId: () => "ws-1",
    dispatch: async (msg: WebviewMessage) => {
      dispatched.push(msg);
      // Simulate what the real router persists so before/after diffs resolve.
      if (msg.type === "createCollection") {
        sample.collections.push({
          id: `c-new-${++n}`,
          name: msg.name,
          workspaceId: "ws-1",
          requests: [],
          folders: [],
        });
      } else if (msg.type === "createFolder") {
        const c = sample.collections.find((x) => x.id === msg.collectionId);
        if (c) {
          c.folders ??= [];
          c.folders.push({ id: `f-new-${++n}`, name: msg.name, requests: [] });
        }
      } else if (msg.type === "saveRequest") {
        const c = sample.collections.find((x) => x.id === msg.collectionId);
        const list = msg.folderId
          ? (c?.folders ?? []).find((f) => f.id === msg.folderId)?.requests
          : c?.requests;
        if (list) {
          const i = list.findIndex((r) => r.id === msg.request.id);
          if (i >= 0) list[i] = msg.request;
          else list.push(msg.request);
        }
      }
      return typeof reply === "function" ? reply(msg) : reply;
    },
  } as unknown as Parameters<typeof buildMcpPort>[0]);

  return {
    port,
    dispatched,
    setReply: (r) => {
      reply = r;
    },
  };
}

export function key(ref: { type: string; id: string }): string {
  return `${ref.type}:${ref.id}`;
}

/**
 * Access stub whose grants are pre-seeded from a list of `type:id` keys
 * (the plan calls this the "injected access stub"): a require() for a seeded
 * key succeeds, anything else answers `access_required`. Tests seed grants by
 * pushing onto `granted`, which stands in for a user Allow.
 */
export function makeAccess(initial: string[] = []): {
  access: McpAccess;
  granted: Set<string>;
} {
  const granted = new Set(initial);
  type Ref = { type: string; id: string; name?: string };
  const access = {
    has: (ref: Ref) => granted.has(key(ref)),
    require: async (ref: Ref) =>
      granted.has(key(ref))
        ? ({ ok: true } as const)
        : ({
            ok: false,
            reason: "access_required",
            hint: `call request_access for ${ref.type} "${ref.name ?? ref.id}"`,
          } as const),
    list: () => [],
    revoke: () => {},
    revokeAll: () => {},
    clear: () => {},
  } as unknown as McpAccess;
  return { access, granted };
}

type ToolCall = {
  isError: boolean;
  data: unknown;
  raw: string;
};

/** Starts a loopback MCP server over the given port/access; returns url+stop. */
export async function start(
  port: McpPort,
  access: McpAccess
): Promise<{ url: string; stop: () => Promise<void> }> {
  const http = new McpHttpServer(() =>
    createServer(port, access, { version: "0.0.0" })
  );
  const url = await http.start({ port: 0, token: TOKEN });
  return { url, stop: () => http.stop() };
}

async function post(url: string, body: unknown, authorization?: string) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: authorization ?? `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

export function postJson(
  url: string,
  body: unknown,
  authorization?: string
): Promise<unknown> {
  return post(url, body, authorization).then((r) => r.json());
}

/** Calls a tool and returns its parsed JSON text (plus isError/JSON-RPC error). */
export async function callTool(
  url: string,
  name: string,
  args: Record<string, unknown> = {}
): Promise<ToolCall> {
  const body: any = await post(url, {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: { name, arguments: args },
  }).then((r) => r.json());
  if (body.error)
    return { isError: true, data: body.error, raw: JSON.stringify(body.error) };
  const res = body.result;
  const text: string = res?.content?.[0]?.text ?? "";
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { isError: !!res?.isError, data, raw: text };
}

export async function listToolNames(url: string): Promise<string[]> {
  const body: any = await post(url, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  }).then((r) => r.json());
  return (body.result?.tools ?? []).map((t: any) => t.name);
}
