import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  Collection,
  CollectionItem,
  HostMessage,
  RestRequest,
} from "../../shared/types";
import { defaultHeaders, itemKind, newId } from "../../shared/types";
import type { McpPort } from "./port";
import { McpAccess, type AccessResult, type ResourceRef } from "./access";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function denyResult(
  ref: ResourceRef,
  r: AccessResult & { ok: false }
): ToolResult {
  return ok({
    ok: false,
    reason: r.reason,
    resource: { type: ref.type, id: ref.id, name: ref.name },
    hint:
      r.reason === "access_required"
        ? `Call request_access with { resource: "${ref.type}", id: "${ref.id}" } — the user will be asked to approve.`
        : r.hint,
  });
}

/**
 * Reads/writes are funnelled so every call resolves the collection (and its
 * name for the prompt) the same way and every tool returns the same structured
 * denial the model can act on (`reason: access_required` -> call request_access).
 */
function register(
  server: McpServer,
  access: McpAccess,
  port: McpPort,
  version: string
): void {
  // ---- discovery (ungated metadata) ----

  server.registerTool(
    "about",
    {
      title: "About RREQUEST",
      description:
        "Describe this RREQUEST MCP server and the active workspace. Read-only.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              name: "rrequest",
              version,
              activeWorkspaceId: port.activeWorkspaceId(),
              note: "This server manages RREQUEST collections, folders and requests only — it never sends requests. Call request_access before reading or changing a collection.",
            },
            null,
            2
          ),
        },
      ],
    })
  );

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description:
        "List RREQUEST workspaces (id, name, role). Ungated — workspaces are not collections.",
      inputSchema: {},
    },
    async () => {
      const list = await port.listWorkspaces();
      return ok(
        list.map((w) => ({
          id: w.id,
          name: w.name,
          role: w.role,
          synced: w.synced,
        }))
      );
    }
  );

  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      description:
        "List collections in the active workspace (id, name, workspaceId, requestCount). Names/ids only — call request_access before reading contents.",
      inputSchema: {},
    },
    async () => {
      const list = await port.listCollections();
      return ok(
        list.map((c) => ({
          id: c.id,
          name: c.name,
          workspaceId: c.workspaceId,
          requestCount: countRequests(c),
        }))
      );
    }
  );

  // ---- the only tool callable without a grant ----

  server.registerTool(
    "request_access",
    {
      title: "Request access to a resource",
      description:
        "Ask the user to approve access to a workspace, collection or environment. This is the only tool callable without an existing grant; call it when another tool replies with reason 'access_required'.",
      inputSchema: {
        resource: z
          .enum(["workspace", "collection", "environment"])
          .describe("Kind of resource."),
        id: z.string().optional().describe("Resource id (preferred)."),
        name: z.string().optional().describe("Resource name (if id unknown)."),
        write: z
          .boolean()
          .optional()
          .describe("Request write (edit/delete) rather than read-only."),
      },
    },
    async (args) => {
      const found = await resolveResource(
        port,
        args.resource,
        args.id,
        args.name
      );
      if ("error" in found) return fail(found.error);
      const mode: "read" | "write" = args.write ? "write" : "read";
      const already = access.has(found.ref, mode);
      const r = await access.require(found.ref, mode);
      if (!r.ok) return denyResult(found.ref, r);
      return ok({
        ok: true,
        granted: mode,
        already,
        resource: {
          type: found.ref.type,
          id: found.ref.id,
          name: found.ref.name,
        },
      });
    }
  );

  // ---- gated reads ----

  server.registerTool(
    "list_requests",
    {
      title: "List requests in a collection",
      description:
        "List the requests in a collection (http: id/name/method/url/folder; others: id/name/kind). Gated — requires read access to the collection.",
      inputSchema: {
        collectionId: z.string(),
        folderId: z.string().optional(),
      },
    },
    async (args) => {
      const ref = await collectionRef(port, args.collectionId);
      if (!ref) return fail(`No collection with id "${args.collectionId}".`);
      return gated(access, ref, "read", async () => {
        const c = (await port.getCollection(ref.id))!;
        const items = args.folderId
          ? (c.folders ?? []).find((f) => f.id === args.folderId)?.requests ??
            []
          : flattenItems(c);
        return ok(
          items.map((i) => {
            const kind = itemKind(i);
            const base = { id: i.id, name: i.name };
            return kind === "http"
              ? {
                  ...base,
                  kind,
                  method: (i as RestRequest).method,
                  url: (i as RestRequest).url,
                  folder: folderOf(c, i.id),
                }
              : { ...base, kind };
          })
        );
      });
    }
  );

  server.registerTool(
    "get_request",
    {
      title: "Get a request",
      description:
        "Return one request definition as stored. Gated — requires read access to the collection. OAuth tokens are never resolved.",
      inputSchema: {
        collectionId: z.string(),
        requestId: z.string(),
        folderId: z.string().optional(),
      },
    },
    async (args) => {
      const ref = await collectionRef(port, args.collectionId);
      if (!ref) return fail(`No collection with id "${args.collectionId}".`);
      return gated(access, ref, "read", async () => {
        const c = (await port.getCollection(ref.id))!;
        const item = findItem(c, args.folderId, args.requestId);
        if (!item)
          return fail(
            `No request with id "${args.requestId}" in collection "${ref.name}".`
          );
        return ok({ folder: folderOf(c, item.id), request: item });
      });
    }
  );

  server.registerTool(
    "list_environments",
    {
      title: "List environments",
      description:
        "List environments (id, name, variableCount, granted). Metadata only; call get_environment for values. Secret values are never returned.",
      inputSchema: {},
    },
    async () => {
      const list = await port.listEnvironments();
      return ok(
        list.map((e) => ({
          id: e.id,
          name: e.name,
          variableCount: e.variables.length,
          granted: access.has(envRef(e), "read"),
        }))
      );
    }
  );

  server.registerTool(
    "get_environment",
    {
      title: "Get an environment",
      description:
        "Return an environment's variables (non-secret values only). Gated — requires read access to that environment.",
      inputSchema: { environmentId: z.string() },
    },
    async (args) => {
      const list = await port.listEnvironments();
      const e = list.find((x) => x.id === args.environmentId);
      if (!e) return fail(`No environment with id "${args.environmentId}".`);
      const ref = envRef(e);
      return gated(access, ref, "read", async () =>
        ok({ id: e.id, name: e.name, variables: e.variables })
      );
    }
  );

  // ---- manage: collections + folders (gated workspace/collection write) ----

  server.registerTool(
    "create_collection",
    {
      title: "Create a collection",
      description:
        "Create a collection in the active workspace. Gated — requires write access to the workspace.",
      inputSchema: { name: z.string() },
    },
    (args) =>
      serial(async () => {
        const ref = await workspaceRef(port);
        if (!ref) return fail("No active workspace.");
        return gated(access, ref, "write", async () => {
          const before = new Set(
            (await port.listCollections()).map((c) => c.id)
          );
          const err = errorOf(
            await port.dispatch({ type: "createCollection", name: args.name })
          );
          if (err) return fail(err);
          const created = (await port.listCollections()).find(
            (c) => !before.has(c.id)
          );
          if (!created)
            return fail("create_collection: could not determine the new id.");
          return ok({ id: created.id, name: created.name });
        });
      })
  );

  server.registerTool(
    "rename_collection",
    {
      title: "Rename a collection",
      description:
        "Rename a collection. Gated — requires write access to the collection.",
      inputSchema: { collectionId: z.string(), name: z.string() },
    },
    (args) =>
      serial(async () => {
        const ref = await collectionRef(port, args.collectionId);
        if (!ref) return fail(`No collection with id "${args.collectionId}".`);
        return gated(access, ref, "write", async () => {
          const err = errorOf(
            await port.dispatch({
              type: "renameCollection",
              id: ref.id,
              name: args.name,
            })
          );
          return err ? fail(err) : ok({ ok: true, id: ref.id });
        });
      })
  );

  server.registerTool(
    "delete_collection",
    {
      title: "Delete a collection",
      description:
        "Move a collection to trash. Gated — requires write access to the collection.",
      inputSchema: { collectionId: z.string() },
    },
    (args) =>
      serial(async () => {
        const ref = await collectionRef(port, args.collectionId);
        if (!ref) return fail(`No collection with id "${args.collectionId}".`);
        return gated(access, ref, "write", async () => {
          const err = errorOf(
            await port.dispatch({ type: "deleteCollection", id: ref.id })
          );
          return err ? fail(err) : ok({ ok: true, id: ref.id });
        });
      })
  );

  server.registerTool(
    "create_folder",
    {
      title: "Create a folder",
      description:
        "Create a folder inside a collection. Gated — requires write access to the collection.",
      inputSchema: { collectionId: z.string(), name: z.string() },
    },
    (args) =>
      serial(async () => {
        const ref = await collectionRef(port, args.collectionId);
        if (!ref) return fail(`No collection with id "${args.collectionId}".`);
        return gated(access, ref, "write", async () => {
          const before = new Set(
            ((await port.getCollection(ref.id))?.folders ?? []).map((f) => f.id)
          );
          const err = errorOf(
            await port.dispatch({
              type: "createFolder",
              collectionId: ref.id,
              name: args.name,
            })
          );
          if (err) return fail(err);
          const created = (
            (await port.getCollection(ref.id))?.folders ?? []
          ).find((f) => !before.has(f.id));
          if (!created)
            return fail("create_folder: could not determine the new id.");
          return ok({ id: created.id, name: created.name });
        });
      })
  );

  server.registerTool(
    "rename_folder",
    {
      title: "Rename a folder",
      description:
        "Rename a folder in a collection. Gated — requires write access to the collection.",
      inputSchema: {
        collectionId: z.string(),
        folderId: z.string(),
        name: z.string(),
      },
    },
    (args) =>
      serial(async () => {
        const ref = await collectionRef(port, args.collectionId);
        if (!ref) return fail(`No collection with id "${args.collectionId}".`);
        return gated(access, ref, "write", async () => {
          const err = errorOf(
            await port.dispatch({
              type: "renameFolder",
              collectionId: ref.id,
              folderId: args.folderId,
              name: args.name,
            })
          );
          return err ? fail(err) : ok({ ok: true, id: args.folderId });
        });
      })
  );

  server.registerTool(
    "delete_folder",
    {
      title: "Delete a folder",
      description:
        "Move a folder (and its requests) to trash. Gated — requires write access to the collection.",
      inputSchema: { collectionId: z.string(), folderId: z.string() },
    },
    (args) =>
      serial(async () => {
        const ref = await collectionRef(port, args.collectionId);
        if (!ref) return fail(`No collection with id "${args.collectionId}".`);
        return gated(access, ref, "write", async () => {
          const err = errorOf(
            await port.dispatch({
              type: "deleteFolder",
              collectionId: ref.id,
              folderId: args.folderId,
            })
          );
          return err ? fail(err) : ok({ ok: true, id: args.folderId });
        });
      })
  );

  // ---- manage: requests (gated collection write) ----

  server.registerTool(
    "create_request",
    {
      title: "Create a request",
      description:
        "Create an HTTP request in a collection (or folder). Gated — requires write access to the collection. It is never sent.",
      inputSchema: {
        collectionId: z.string(),
        folderId: z.string().nullable().optional(),
        name: z.string(),
        method: z.string().optional(),
        url: z.string().optional(),
        description: z
          .string()
          .optional()
          .describe("Markdown documentation shown in the request docs pane."),
        headers: z.array(keyValueSchema()).optional(),
        params: z.array(keyValueSchema()).optional(),
        body: bodySchema().optional(),
      },
    },
    (args) =>
      serial(async () => {
        const ref = await collectionRef(port, args.collectionId);
        if (!ref) return fail(`No collection with id "${args.collectionId}".`);
        return gated(access, ref, "write", async () => {
          const request: RestRequest = {
            id: newId(),
            name: args.name,
            method: args.method ?? "GET",
            url: args.url ?? "",
            description: args.description,
            headers: args.headers ?? defaultHeaders(),
            params: args.params ?? [],
            body: args.body ?? { mode: "none" },
            auth: { type: "none" },
          };
          // saveRequest (not createRequest) on purpose: the same persistence
          // path the router uses, but without opening an editor tab.
          const err = errorOf(
            await port.dispatch({
              type: "saveRequest",
              collectionId: ref.id,
              folderId: args.folderId ?? null,
              request,
            })
          );
          return err ? fail(err) : ok({ id: request.id });
        });
      })
  );

  server.registerTool(
    "update_request",
    {
      title: "Update a request",
      description:
        "Update fields of an existing HTTP request (method/url/name/description/headers/params/body/auth). Gated — requires write access to the collection.",
      inputSchema: {
        collectionId: z.string(),
        requestId: z.string(),
        folderId: z.string().nullable().optional(),
        patch: z
          .object({
            name: z.string().optional(),
            method: z.string().optional(),
            url: z.string().optional(),
            description: z
              .string()
              .optional()
              .describe(
                "Markdown documentation for the request docs pane. Omit to leave unchanged."
              ),
            headers: z.array(keyValueSchema()).optional(),
            params: z.array(keyValueSchema()).optional(),
            body: bodySchema().optional(),
            auth: z.unknown().optional(),
          })
          .describe("Fields to merge; id/scripts/examples are preserved."),
      },
    },
    (args) =>
      serial(async () => {
        const ref = await collectionRef(port, args.collectionId);
        if (!ref) return fail(`No collection with id "${args.collectionId}".`);
        return gated(access, ref, "write", async () => {
          const c = await port.getCollection(ref.id);
          const item = c && findItem(c, args.folderId, args.requestId);
          if (!item)
            return fail(
              `No request with id "${args.requestId}" in collection "${ref.name}".`
            );
          if (itemKind(item) !== "http")
            return fail("update_request only supports HTTP requests.");
          const current = item as RestRequest;
          const next: RestRequest = {
            ...current,
            ...args.patch,
            id: current.id,
          } as RestRequest;
          const err = errorOf(
            await port.dispatch({
              type: "saveRequest",
              collectionId: ref.id,
              folderId: args.folderId ?? null,
              request: next,
            })
          );
          return err ? fail(err) : ok({ id: current.id });
        });
      })
  );

  server.registerTool(
    "rename_request",
    {
      title: "Rename a request",
      description:
        "Rename a request. Gated — requires write access to the collection.",
      inputSchema: {
        collectionId: z.string(),
        requestId: z.string(),
        folderId: z.string().nullable().optional(),
        name: z.string(),
      },
    },
    (args) =>
      serial(async () => {
        const ref = await collectionRef(port, args.collectionId);
        if (!ref) return fail(`No collection with id "${args.collectionId}".`);
        return gated(access, ref, "write", async () => {
          const err = errorOf(
            await port.dispatch({
              type: "renameRequest",
              collectionId: ref.id,
              folderId: args.folderId ?? null,
              requestId: args.requestId,
              name: args.name,
            })
          );
          return err ? fail(err) : ok({ ok: true, id: args.requestId });
        });
      })
  );

  server.registerTool(
    "delete_request",
    {
      title: "Delete a request",
      description:
        "Move a request to trash. Gated — requires write access to the collection.",
      inputSchema: {
        collectionId: z.string(),
        requestId: z.string(),
        folderId: z.string().nullable().optional(),
      },
    },
    (args) =>
      serial(async () => {
        const ref = await collectionRef(port, args.collectionId);
        if (!ref) return fail(`No collection with id "${args.collectionId}".`);
        return gated(access, ref, "write", async () => {
          const err = errorOf(
            await port.dispatch({
              type: "deleteRequest",
              collectionId: ref.id,
              folderId: args.folderId ?? null,
              requestId: args.requestId,
            })
          );
          return err ? fail(err) : ok({ ok: true, id: args.requestId });
        });
      })
  );

  server.registerTool(
    "move_request",
    {
      title: "Move a request",
      description:
        "Move a request between collections/folders. Gated — requires write access to BOTH the source and destination collections.",
      inputSchema: {
        requestId: z.string(),
        fromCollectionId: z.string(),
        fromFolderId: z.string().nullable().optional(),
        toCollectionId: z.string(),
        toFolderId: z.string().nullable().optional(),
      },
    },
    (args) =>
      serial(async () => {
        const from = await collectionRef(port, args.fromCollectionId);
        if (!from)
          return fail(`No collection with id "${args.fromCollectionId}".`);
        const to = await collectionRef(port, args.toCollectionId);
        if (!to) return fail(`No collection with id "${args.toCollectionId}".`);
        return gated(access, from, "write", () =>
          gated(access, to, "write", async () => {
            const err = errorOf(
              await port.dispatch({
                type: "moveRequest",
                fromCollectionId: from.id,
                fromFolderId: args.fromFolderId ?? null,
                toCollectionId: to.id,
                toFolderId: args.toFolderId ?? null,
                requestId: args.requestId,
              })
            );
            return err ? fail(err) : ok({ ok: true, id: args.requestId });
          })
        );
      })
  );

  // Deliberately NO send_request tool: the agent may manage resources, but the
  // user is the only one who sends. Keep it that way.
}

// ---- helpers ----

/** Serializes manage (mutating) tool calls so before/after diffs are unambiguous. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function gated(
  access: McpAccess,
  ref: ResourceRef,
  mode: "read" | "write",
  fn: () => Promise<ToolResult>
): Promise<ToolResult> {
  const r = await access.require(ref, mode);
  if (!r.ok) return denyResult(ref, r);
  return fn();
}

/** A `toast/error` reply (viewer workspace, missing collection, …) as a tool error. */
function errorOf(msgs: HostMessage[]): string | undefined {
  const t = msgs.find(
    (m) => m.type === "toast" && (m as { level?: string }).level === "error"
  );
  return t && t.type === "toast" ? t.message : undefined;
}

async function resolveResource(
  port: McpPort,
  resource: ResourceRef["type"],
  id: string | undefined,
  name: string | undefined
): Promise<{ ref: ResourceRef } | { error: string }> {
  const candidates =
    resource === "workspace"
      ? (await port.listWorkspaces()).map((w) => ({ id: w.id, name: w.name }))
      : resource === "collection"
      ? (await port.listCollections()).map((c) => ({ id: c.id, name: c.name }))
      : (await port.listEnvironments()).map((e) => ({
          id: e.id,
          name: e.name,
        }));

  const hit = id
    ? candidates.find((c) => c.id === id)
    : name
    ? candidates.find((c) => c.name.toLowerCase() === name.toLowerCase())
    : undefined;
  if (!hit) {
    return {
      error: `No ${resource} matches${
        id ? ` id "${id}"` : name ? ` name "${name}"` : ""
      }. Candidates: ${
        candidates.map((c) => `${c.name} (${c.id})`).join(", ") || "(none)"
      }`,
    };
  }
  return { ref: { type: resource, id: hit.id, name: hit.name } };
}

async function workspaceRef(port: McpPort): Promise<ResourceRef | undefined> {
  const id = port.activeWorkspaceId();
  if (!id) return undefined;
  const w = (await port.listWorkspaces()).find((x) => x.id === id);
  return { type: "workspace", id, name: w?.name ?? id };
}

async function collectionRef(
  port: McpPort,
  id: string
): Promise<ResourceRef | undefined> {
  const c = await port.getCollection(id);
  return c ? { type: "collection", id: c.id, name: c.name } : undefined;
}

function envRef(e: { id: string; name: string }): ResourceRef {
  return { type: "environment", id: e.id, name: e.name };
}

function countRequests(c: Collection): number {
  return (
    c.requests.length +
    (c.folders ?? []).reduce((n, f) => n + f.requests.length, 0)
  );
}

function flattenItems(c: Collection): CollectionItem[] {
  return [...c.requests, ...(c.folders ?? []).flatMap((f) => f.requests)];
}

function findItem(
  c: Collection,
  folderId: string | null | undefined,
  requestId: string
): CollectionItem | undefined {
  const bucket = folderId
    ? (c.folders ?? []).find((f) => f.id === folderId)?.requests
    : c.requests;
  return bucket?.find((r) => r.id === requestId);
}

function folderOf(c: Collection, requestId: string): string | null {
  const f = (c.folders ?? []).find((x) =>
    x.requests.some((r) => r.id === requestId)
  );
  return f ? f.name : null;
}

function keyValueSchema() {
  return z.object({
    key: z.string(),
    value: z.string(),
    enabled: z.boolean().default(true),
    description: z.string().optional(),
    secret: z.boolean().optional(),
  });
}

function bodySchema() {
  return z.union([
    z.object({ mode: z.literal("none") }),
    z.object({
      mode: z.literal("raw"),
      type: z.enum(["json", "text", "xml"]),
      text: z.string(),
    }),
    z.object({
      mode: z.literal("urlencoded"),
      items: z.array(keyValueSchema()),
    }),
    z.object({
      mode: z.literal("graphql"),
      query: z.string(),
      variables: z.string(),
    }),
    z.object({
      mode: z.literal("formdata"),
      items: z.array(z.any()),
    }),
  ]);
}

export function registerTools(
  server: McpServer,
  port: McpPort,
  access: McpAccess,
  meta: { version: string }
): void {
  register(server, access, port, meta.version);
}
