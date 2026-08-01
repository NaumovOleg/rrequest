import * as vscode from "vscode";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import WebSocket from "ws";
import { createRouter } from "./messaging";
import { sendRequest } from "./http-client";
import { grpcInvoke } from "./grpc-client";
import { runPreScript, runTestScript } from "./sandbox";
import { CollectionStore } from "./collection-store";
import { HistoryStore } from "./history-store";
import { EnvironmentStore } from "./environment-store";
import { WorkspaceStore } from "./workspace-store";
import { TrashStore } from "./trash-store";
import { parseImport, serializeExport } from "./import-export";
import { Hub } from "./hub";
import { WsManager, type WsFactory } from "./ws-manager";
import {
  SyncClient,
  SyncForbiddenError,
  SyncGoneError,
} from "./sync/sync-client";
import { SyncStateStore } from "./sync/sync-state-store";
import { SyncManager } from "./sync/sync-manager";
import { makeToastThrottle } from "./sync/toast-throttle";
import { createPollLoop } from "./sync/poll-loop";
import { buildStoresPort } from "./sync/wiring";
import { createSyncRuntime, isMutating } from "./sync/sync-runtime";
import { signIn } from "./sync/login";
import {
  newId,
  defaultHeaders,
  type HostMessage,
  type RestRequest,
  type WebviewMessage,
} from "../shared/types";

export function buildHtml(
  scriptUri: string,
  styleUri: string,
  codiconUri: string,
  cspSource: string,
  nonce: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <link rel="stylesheet" href="${codiconUri}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function nonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

// Shared host bootstrap: builds the stores, ensures a Default workspace + an
// active workspace id exist, constructs the router with ALL deps (including the
// dialog impls used by both surfaces), builds a snapshot() that returns the
// workspace-filtered tree + environments + workspaces + history, and creates a
// singleton Hub shared by both the editor panel and the sidebar view.
let bootstrapPromise: Promise<Hub> | undefined;
let syncRuntimeRef: ReturnType<typeof createSyncRuntime> | undefined;
export function getSyncRuntime():
  | ReturnType<typeof createSyncRuntime>
  | undefined {
  return syncRuntimeRef;
}
type SyncControlPort = {
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  enable(workspaceId: string): Promise<void>;
  syncNow(workspaceId: string): Promise<void>;
};
let syncControlRef: SyncControlPort | undefined;
export function getSyncControl(): SyncControlPort | undefined {
  return syncControlRef;
}
// Deferred like syncControlRef above: createRouter runs before the sync
// runtime exists, so deleteWorkspace's sync hook is a closure over this ref,
// assigned once the SyncManager + SyncStateStore are constructed below.
let onWorkspaceDeletedRef: ((id: string) => Promise<void>) | undefined;
function ensureBootstrap(context: vscode.ExtensionContext): Promise<Hub> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const base = context.globalStorageUri.fsPath;
    const collections = new CollectionStore(base);
    const environments = new EnvironmentStore(base);
    const history = new HistoryStore(base);
    const workspaces = new WorkspaceStore(base);
    const trash = new TrashStore(base);

    // ensure a Default workspace + active id
    let list = await workspaces.list();
    if (list.length === 0) {
      const def = await workspaces.create("Default");
      list = [def];
    }
    if (!context.globalState.get<string>("rrequest.activeWorkspaceId")) {
      await context.globalState.update(
        "rrequest.activeWorkspaceId",
        list[0].id,
      );
    }

    // createRouter runs before the Hub exists, so the WsManager's emit (and the
    // members port's toast-on-403) are lazily-bound closures over hubRef, which
    // is assigned right after the Hub is constructed below.
    const wsFactory: WsFactory = (url, opts) =>
      new WebSocket(url, {
        headers: opts.headers,
      }) as unknown as import("./ws-manager").WsSocket;
    let hubRef: Hub | undefined;
    const wsManager = new WsManager((m) => hubRef?.emitTo("ws", m), wsFactory);

    // syncClient is constructed early (it has no Hub dependency) so the router's
    // members port can be built over it below; the rest of the sync runtime
    // (which does need the Hub) is wired up after the Hub is constructed.
    const syncBaseUrl = (): string =>
      vscode.workspace
        .getConfiguration("rrequest")
        .get<string>(
          "syncServerUrl",
          "https://slgvpoiwdpzymrlg6iu4zbowea0yneyw.lambda-url.eu-west-1.on.aws/api",
        );
    let cachedToken: string | undefined;
    void context.secrets.get("rrequest.syncToken").then((t) => {
      cachedToken = t ?? undefined;
    });
    context.secrets.onDidChange(async (e) => {
      if (e.key === "rrequest.syncToken")
        cachedToken =
          (await context.secrets.get("rrequest.syncToken")) ?? undefined;
    });
    const currentAuthEmail = (): string | null =>
      cachedToken
        ? (context.globalState.get<string>("rrequest.syncEmail") ?? null)
        : null;
    const activeWsId = (): string =>
      context.globalState.get<string>("rrequest.activeWorkspaceId", "");

    const syncClient = new SyncClient({
      baseUrl: syncBaseUrl(),
      getToken: () => cachedToken,
    });
    const membersPort = {
      list: (id: string) => syncClient.listMembers(id),
      add: async (id: string, email: string, role: "editor" | "viewer") => {
        try {
          await syncClient.addMember(id, { email, role });
        } catch (e) {
          if (e instanceof SyncForbiddenError) {
            hubRef?.toast("error", "Only the owner can add members.");
            return;
          }
          throw e;
        }
      },
      remove: async (id: string, memberId: string) => {
        try {
          await syncClient.removeMember(id, memberId);
        } catch (e) {
          if (e instanceof SyncForbiddenError) {
            hubRef?.toast("error", "Only the owner can remove members.");
            return;
          }
          throw e;
        }
      },
    };

    const route = createRouter({
      send: sendRequest,
      collections,
      history,
      environments,
      getActiveEnvId: () =>
        context.globalState.get<string | null>("rrequest.activeEnvId", null),
      setActiveEnvId: (id) => {
        void context.globalState.update("rrequest.activeEnvId", id);
      },
      workspaces,
      getActiveWorkspaceId: () =>
        context.globalState.get<string>("rrequest.activeWorkspaceId", ""),
      setActiveWorkspaceId: (id) => {
        void context.globalState.update("rrequest.activeWorkspaceId", id);
      },
      runPreScript,
      runTestScript,
      openImport: async () => {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { JSON: ["json"] },
        });
        if (!picked || !picked[0]) return null;
        try {
          const text = await fs.readFile(picked[0].fsPath, "utf8");
          return parseImport(text);
        } catch (e: any) {
          void vscode.window.showErrorMessage(
            `rrequest import failed: ${e?.message ?? e}`,
          );
          return null;
        }
      },
      runExport: async (c, format) => {
        const target = await vscode.window.showSaveDialog({
          filters: { JSON: ["json"] },
          saveLabel: "Export",
        });
        if (!target) return;
        try {
          await fs.writeFile(target.fsPath, serializeExport(c, format), "utf8");
        } catch (e: any) {
          void vscode.window.showErrorMessage(
            `rrequest export failed: ${e?.message ?? e}`,
          );
        }
      },
      pickFile: async () => {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
        });
        if (!picked || !picked[0]) return null;
        const p = picked[0].fsPath;
        return { path: p, filename: p.split(/[\\/]/).pop() ?? p };
      },
      ws: wsManager,
      grpcInvoke,
      trash,
      // Only enforce a role when signed in. The role cache is loaded from the
      // on-disk sync-state, which survives sign-out; without this gate a former
      // viewer would stay locked out (and the role badge would linger) after
      // signing out, and likewise on a cold start while signed out.
      isReadOnly: (id) =>
        (cachedToken ? syncRuntimeRef?.isReadOnly(id) : false) ?? false,
      members: membersPort,
      // syncControlPort is built after the sync runtime below (it needs manager/
      // runtime/hub, which don't exist yet at createRouter time), so this is a
      // deferred-closure thunk over syncControlRef — same pattern as isReadOnly.
      syncControl: {
        signIn: () => syncControlRef!.signIn(),
        signOut: () => syncControlRef!.signOut(),
        enable: (id: string) => syncControlRef!.enable(id),
        syncNow: (id: string) => syncControlRef!.syncNow(id),
      },
      // best-effort: trash the Drive file + server rows for a locally-synced
      // workspace when it's deleted; never blocks the local delete (see below).
      onWorkspaceDeleted: (id: string) =>
        onWorkspaceDeletedRef?.(id) ?? Promise.resolve(),
    });

    const snapshot = async (): Promise<HostMessage[]> => {
      const ws = context.globalState.get<string>(
        "rrequest.activeWorkspaceId",
        "",
      );
      const cols = (await collections.list()).filter(
        (c) => (c.workspaceId || ws) === ws,
      );
      const envs = (await environments.list()).filter(
        (e) => (e.workspaceId || ws) === ws,
      );
      const hist = (await history.list()).filter(
        (e) => (e.workspaceId || ws) === ws,
      );
      const trashed = (await trash.list()).filter(
        (e) => (e.workspaceId || ws) === ws,
      );
      return [
        { type: "tree", collections: cols },
        {
          type: "environments",
          environments: envs,
          activeId: context.globalState.get<string | null>(
            "rrequest.activeEnvId",
            null,
          ),
        },
        {
          type: "workspaces",
          workspaces: (await workspaces.list()).map((w) => ({
            ...w,
            role: cachedToken ? syncRuntimeRef?.roleOf(w.id) : undefined,
            synced: cachedToken ? syncRuntimeRef?.syncedOf(w.id) : undefined,
          })),
          activeId: ws,
        },
        { type: "history", entries: hist },
        { type: "trash", entries: trashed },
        { type: "authState", email: currentAuthEmail() },
      ];
    };

    const hub = new Hub(route, snapshot);
    hubRef = hub;
    // Each "open" reply gets its own editor panel (native tab). Requests are keyed
    // by request id so re-opening focuses the existing tab; env/ws are singletons.
    hub.setOpen((m) => {
      if (m.type === "openInEditor") {
        RrequestPanel.openOrReveal(
          context,
          `req:${m.request.id}`,
          `${m.request.method} ${m.request.name}`,
          m,
        );
      } else if (m.type === "openGrpcRequest") {
        RrequestPanel.openOrReveal(
          context,
          `grpc:${m.request.id}`,
          `gRPC ${m.request.name}`,
          m,
        );
      } else if (m.type === "openWsRequest") {
        RrequestPanel.openOrReveal(
          context,
          `ws:${m.request.id}`,
          `WS ${m.request.name}`,
          m,
        );
      } else if (m.type === "showEnvironments") {
        RrequestPanel.openOrReveal(context, "env", "Environments", m);
      } else if (m.type === "showWebSocket") {
        RrequestPanel.openOrReveal(context, "ws", "WebSocket", m);
      } else if (m.type === "showGrpc") {
        RrequestPanel.openOrReveal(context, "grpc", "gRPC", m);
      } else if (m.type === "showMembers") {
        RrequestPanel.openOrReveal(context, "members", "Members", m);
      }
    });

    // --- sync runtime (shares the router's stores + Hub; syncClient itself was
    // constructed earlier so the router's members port could be built over it) ---
    const syncState = new SyncStateStore(base);
    // Shared by signOut and onAuthLost below: forgets the cached/stored token +
    // remembered email. signOut is a user action (no toast); onAuthLost fires
    // when the JWT/refresh token was invalidated server-side and additionally
    // toasts so the user knows why they were signed out.
    const clearSyncAuth = async (): Promise<void> => {
      await context.secrets.delete("rrequest.syncToken");
      cachedToken = undefined;
      await context.globalState.update("rrequest.syncEmail", undefined);
    };
    // At most one toast per distinct message per 15s, so a flurry of failed
    // pushes/polls doesn't spam the user with a toast per workspace/attempt.
    const throttledToast = makeToastThrottle(
      (level, message) => hub.toast(level, message),
      15000,
    );
    const manager = new SyncManager({
      client: syncClient,
      state: syncState,
      stores: buildStoresPort(collections, environments, workspaces),
      email: () => context.globalState.get<string>("rrequest.syncEmail", "me"),
      onAuthLost: async () => {
        await clearSyncAuth();
        hub.authState(null);
        hub.toast("error", "Sync sign-in expired — please sign in again.");
      },
      onSyncError: (_workspaceId, error) => {
        if (error instanceof SyncGoneError) {
          throttledToast(
            "info",
            "This workspace was deleted by its owner; your local copy was kept.",
          );
        } else {
          throttledToast(
            "error",
            "Could not reach the sync server; will retry.",
          );
        }
      },
    });
    const runtime = createSyncRuntime({
      manager,
      state: syncState,
      onPulled: async () => {
        await hub.refresh();
      },
    });
    hub.setAfterDispatch((msg) => {
      if (isMutating(msg.type)) runtime.schedulePush(activeWsId());
    });
    syncRuntimeRef = runtime;
    void runtime.refreshRoleCache();
    void manager.refreshRoles().then(() => runtime.refreshRoleCache());
    // Owner-delete: when a locally-synced workspace is deleted, also trash the
    // Drive file + server rows (best-effort — deleteSync already swallows its
    // own errors via onSyncError and never throws, so the local delete in
    // messaging.ts's deleteWorkspace case is never blocked by this).
    onWorkspaceDeletedRef = async (id: string) => {
      const state = await syncState.get(id);
      if (state?.synced) await manager.deleteSync(id);
    };

    // The serverless backend has no WebSocket push channel, so the extension
    // polls listWorkspaces() periodically and pulls any workspace whose server
    // revision has moved past what we last saw (only for workspaces we've
    // enabled sync on locally).
    const pollIntervalMs = vscode.workspace
      .getConfiguration("rrequest")
      .get<number>("syncPollIntervalMs", 45000);
    const pollLoop = createPollLoop({
      listWorkspaces: () => syncClient.listWorkspaces(),
      state: syncState,
      pullIfNewer: (id, revision) => manager.pullIfNewer(id, revision),
      onPulled: async () => {
        await runtime.refreshRoleCache();
        await hub.refresh();
      },
      intervalMs: pollIntervalMs,
    });
    pollLoop.start();

    const syncControlPort: SyncControlPort = {
      // Each control ends with runtime.refresh() (= hub.refresh, re-broadcast the
      // snapshot) so the UI updates even on the command-palette path, which calls
      // the port directly rather than through hub.dispatch (which broadcasts on
      // its own). Idempotent double-broadcast on the webview path is harmless.
      signIn: async () => {
        const token = await signIn({
          baseUrl: syncBaseUrl(),
          openExternal: (u) =>
            void vscode.env.openExternal(vscode.Uri.parse(u)),
        });
        cachedToken = token;
        await context.secrets.store("rrequest.syncToken", token);
        try {
          const me = await syncClient.me();
          await context.globalState.update("rrequest.syncEmail", me.email);
          hub.authState(me.email);
        } catch {
          hub.authState(null);
        }
        await runtime.refresh();
      },
      signOut: async () => {
        await clearSyncAuth();
        await runtime.refreshRoleCache();
        hub.authState(null);
        await runtime.refresh();
      },
      enable: async (id: string) => {
        try {
          await manager.enable(id);
          await runtime.refreshRoleCache();
          await runtime.refresh();
        } catch (e: any) {
          hub.toast("error", `Enable sync failed: ${e?.message ?? e}`);
        }
      },
      syncNow: async (id: string) => {
        try {
          await manager.pull(id);
          await manager.push(id);
          await runtime.refreshRoleCache();
          await runtime.refresh();
        } catch (e: any) {
          hub.toast("error", `Sync failed: ${e?.message ?? e}`);
        }
      },
    };
    syncControlRef = syncControlPort;

    return hub;
  })();
  bootstrapPromise.catch(() => {
    bootstrapPromise = undefined;
  });
  return bootstrapPromise;
}

export { ensureBootstrap };

function blankRequest(): RestRequest {
  return {
    id: newId(),
    name: "Untitled",
    method: "GET",
    url: "",
    params: [],
    headers: defaultHeaders(),
    cookies: [],
    body: { mode: "none" },
    preRequestScript: "",
    testScript: "",
  };
}

/**
 * One WebviewPanel per open thing (request/env/ws), keyed so re-opening focuses
 * the existing native tab instead of spawning a duplicate. Each panel registers
 * its own hub sink under its key, so responses route back to the panel that
 * sent the request. A per-panel pending queue holds the initial message until
 * the webview's sink registers (fixing the first-open race).
 */
export class RrequestPanel {
  private static panels = new Map<string, RrequestPanel>();

  private readonly pending: HostMessage[] = [];
  private registered = false;
  private disposed = false;
  private unregister?: () => void;

  // Command entry point: open a fresh blank request in its own tab.
  static createOrShow(context: vscode.ExtensionContext) {
    const req = blankRequest();
    RrequestPanel.openOrReveal(
      context,
      `req:${req.id}`,
      `${req.method} ${req.name}`,
      { type: "openInEditor", request: req },
    );
  }

  static openOrReveal(
    context: vscode.ExtensionContext,
    key: string,
    title: string,
    initial?: HostMessage,
  ) {
    const existing = RrequestPanel.panels.get(key);
    if (existing) {
      existing.panel.title = title;
      existing.panel.reveal();
      if (initial) existing.deliver(initial);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "rrequest",
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "media"),
        ],
      },
    );
    const rp = new RrequestPanel(panel, context, key);
    if (initial) rp.pending.push(initial);
    RrequestPanel.panels.set(key, rp);
  }

  private deliver(m: HostMessage) {
    if (this.registered) void this.panel.webview.postMessage(m);
    else this.pending.push(m);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    key: string,
  ) {
    const scriptUri = panel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "media", "editor.js"),
      )
      .toString();
    const styleUri = panel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "media", "editor.css"),
      )
      .toString();
    const codiconUri = panel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "media", "codicon.css"),
      )
      .toString();
    panel.webview.html = buildHtml(
      scriptUri,
      styleUri,
      codiconUri,
      panel.webview.cspSource,
      nonce(),
    );
    // Tab icon per panel kind (request / gRPC / WebSocket / environments).
    const iconBase = key.startsWith("grpc")
      ? "icon-grpc"
      : key.startsWith("ws")
        ? "icon-ws"
        : key === "env"
          ? "icon-env"
          : "icon-request";
    panel.iconPath = {
      light: vscode.Uri.joinPath(
        context.extensionUri,
        "resources",
        `${iconBase}-light.svg`,
      ),
      dark: vscode.Uri.joinPath(
        context.extensionUri,
        "resources",
        `${iconBase}-dark.svg`,
      ),
    };

    void ensureBootstrap(context).then((hub) => {
      // If the panel was disposed before bootstrap resolved, do not register a
      // sink to an already-dead webview (it would never be cleaned up).
      if (this.disposed) return;
      this.unregister = hub.register(key, (m) => {
        void panel.webview.postMessage(m);
      });
      this.registered = true;
      for (const m of this.pending) void panel.webview.postMessage(m);
      this.pending.length = 0;
    });
    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      // Reflect the request's method + name (and per-method icon) on the tab.
      if (msg.type === "setTitle") {
        panel.title = msg.title || "RREQUEST";
        if (msg.icon)
          panel.iconPath = vscode.Uri.joinPath(
            context.extensionUri,
            "resources",
            `icon-${msg.icon}.svg`,
          );
        return;
      }
      const hub = await ensureBootstrap(context);
      await hub.dispatch(key, msg);
    });

    panel.onDidDispose(() => {
      this.disposed = true;
      this.unregister?.();
      RrequestPanel.panels.delete(key);
    });
  }
}
