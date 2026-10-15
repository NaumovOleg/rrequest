import type {
  Collection,
  Environment,
  HostMessage,
  WebviewMessage,
  Workspace,
} from "../../shared/types";
import type { CollectionStore } from "../stores/collection-store";
import type { EnvironmentStore } from "../stores/environment-store";
import type { WorkspaceStore } from "../stores/workspace-store";

/**
 * The data/action surface the MCP server sees. Deliberately tiny and
 * vscode-free so it can be unit-tested and so MCP can never do anything the
 * webview can't: reads go straight to the stores, writes go back through the
 * router via `dispatch` (same read-only guard, sync push, trash, broadcast).
 *
 * No `sendRequest` here on purpose: the agent manages resources, the user sends.
 */
export type McpPort = {
  listWorkspaces(): Promise<Workspace[]>;
  listCollections(): Promise<Collection[]>;
  getCollection(id: string): Promise<Collection | undefined>;
  listEnvironments(): Promise<Environment[]>;
  activeWorkspaceId(): string;
  dispatch(msg: WebviewMessage): Promise<HostMessage[]>;
};

export type McpPortDeps = {
  collections: CollectionStore;
  environments: EnvironmentStore;
  workspaces: WorkspaceStore;
  getActiveWorkspaceId: () => string;
  dispatch: (msg: WebviewMessage) => Promise<HostMessage[]>;
};

export function buildMcpPort(deps: McpPortDeps): McpPort {
  return {
    listWorkspaces: () => deps.workspaces.list(),
    listCollections: () => deps.collections.list(),
    getCollection: async (id) =>
      (await deps.collections.list()).find((c) => c.id === id),
    listEnvironments: async () =>
      (await deps.environments.list()).map(redactEnvironment),
    activeWorkspaceId: () => deps.getActiveWorkspaceId(),
    dispatch: (msg) => deps.dispatch(msg),
  };
}

// EnvironmentStore hydrates secret values back out of VS Code Secret Storage for
// UI use; MCP must never hand those to an agent, so blank them here (keeping the
// `secret` flag so the agent still knows a variable exists). Mirrors how sync
// strips secret values from the snapshot.
function redactEnvironment(e: Environment): Environment {
  return {
    ...e,
    variables: e.variables.map((v) => (v.secret ? { ...v, value: "" } : v)),
  };
}
