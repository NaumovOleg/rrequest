import * as vscode from "vscode";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import WebSocket from "ws";
import { createRouter } from "./messaging";
import { sendRequest } from "./net/http-client";
import { grpcInvoke } from "./net/grpc-client";
import { runPreScript, runTestScript } from "./scripting/sandbox";
import { CollectionStore } from "./stores/collection-store";
import { HistoryStore } from "./stores/history-store";
import { EnvironmentStore } from "./stores/environment-store";
import { WorkspaceStore } from "./stores/workspace-store";
import { TrashStore } from "./stores/trash-store";
import { parseImport, serializeExport } from "./formats/import-export";
import { Hub } from "./hub";
import { WsManager, type WsFactory } from "./net/ws-manager";
import { SseClient } from "./net/sse-client";
import { resolveOAuthToken, fetchOAuthToken, oauthTokenStatus } from "./net/oauth2";
import type { Auth } from "../shared/types";
import {
  SyncClient,
  SyncAuthError,
  SyncForbiddenError,
  SyncGoneError,
} from "./sync/sync-client";
import { SyncStateStore, type SyncState } from "./sync/sync-state-store";
import { AccountStore } from "./sync/account-store";
import { SyncManager } from "./sync/sync-manager";
import { makeToastThrottle } from "./sync/toast-throttle";
import { createPollLoop } from "./sync/poll-loop";
import { buildStoresPort } from "./sync/wiring";
import { createSyncRuntime, isMutating } from "./sync/sync-runtime";
import { signIn } from "./sync/login";
import {
  newId,
  defaultHeaders,
  type Account,
  type HostMessage,
  type RestRequest,
  type WebviewMessage,
  type Workspace,
} from "../shared/types";

export function buildHtml(
  scriptUri: string,
  styleUri: string,
  codiconUri: string,
  cspSource: string,
  nonce: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; script-src 'nonce-${nonce}'; frame-src 'self';" />
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

// The id(s) an explicit-delete message removes, so sync can prune them from the
// remote (see SyncManager.recordDeletion). Non-delete messages return [].
function deletedIdsFromMessage(msg: WebviewMessage): string[] {
  switch (msg.type) {
    case "deleteCollection":
    case "deleteEnvironment":
      return [msg.id];
    case "deleteFolder":
      return [msg.folderId];
    case "deleteRequest":
      return [msg.requestId];
    default:
      return [];
  }
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
  signOut(accountId?: string): Promise<void>;
  enable(workspaceId: string, accountId?: string): Promise<void>;
  syncNow(workspaceId: string): Promise<void>;
  syncAccount(accountId: string): Promise<void>;
  setPolling(workspaceId: string, enabled: boolean): Promise<void>;
  // Connected accounts, so the command-palette path can ask WHICH one to sync
  // to instead of giving up when more than one is signed in.
  accounts(): Account[];
  // Human-readable health report (server URL, per-account token + /me, the
  // sync state of every workspace) written to the RREQUEST output channel.
  diagnostics(): Promise<void>;
};
let syncControlRef: SyncControlPort | undefined;
export function getSyncControl(): SyncControlPort | undefined {
  return syncControlRef;
}
// Deferred like syncControlRef above: createRouter runs before the sync
// runtime exists, so deleteWorkspace's sync hook is a closure over this ref,
// assigned once the SyncManager + SyncStateStore are constructed below.
let onWorkspaceDeletedRef: ((id: string) => Promise<void>) | undefined;
// One shared output channel. Sync failures used to exist only as a webview
// toast, which is easy to miss (the accounts popup closes on the same click) and
// carries no detail — "it just went local" with nothing to go on. Everything
// interesting is logged here as well.
let logChannel: vscode.OutputChannel | undefined;
export function syncLog(): vscode.OutputChannel {
  logChannel ??= vscode.window.createOutputChannel("RREQUEST");
  return logChannel;
}
function logLine(message: string): void {
  syncLog().appendLine(`[${new Date().toISOString()}] ${message}`);
}

// Turns a sync error into something the user can act on. The raw messages
// ("unauthorized", "gone") say nothing about what to do next.
export function explainSyncError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  const message = (e as { message?: string })?.message ?? String(e);
  if (name === "SyncAuthError")
    return "your session expired — sign in again (RREQUEST: Sign in to sync)";
  if (name === "SyncForbiddenError")
    return "the server refused it — that workspace id belongs to another account";
  if (name === "SyncGoneError")
    return "the server no longer has that workspace";
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message))
    return `couldn't reach the sync server (${message})`;
  return message;
}

function ensureBootstrap(context: vscode.ExtensionContext): Promise<Hub> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const base = context.globalStorageUri.fsPath;
    const collections = new CollectionStore(base);
    const environments = new EnvironmentStore(base, context.secrets);
    const history = new HistoryStore(base);
    const workspaces = new WorkspaceStore(base);
    const trash = new TrashStore(base);

    // Always keep a local (unsynced) "Default" workspace, and default the active
    // selection to a local one — so signing in / syncing never hijacks the
    // landing view (the local workspace is the default). A fresh SyncStateStore
    // read tells us which existing workspaces are synced vs local.
    const bootStates = await new SyncStateStore(base).all();
    const isLocalWs = (w: { id: string }): boolean => !bootStates[w.id]?.synced;
    let list = await workspaces.list();
    if (!list.some(isLocalWs)) {
      const def = await workspaces.create("Default");
      list = [...list, def];
    }
    const bootActive = context.globalState.get<string>(
      "rrequest.activeWorkspaceId",
      ""
    );
    if (!list.some((w) => w.id === bootActive)) {
      const local = list.find(isLocalWs) ?? list[0];
      await context.globalState.update("rrequest.activeWorkspaceId", local.id);
    }

    // One-time onboarding sample: on a fresh install (no collections anywhere
    // and the flag unset) seed a starter collection so the first run shows
    // something to click. The flag is set on every bootstrap, so existing
    // users never get a duplicate.
    if (!context.globalState.get<boolean>("rrequest.onboarded")) {
      if ((await collections.list()).length === 0) {
        const ws = list.find(isLocalWs) ?? list[0];
        const c = await collections.createCollection("RREQUEST examples", ws.id);
        await collections.saveRequest(
          c.id,
          {
            id: newId(), name: "Fetch a todo", method: "GET",
            url: "https://jsonplaceholder.typicode.com/todos/1",
            params: [], headers: defaultHeaders(), body: { mode: "none" },
          },
          null
        );
        await collections.saveRequest(
          c.id,
          {
            id: newId(), name: "Create a post", method: "POST",
            url: "https://jsonplaceholder.typicode.com/posts",
            params: [], headers: defaultHeaders(),
            body: { mode: "raw", type: "json", text: JSON.stringify({ title: "foo", body: "bar", userId: 1 }, null, 2) },
          },
          null
        );
      }
      void context.globalState.update("rrequest.onboarded", true);
    }

    // createRouter runs before the Hub exists, so the WsManager's emit (and the
    // members port's toast-on-403) are lazily-bound closures over hubRef, which
    // is assigned right after the Hub is constructed below.
    const wsFactory: WsFactory = (url, opts) =>
      new WebSocket(url, {
        headers: opts.headers,
      }) as unknown as import("./net/ws-manager").WsSocket;
    let hubRef: Hub | undefined;
    const wsManager = new WsManager((m) => hubRef?.emitTo("ws", m), wsFactory);
    const sseClient = new SseClient((m) => hubRef?.emitTo("sse", m), fetch);

    // syncClient is constructed early (it has no Hub dependency) so the router's
    // members port can be built over it below; the rest of the sync runtime
    // (which does need the Hub) is wired up after the Hub is constructed.
    // Precedence: the user's `rrequest.syncServerUrl` setting (if they set one),
    // then the URL baked into the build (`process.env.SYNC_SERVER_URL`, injected
    // by esbuild from SYNC_SERVER_URL — unset by default). Empty = sync disabled;
    // every user-triggered sync action warns and bails until a URL is set.
    const syncBaseUrl = (): string =>
      vscode.workspace
        .getConfiguration("rrequest")
        .get<string>("syncServerUrl") ||
      process.env.SYNC_SERVER_URL ||
      "";

    // Single guard for every user-triggered sync action: no server URL -> warn
    // once (modal) and bail. Fixes every entry point at once — command palette
    // and webview both route through syncControlPort below.
    const requireServerUrl = (): boolean => {
      if (syncBaseUrl()) return true;
      const open = "Open settings";
      void vscode.window
        .showWarningMessage(
          "RREQUEST: no sync server URL configured — sync is disabled until you set your own backend. Add a \u201crrequest.syncServerUrl\u201d value (your own sync server) in settings.",
          open
        )
        .then((pick) => {
          if (pick === open)
            void vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "rrequest"
            );
        });
      return false;
    };
    // --- Multi-account sync ---
    // Several Google accounts can be connected at once; each synced workspace is
    // bound to one (SyncState.accountId). AccountStore loads cached tokens (and
    // migrates a legacy single-account session) up front, so startup's authed
    // calls resolve tokens synchronously and never send an empty Bearer.
    const accounts = new AccountStore({
      secrets: context.secrets,
      globalState: context.globalState,
    });
    await accounts.load();
    const isAuthed = (): boolean => !accounts.isEmpty();
    const currentAccounts = (): Account[] => accounts.list();
    const activeWsId = (): string =>
      context.globalState.get<string>("rrequest.activeWorkspaceId", "");

    // SyncState is read to resolve which account a workspace belongs to (by
    // clientFor / the members port), so it's constructed here rather than later.
    const syncState = new SyncStateStore(base);

    // One SyncClient per account — the account's token is baked into its
    // getToken closure. A missing accountId resolves to the sole account.
    const clientCache = new Map<string, SyncClient>();
    const clientFor = (accountId?: string): SyncClient => {
      const key = accountId ?? "__default__";
      let c = clientCache.get(key);
      if (!c) {
        c = new SyncClient({
          baseUrl: syncBaseUrl(),
          getToken: () => accounts.getToken(accountId),
        });
        clientCache.set(key, c);
      }
      return c;
    };
    const clientForWorkspace = async (id: string): Promise<SyncClient> =>
      clientFor((await syncState.get(id))?.accountId);

    const membersPort = {
      list: async (id: string) =>
        (await clientForWorkspace(id)).listMembers(id),
      add: async (id: string, email: string, role: "editor" | "viewer") => {
        try {
          await (await clientForWorkspace(id)).addMember(id, { email, role });
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
          await (await clientForWorkspace(id)).removeMember(id, memberId);
        } catch (e) {
          if (e instanceof SyncForbiddenError) {
            hubRef?.toast("error", "Only the owner can remove members.");
            return;
          }
          throw e;
        }
      },
    };

    // Tag workspaces with their sync fields. Used both by the hub snapshot and
    // by the router's immediate replies (enrichWorkspaces) so a freshly
    // created/enabled workspace shows under its account right away.
    const tagWorkspaces = (
      list: Workspace[],
      states: Record<string, SyncState>
    ): Workspace[] =>
      list.map((w) => {
        const st = states[w.id];
        return {
          ...w,
          role: isAuthed() ? syncRuntimeRef?.roleOf(w.id) : undefined,
          synced: isAuthed() ? syncRuntimeRef?.syncedOf(w.id) : undefined,
          pollEnabled: isAuthed() ? syncRuntimeRef?.pollingOf(w.id) : undefined,
          accountId: st?.accountId,
          accountEmail: accounts.emailOf(st?.accountId),
        };
      });
    const enrichWorkspaces = async (list: Workspace[]): Promise<Workspace[]> =>
      tagWorkspaces(list, isAuthed() ? await syncState.all() : {});

    const route = createRouter({
      send: sendRequest,
      timeoutMs: vscode.workspace
        .getConfiguration("rrequest")
        .get<number>("requestTimeoutMs", 30000),
      collections,
      history,
      enrichWorkspaces,
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
            `rrequest import failed: ${e?.message ?? e}`
          );
          return null;
        }
      },
      runExport: async (c, format) => {
        const suffix =
          format === "openapi"
            ? ".openapi"
            : format === "postman"
            ? ".postman"
            : "";
        const safe = (c.name || "collection").replace(/[^a-z0-9_-]+/gi, "_");
        const target = await vscode.window.showSaveDialog({
          filters: { JSON: ["json"] },
          saveLabel: "Export",
          defaultUri: vscode.Uri.file(`${safe}${suffix}.json`),
        });
        if (!target) return;
        try {
          await fs.writeFile(target.fsPath, serializeExport(c, format), "utf8");
        } catch (e: any) {
          void vscode.window.showErrorMessage(
            `rrequest export failed: ${e?.message ?? e}`
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
      // The "Read docs" button posts openDocs; the same action is also a
      // native command (RREQUEST: Open documentation).
      openDocs: () =>
        vscode.commands.executeCommand(
          "rrequest.openDocs"
        ) as Promise<void>,
      // Response body in a real editor: search, folding and highlighting for
      // free, instead of the webview's readonly <pre>.
      openTextDocument: async ({ content, language }) => {
        const doc = await vscode.workspace.openTextDocument({
          content,
          language,
        });
        void vscode.window.showTextDocument(doc, { preview: true });
      },
      // "Save response body": native save dialog, then write the (full, cached)
      // body — base64 for binary payloads, utf8 text otherwise.
      saveBodyToFile: async ({ content, isBase64, suggestName }) => {
        const safe = (suggestName || "response").replace(
          /[^a-z0-9_.-]+/gi,
          "_"
        );
        const target = await vscode.window.showSaveDialog({
          saveLabel: "Save response body",
          defaultUri: vscode.Uri.file(`${safe}.txt`),
        });
        if (!target) return null;
        try {
          await fs.writeFile(
            target.fsPath,
            content,
            isBase64 ? "base64" : "utf8"
          );
          return target.fsPath;
        } catch (e: any) {
          void vscode.window.showErrorMessage(
            `rrequest could not save the response body: ${e?.message ?? e}`
          );
          return null;
        }
      },
      ws: wsManager,
      sse: sseClient,
      grpcInvoke,
      trash,
      oauth: {
        resolve: (auth: Auth, requestId: string) =>
          resolveOAuthToken(auth as Extract<Auth, { type: "oauth2" }>, requestId, {
            secrets: context.secrets,
            openExternal: async (url: string) =>
              vscode.env.openExternal(vscode.Uri.parse(url)),
          }),
        fetch: (auth: Auth, requestId: string) =>
          fetchOAuthToken(auth as Extract<Auth, { type: "oauth2" }>, requestId, {
            secrets: context.secrets,
            openExternal: async (url: string) =>
              vscode.env.openExternal(vscode.Uri.parse(url)),
          }),
        status: (requestId: string) =>
          oauthTokenStatus(requestId, {
            secrets: context.secrets,
            openExternal: () => Promise.resolve(false),
          }),
      },
      // Only enforce a role when signed in. The role cache is loaded from the
      // on-disk sync-state, which survives sign-out; without this gate a former
      // viewer would stay locked out (and the role badge would linger) after
      // signing out, and likewise on a cold start while signed out.
      isReadOnly: (id) =>
        (isAuthed() ? syncRuntimeRef?.isReadOnly(id) : false) ?? false,
      members: membersPort,
      // syncControlPort is built after the sync runtime below (it needs manager/
      // runtime/hub, which don't exist yet at createRouter time), so this is a
      // deferred-closure thunk over syncControlRef — same pattern as isReadOnly.
syncControl: {
        signIn: () => syncControlRef!.signIn(),
        // Forward accountId — dropping it broke per-account sign-out and bound
        // enabled workspaces to the wrong/undefined account (so they never
        // pulled for the account that was actually picked).
        signOut: (accountId?: string) => syncControlRef!.signOut(accountId),
        enable: (id: string, accountId?: string) =>
          syncControlRef!.enable(id, accountId),
        syncNow: (id: string) => syncControlRef!.syncNow(id),
        syncAccount: (accountId: string) =>
          syncControlRef!.syncAccount(accountId),
        setPolling: (id: string, enabled: boolean) =>
          syncControlRef!.setPolling(id, enabled),
      },
      // best-effort: trash the Drive file + server rows for a locally-synced
      // workspace when it's deleted; never blocks the local delete (see below).
      onWorkspaceDeleted: (id: string) =>
        onWorkspaceDeletedRef?.(id) ?? Promise.resolve(),
    });

    const snapshot = async (): Promise<HostMessage[]> => {
      const ws = context.globalState.get<string>(
        "rrequest.activeWorkspaceId",
        ""
      );
      // Per-workspace sync state (which account it's bound to, etc.) for the
      // workspaces snapshot below.
      const states = isAuthed() ? await syncState.all() : {};
      const cols = (await collections.list()).filter(
        (c) => (c.workspaceId || ws) === ws
      );
      const envs = (await environments.list()).filter(
        (e) => (e.workspaceId || ws) === ws
      );
      const hist = (await history.list()).filter(
        (e) => (e.workspaceId || ws) === ws
      );
      const trashed = (await trash.list()).filter(
        (e) => (e.workspaceId || ws) === ws
      );
      return [
        { type: "tree", collections: cols },
        {
          type: "environments",
          environments: envs,
          activeId: context.globalState.get<string | null>(
            "rrequest.activeEnvId",
            null
          ),
        },
        {
          type: "workspaces",
          workspaces: tagWorkspaces(await workspaces.list(), states),
          activeId: ws,
        },
        { type: "history", entries: hist },
        { type: "trash", entries: trashed },
        { type: "authState", accounts: currentAccounts() },
      ];
    };

    const hub = new Hub(route, snapshot);
    hubRef = hub;
    // Each "open" reply gets its own editor panel (native tab). Requests are keyed
    // by request id so re-opening focuses the existing tab; env/ws are singletons.
    hub.setOpen((m) => {
      if (m.type === "openInEditor") {
        // Title = request name only; the method is shown by the colored tab
        // icon (set via setTitle from the webview). Keep this in step with
        // EditorApp's setTitle so the tab doesn't flip between "name" and
        // "METHOD name" on first open vs. re-click.
        RrequestPanel.openOrReveal(
          context,
          `req:${m.request.id}`,
          m.request.name,
          m
        );
      } else if (m.type === "openGrpcRequest") {
        RrequestPanel.openOrReveal(
          context,
          `grpc:${m.request.id}`,
          `gRPC ${m.request.name}`,
          m
        );
      } else if (m.type === "openWsRequest") {
        RrequestPanel.openOrReveal(
          context,
          `ws:${m.request.id}`,
          `WS ${m.request.name}`,
          m
        );
      } else if (m.type === "showEnvironments") {
        RrequestPanel.openOrReveal(context, "env", "Environments", m);
      } else if (m.type === "showWebSocket") {
        RrequestPanel.openOrReveal(context, "ws", "WebSocket", m);
      } else if (m.type === "showGrpc") {
        RrequestPanel.openOrReveal(context, "grpc", "gRPC", m);
      } else if (m.type === "showSse") {
        RrequestPanel.openOrReveal(context, "sse", "SSE", m);
      } else if (m.type === "showMembers") {
        RrequestPanel.openOrReveal(context, "members", "Members", m);
      }
    });

    // --- sync runtime (shares the router's stores + Hub; the account registry +
    // per-account clients + syncState were constructed earlier so the router's
    // members port could be built over them) ---
    // At most one toast per distinct message per 15s, so a flurry of failed
    // pushes/polls doesn't spam the user with a toast per workspace/attempt.
    const throttledToast = makeToastThrottle(
      (level, message) => hub.toast(level, message),
      15000
    );
    // Suppresses the "sign-in expired" toast during the background startup sweep
    // (adopt + refreshRoles) — that runs across every account/workspace and would
    // otherwise nag on every launch. A 401 during an EXPLICIT user action
    // (syncNow/enable) still toasts (throttled to once).
    let authToastSilent = false;
    // Accounts whose token the server has rejected this session. We warn ONCE
    // per account (the poll retries every 45s and would otherwise nag forever
    // while the account still shows connected). Re-signing-in an account clears
    // its flag (see signIn), so a fresh sign-in can warn again if it fails.
    const authWarned = new Set<string>();
    const manager = new SyncManager({
      clientFor,
      accounts: () => accounts.ids(),
      state: syncState,
      stores: buildStoresPort(collections, environments, workspaces),
      email: (accountId) => accounts.emailOf(accountId) ?? "me",
      isAuthed,
      hasToken: (accountId) => !!accounts.getToken(accountId),
      onAuthLost: async (accountId) => {
        // Never nag during the silent startup sweep, and only once per account.
        if (authToastSilent) return;
        const key = accountId ?? "__default__";
        if (authWarned.has(key)) return;
        authWarned.add(key);
        const email = accounts.emailOf(accountId);
        throttledToast(
          "error",
          email
            ? `Sync sign-in for ${email} expired — sign in with that account again to resume syncing.`
            : "A sync sign-in expired — sign in again to resume syncing."
        );
      },
      onSyncError: (_workspaceId, error) => {
        if (error instanceof SyncGoneError) {
          throttledToast(
            "info",
            "This workspace was deleted by its owner; your local copy was kept."
          );
        } else {
          throttledToast(
            "error",
            "Could not reach the sync server; will retry."
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
      // Explicit deletes are recorded so the next push prunes them from the
      // remote (sync is otherwise a pure union that never drops remote data).
      const del = deletedIdsFromMessage(msg);
      if (del.length) manager.recordDeletion(del, activeWsId());
      // Renaming a workspace must push THAT workspace (its name lives in the
      // snapshot / Drive file), not the active one.
      if (msg.type === "renameWorkspace") {
        runtime.schedulePush(msg.id);
        return;
      }
      // Moving a collection touches two workspaces: the source loses it (a
      // tombstone scoped to that workspace only, so the destination push keeps
      // it) and the destination gains it. Both need a push.
      if (msg.type === "moveCollection") {
        manager.clearDeletion([msg.id], msg.toWorkspaceId);
        manager.recordDeletion([msg.id], activeWsId());
        runtime.schedulePush(activeWsId());
        runtime.schedulePush(msg.toWorkspaceId);
        return;
      }
      if (isMutating(msg.type)) runtime.schedulePush(activeWsId());
    });
    syncRuntimeRef = runtime;
    void runtime.refreshRoleCache();
    // On startup with an existing session, adopt server workspaces (pull their
    // content down) so collections appear without an explicit sign-in, then
    // refresh roles + repaint. Gated on a loaded token (see isAuthed).
    if (isAuthed()) {
      hub.syncStatus(true);
      authToastSilent = true;
      void manager
        .adoptRemoteWorkspaces()
        .then(() => manager.refreshRoles())
        .then(() => runtime.refreshRoleCache())
        .then(() => runtime.refresh())
        .finally(() => {
          hub.syncStatus(false);
          authToastSilent = false;
        });
    }
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
      listWorkspaces: async () => {
        // Aggregate across every connected account so a workspace on any of
        // them is polled; pullIfNewer resolves each workspace's own account.
        const out: { id: string; revision: string }[] = [];
        for (const accountId of accounts.ids()) {
          try {
            for (const w of await clientFor(accountId).listWorkspaces()) {
              out.push({ id: w.id, revision: w.revision });
            }
          } catch {
            /* skip a failing account this tick */
          }
        }
        return out;
      },
      state: syncState,
      pullIfNewer: (id, revision) => manager.pullIfNewer(id, revision),
      isAuthed,
      onPulled: async () => {
        await runtime.refreshRoleCache();
        await hub.refresh();
      },
      intervalMs: pollIntervalMs,
    });
    pollLoop.start();

    const syncControlPort: SyncControlPort = {
      accounts: currentAccounts,
      // "It just went local" is unactionable without knowing WHICH leg failed.
      // This probes each one and dumps the result into the output channel.
      diagnostics: async () => {
        const out = syncLog();
        out.show(true);
        logLine("--- sync diagnostics ---");
        logLine(`server: ${syncBaseUrl()}`);
        const list = accounts.list();
        logLine(
          `accounts: ${
            list.length
              ? list.map((a) => a.email).join(", ")
              : "(none — sign in first)"
          }`
        );
        for (const a of list) {
          const token = accounts.getToken(a.id);
          if (!token) {
            logLine(`  ${a.email}: NO TOKEN in secret storage — sign in again`);
            continue;
          }
          try {
            const me = await clientFor(a.id).me();
            logLine(`  ${a.email}: token ok, /me -> ${me.email} (${me.id})`);
          } catch (e) {
            logLine(`  ${a.email}: /me FAILED: ${explainSyncError(e)}`);
            continue;
          }
          try {
            const remotes = await clientFor(a.id).listWorkspaces();
            logLine(
              `  ${a.email}: ${remotes.length} workspace(s) on the server`
            );
          } catch (e) {
            logLine(
              `  ${a.email}: listWorkspaces FAILED: ${explainSyncError(e)}`
            );
          }
        }
        const states = await syncState.all();
        for (const w of await workspaces.list()) {
          const st = states[w.id];
          logLine(
            `workspace ${w.name} (${w.id}): ${
              st?.synced
                ? `synced -> ${
                    accounts.emailOf(st.accountId) ??
                    st.accountId ??
                    "unbound account"
                  } (${st.role})`
                : "local"
            }`
          );
        }
        logLine("--- end diagnostics ---");
      },
      // Each control ends with runtime.refresh() (= hub.refresh, re-broadcast the
      // snapshot) so the UI updates even on the command-palette path, which calls
      // the port directly rather than through hub.dispatch (which broadcasts on
      // its own). Idempotent double-broadcast on the webview path is harmless.
      // signIn ADDS a Google account (multiple can be connected). The browser
      // OAuth flow decides which account; we identify it via /me and register it.
      signIn: async () => {
        if (!requireServerUrl()) return;
        const token = await signIn({
          baseUrl: syncBaseUrl(),
          openExternal: (u) =>
            void vscode.env.openExternal(vscode.Uri.parse(u)),
        });
        try {
          const who = new SyncClient({
            baseUrl: syncBaseUrl(),
            getToken: () => token,
          });
          const me = await who.me();
          await accounts.add({ id: me.id, email: me.email }, token);
          authWarned.delete(me.id); // fresh token -> allow a future warning again
          clientCache.delete(me.id);
          clientCache.delete("__default__");
          hub.authState(currentAccounts());
          // Pull every account's workspaces down (adopt is read-only + union — no
          // wipe), each bound to its owning account.
          hub.syncStatus(true);
          const res = await manager.adoptRemoteWorkspaces();
          await runtime.refreshRoleCache();
          if (res.adopted.length) {
            // Keep the active workspace on the local Default — don't auto-jump
            // into a synced workspace after signing in.
            hub.toast("info", `Pulled ${res.adopted.length} workspace(s).`);
          } else if (res.error) {
            hub.toast("error", `Couldn't fetch your workspaces: ${res.error}`);
          } else if (res.failed > 0) {
            hub.toast(
              "error",
              `Found ${res.failed} workspace(s) but couldn't read their Drive files.`
            );
          }
        } catch (e: any) {
          hub.toast("error", `Sign-in failed: ${e?.message ?? e}`);
        }
        hub.syncStatus(false);
        await runtime.refresh();
      },
      // signOut removes ONE account and drops sync on its workspaces (local data
      // kept). No accountId -> remove the sole account (single-account case).
      signOut: async (accountId?: string) => {
        const id =
          accountId ??
          (accounts.ids().length === 1 ? accounts.ids()[0] : undefined);
        if (!id) return;
        await accounts.remove(id);
        clientCache.delete(id);
        clientCache.delete("__default__");
        for (const [wsId, st] of Object.entries(await syncState.all())) {
          if (st.accountId === id && st.synced)
            await syncState.set(wsId, { ...st, synced: false });
        }
        await runtime.refreshRoleCache();
        hub.authState(currentAccounts());
        await runtime.refresh();
      },
      enable: async (id: string, accountId?: string) => {
        if (!requireServerUrl()) return;
        const acct =
          accountId ??
          (accounts.ids().length === 1 ? accounts.ids()[0] : undefined);
        if (!acct) {
          hub.toast(
            "error",
            accounts.isEmpty()
              ? "Sign in with Google first."
              : "Choose an account to sync this workspace."
          );
          return;
        }
        const email = accounts.emailOf(acct) ?? acct;
        // A workspace that fails to sync is left local on purpose (its data is
        // safe either way) — but the user asked for a synced one, so say so
        // loudly: a native notification (the webview toast is easy to miss,
        // the accounts popup closes on the same click) plus the full error in
        // the RREQUEST output channel.
        const failed = (reason: string, raw?: unknown): void => {
          logLine(
            `enable(${id}) -> ${email} FAILED: ${reason}${
              raw ? `\n${(raw as Error)?.stack ?? String(raw)}` : ""
            }`
          );
          const msg = `RREQUEST: couldn't sync this workspace to ${email} — ${reason}. It stayed local; use “Sync to account” on the workspace to retry.`;
          hub.toast("error", msg);
          // A stored token that the server rejects looks identical to being
          // signed in (the account list lives in globalState and is never
          // revalidated), so offer the fix inline rather than just naming it.
          const isAuth = (raw as { name?: string })?.name === "SyncAuthError";
          const actions = isAuth ? ["Sign in again", "Show log"] : ["Show log"];
          void vscode.window.showErrorMessage(msg, ...actions).then((pick) => {
            if (pick === "Show log") syncLog().show(true);
            if (pick === "Sign in again") void syncControlRef?.signIn();
          });
        };
        if (!accounts.getToken(acct)) {
          failed(
            "no saved credentials for that account — sign in again",
            new SyncAuthError()
          );
          return;
        }
        try {
          logLine(`enable(${id}) -> ${email} via ${syncBaseUrl()}`);
          await manager.enable(id, acct);
          await runtime.refreshRoleCache();
          await runtime.refresh();
          // manager.enable can also bail without throwing, which used to leave
          // the workspace sitting in "Local" with no explanation at all.
          if (!(await syncState.get(id))?.synced) {
            failed("the server accepted nothing back");
            return;
          }
          logLine(`enable(${id}) -> ${email} OK`);
        } catch (e: any) {
          failed(explainSyncError(e), e);
        }
      },
      syncNow: async (id: string) => {
        if (!requireServerUrl()) return;
        hub.syncStatus(true, { kind: "workspace", id });
        try {
          await manager.pull(id);
          await manager.push(id);
          await runtime.refreshRoleCache();
          await runtime.refresh();
          hub.toast("info", "Sync completed.");
        } catch (e: any) {
          hub.toast("error", `Sync failed: ${e?.message ?? e}`);
        } finally {
          hub.syncStatus(false, { kind: "workspace", id });
        }
      },
      // Force sync ONE account now: re-index its Drive (recover) + pull every
      // workspace bound to it, without waiting for the poll loop.
      syncAccount: async (accountId: string) => {
        if (!requireServerUrl()) return;
        const email = accounts.emailOf(accountId) ?? "account";
        hub.syncStatus(true, { kind: "account", id: accountId });
        try {
          const res = await manager.adoptRemoteWorkspaces(accountId);
          await runtime.refreshRoleCache();
          if (res.error)
            hub.toast("error", `Couldn't fetch ${email}: ${res.error}`);
          else if (res.listed === 0)
            hub.toast("info", `${email}: no workspaces on the server.`);
          else
            hub.toast(
              "info",
              `${email}: synced ${res.adopted.length}/${res.listed} workspace(s).`
            );
        } catch (e: any) {
          hub.toast("error", `Force sync failed: ${e?.message ?? e}`);
        }
        hub.syncStatus(false, { kind: "account", id: accountId });
        await runtime.refresh();
      },
      // Pause/resume only the background poll for ONE workspace. Pushes keep
      // working either way — they're triggered by local edits, not the poll.
      setPolling: async (workspaceId: string, enabled: boolean) => {
        await manager.setPolling(workspaceId, enabled);
        await runtime.refreshRoleCache();
        await runtime.refresh();
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
      { type: "openInEditor", request: req }
    );
  }

  static openOrReveal(
    context: vscode.ExtensionContext,
    key: string,
    title: string,
    initial?: HostMessage
  ) {
    const existing = RrequestPanel.panels.get(key);
    if (existing) {
      // Don't overwrite the title on reveal — the webview owns it (name +
      // method icon + unsaved dot) via setTitle. Re-setting it here made the
      // tab flip to "METHOD name" and dropped the ● dot on re-click.
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
      }
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
    key: string
  ) {
    const scriptUri = panel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "media", "editor.js")
      )
      .toString();
    const styleUri = panel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "media", "editor.css")
      )
      .toString();
    const codiconUri = panel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "media", "codicon.css")
      )
      .toString();
    panel.webview.html = buildHtml(
      scriptUri,
      styleUri,
      codiconUri,
      panel.webview.cspSource,
      nonce()
    );
    // Tab icon per panel kind (request / gRPC / WebSocket / environments).
    const iconBase = key.startsWith("grpc")
      ? "icon-grpc"
      : key.startsWith("ws") || key.startsWith("sse")
      ? "icon-ws"
      : key === "env"
      ? "icon-env"
      : "icon-request";
    panel.iconPath = {
      light: vscode.Uri.joinPath(
        context.extensionUri,
        "resources",
        `${iconBase}-light.svg`
      ),
      dark: vscode.Uri.joinPath(
        context.extensionUri,
        "resources",
        `${iconBase}-dark.svg`
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
            `icon-${msg.icon}.svg`
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
