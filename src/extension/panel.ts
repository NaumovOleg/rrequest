import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import WebSocket from 'ws'
import { createRouter } from './messaging'
import { sendRequest } from './http-client'
import { grpcInvoke } from './grpc-client'
import { runPreScript, runTestScript } from './sandbox'
import { CollectionStore } from './collection-store'
import { HistoryStore } from './history-store'
import { EnvironmentStore } from './environment-store'
import { WorkspaceStore } from './workspace-store'
import { TrashStore } from './trash-store'
import { parseImport, serializeExport } from './import-export'
import { Hub } from './hub'
import { WsManager, type WsFactory } from './ws-manager'
import { SyncClient, SyncForbiddenError } from './sync/sync-client'
import { SyncStateStore } from './sync/sync-state-store'
import { SyncManager } from './sync/sync-manager'
import { SyncSocket } from './sync/sync-socket'
import { buildStoresPort } from './sync/wiring'
import { createSyncRuntime, isMutating } from './sync/sync-runtime'
import { signIn } from './sync/login'
import { newId, defaultHeaders, type HostMessage, type RestRequest, type WebviewMessage } from '../shared/types'

export function buildHtml(scriptUri: string, styleUri: string, codiconUri: string, cspSource: string, nonce: string): string {
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
</html>`
}

function nonce(): string {
  return crypto.randomBytes(16).toString('hex')
}

// Shared host bootstrap: builds the stores, ensures a Default workspace + an
// active workspace id exist, constructs the router with ALL deps (including the
// dialog impls used by both surfaces), builds a snapshot() that returns the
// workspace-filtered tree + environments + workspaces + history, and creates a
// singleton Hub shared by both the editor panel and the sidebar view.
let bootstrapPromise: Promise<Hub> | undefined
let syncRuntimeRef: ReturnType<typeof createSyncRuntime> | undefined
export function getSyncRuntime(): ReturnType<typeof createSyncRuntime> | undefined { return syncRuntimeRef }
type SyncControlPort = { signIn(): Promise<void>; signOut(): Promise<void>; enable(workspaceId: string): Promise<void>; syncNow(workspaceId: string): Promise<void> }
let syncControlRef: SyncControlPort | undefined
export function getSyncControl(): SyncControlPort | undefined { return syncControlRef }
function ensureBootstrap(context: vscode.ExtensionContext): Promise<Hub> {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
  const base = context.globalStorageUri.fsPath
  const collections = new CollectionStore(base)
  const environments = new EnvironmentStore(base)
  const history = new HistoryStore(base)
  const workspaces = new WorkspaceStore(base)
  const trash = new TrashStore(base)

  // ensure a Default workspace + active id
  let list = await workspaces.list()
  if (list.length === 0) { const def = await workspaces.create('Default'); list = [def] }
  if (!context.globalState.get<string>('restman.activeWorkspaceId')) {
    await context.globalState.update('restman.activeWorkspaceId', list[0].id)
  }

  // createRouter runs before the Hub exists, so the WsManager's emit (and the
  // members port's toast-on-403) are lazily-bound closures over hubRef, which
  // is assigned right after the Hub is constructed below.
  const wsFactory: WsFactory = (url, opts) => new WebSocket(url, { headers: opts.headers }) as unknown as import('./ws-manager').WsSocket
  let hubRef: Hub | undefined
  const wsManager = new WsManager((m) => hubRef?.emitTo('ws', m), wsFactory)

  // syncClient is constructed early (it has no Hub dependency) so the router's
  // members port can be built over it below; the rest of the sync runtime
  // (which does need the Hub) is wired up after the Hub is constructed.
  const syncBaseUrl = (): string => vscode.workspace.getConfiguration('restman').get<string>('syncServerUrl', 'http://localhost:8787')
  let cachedToken: string | undefined
  void context.secrets.get('restman.syncToken').then((t) => { cachedToken = t ?? undefined })
  context.secrets.onDidChange(async (e) => { if (e.key === 'restman.syncToken') cachedToken = (await context.secrets.get('restman.syncToken')) ?? undefined })
  const currentAuthEmail = (): string | null => cachedToken ? (context.globalState.get<string>('restman.syncEmail') ?? null) : null
  const activeWsId = (): string => context.globalState.get<string>('restman.activeWorkspaceId', '')

  const syncClient = new SyncClient({ baseUrl: syncBaseUrl(), getToken: () => cachedToken })
  const membersPort = {
    list: (id: string) => syncClient.listMembers(id),
    add: async (id: string, email: string, role: 'editor' | 'viewer') => {
      try { await syncClient.addMember(id, { email, role }) }
      catch (e) { if (e instanceof SyncForbiddenError) { hubRef?.toast('error', 'Only the owner can add members.'); return } throw e }
    },
    remove: async (id: string, memberId: string) => {
      try { await syncClient.removeMember(id, memberId) }
      catch (e) { if (e instanceof SyncForbiddenError) { hubRef?.toast('error', 'Only the owner can remove members.'); return } throw e }
    },
  }

  const route = createRouter({
    send: sendRequest,
    collections,
    history,
    environments,
    getActiveEnvId: () => context.globalState.get<string | null>('restman.activeEnvId', null),
    setActiveEnvId: (id) => { void context.globalState.update('restman.activeEnvId', id) },
    workspaces,
    getActiveWorkspaceId: () => context.globalState.get<string>('restman.activeWorkspaceId', ''),
    setActiveWorkspaceId: (id) => { void context.globalState.update('restman.activeWorkspaceId', id) },
    runPreScript,
    runTestScript,
    openImport: async () => {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json'] } })
      if (!picked || !picked[0]) return null
      try {
        const text = await fs.readFile(picked[0].fsPath, 'utf8')
        return parseImport(text)
      } catch (e: any) {
        void vscode.window.showErrorMessage(`restman import failed: ${e?.message ?? e}`)
        return null
      }
    },
    runExport: async (c, format) => {
      const target = await vscode.window.showSaveDialog({ filters: { JSON: ['json'] }, saveLabel: 'Export' })
      if (!target) return
      try {
        await fs.writeFile(target.fsPath, serializeExport(c, format), 'utf8')
      } catch (e: any) {
        void vscode.window.showErrorMessage(`restman export failed: ${e?.message ?? e}`)
      }
    },
    pickFile: async () => {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false })
      if (!picked || !picked[0]) return null
      const p = picked[0].fsPath
      return { path: p, filename: p.split(/[\\/]/).pop() ?? p }
    },
    ws: wsManager,
    grpcInvoke,
    trash,
    isReadOnly: (id) => syncRuntimeRef?.isReadOnly(id) ?? false,
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
  })

  const snapshot = async (): Promise<HostMessage[]> => {
    const ws = context.globalState.get<string>('restman.activeWorkspaceId', '')
    const cols = (await collections.list()).filter((c) => (c.workspaceId || ws) === ws)
    const envs = (await environments.list()).filter((e) => (e.workspaceId || ws) === ws)
    const hist = (await history.list()).filter((e) => (e.workspaceId || ws) === ws)
    const trashed = (await trash.list()).filter((e) => (e.workspaceId || ws) === ws)
    return [
      { type: 'tree', collections: cols },
      { type: 'environments', environments: envs, activeId: context.globalState.get<string | null>('restman.activeEnvId', null) },
      { type: 'workspaces', workspaces: (await workspaces.list()).map((w) => ({ ...w, role: syncRuntimeRef?.roleOf(w.id), synced: syncRuntimeRef?.syncedOf(w.id) })), activeId: ws },
      { type: 'history', entries: hist },
      { type: 'trash', entries: trashed },
      { type: 'authState', email: currentAuthEmail() },
    ]
  }

  const hub = new Hub(route, snapshot)
  hubRef = hub
  // Each "open" reply gets its own editor panel (native tab). Requests are keyed
  // by request id so re-opening focuses the existing tab; env/ws are singletons.
  hub.setOpen((m) => {
    if (m.type === 'openInEditor') {
      RestmanPanel.openOrReveal(context, `req:${m.request.id}`, `${m.request.method} ${m.request.name}`, m)
    } else if (m.type === 'openGrpcRequest') {
      RestmanPanel.openOrReveal(context, `grpc:${m.request.id}`, `gRPC ${m.request.name}`, m)
    } else if (m.type === 'openWsRequest') {
      RestmanPanel.openOrReveal(context, `ws:${m.request.id}`, `WS ${m.request.name}`, m)
    } else if (m.type === 'showEnvironments') {
      RestmanPanel.openOrReveal(context, 'env', 'Environments', m)
    } else if (m.type === 'showWebSocket') {
      RestmanPanel.openOrReveal(context, 'ws', 'WebSocket', m)
    } else if (m.type === 'showGrpc') {
      RestmanPanel.openOrReveal(context, 'grpc', 'gRPC', m)
    } else if (m.type === 'showMembers') {
      RestmanPanel.openOrReveal(context, 'members', 'Members', m)
    }
  })

  // --- sync runtime (shares the router's stores + Hub; syncClient itself was
  // constructed earlier so the router's members port could be built over it) ---
  const syncState = new SyncStateStore(base)
  const manager = new SyncManager({
    client: syncClient,
    state: syncState,
    stores: buildStoresPort(collections, environments, workspaces),
    email: () => context.globalState.get<string>('restman.syncEmail', 'me'),
  })
  // SyncSocket's onChange references `runtime` before it is assigned; the arrow
  // defers the read until a message arrives, by which point `runtime` is set.
  let runtime: ReturnType<typeof createSyncRuntime>
  const socket = new SyncSocket({ url: syncBaseUrl, token: () => cachedToken, onChange: (m) => { void runtime.onSocketChange(m) } })
  runtime = createSyncRuntime({ manager, socket, state: syncState, onPulled: async () => { await hub.refresh() } })
  hub.setAfterDispatch((msg) => { if (isMutating(msg.type)) runtime.schedulePush(activeWsId()) })
  runtime.start()
  syncRuntimeRef = runtime
  void runtime.refreshRoleCache()
  void manager.refreshRoles().then(() => runtime.refreshRoleCache())

  const syncControlPort: SyncControlPort = {
    // Each control ends with runtime.refresh() (= hub.refresh, re-broadcast the
    // snapshot) so the UI updates even on the command-palette path, which calls
    // the port directly rather than through hub.dispatch (which broadcasts on
    // its own). Idempotent double-broadcast on the webview path is harmless.
    signIn: async () => {
      const token = await signIn({ baseUrl: syncBaseUrl(), openExternal: (u) => void vscode.env.openExternal(vscode.Uri.parse(u)) })
      cachedToken = token
      await context.secrets.store('restman.syncToken', token)
      try { const me = await syncClient.me(); await context.globalState.update('restman.syncEmail', me.email); hub.authState(me.email) }
      catch { hub.authState(null) }
      await runtime.refresh()
    },
    signOut: async () => {
      await context.secrets.delete('restman.syncToken'); cachedToken = undefined
      await context.globalState.update('restman.syncEmail', undefined)
      await runtime.refreshRoleCache()
      hub.authState(null)
      await runtime.refresh()
    },
    enable: async (id: string) => {
      try { await manager.enable(id); await runtime.refreshRoleCache(); await runtime.refresh() }
      catch (e: any) { hub.toast('error', `Enable sync failed: ${e?.message ?? e}`) }
    },
    syncNow: async (id: string) => {
      try { await manager.pull(id); await manager.push(id); await runtime.refreshRoleCache(); await runtime.refresh() }
      catch (e: any) { hub.toast('error', `Sync failed: ${e?.message ?? e}`) }
    },
  }
  syncControlRef = syncControlPort

  return hub
  })()
  bootstrapPromise.catch(() => { bootstrapPromise = undefined })
  return bootstrapPromise
}

export { ensureBootstrap }

function blankRequest(): RestRequest {
  return { id: newId(), name: 'Untitled', method: 'GET', url: '', params: [], headers: defaultHeaders(), cookies: [], body: { mode: 'none' }, preRequestScript: '', testScript: '' }
}

/**
 * One WebviewPanel per open thing (request/env/ws), keyed so re-opening focuses
 * the existing native tab instead of spawning a duplicate. Each panel registers
 * its own hub sink under its key, so responses route back to the panel that
 * sent the request. A per-panel pending queue holds the initial message until
 * the webview's sink registers (fixing the first-open race).
 */
export class RestmanPanel {
  private static panels = new Map<string, RestmanPanel>()

  private readonly pending: HostMessage[] = []
  private registered = false
  private disposed = false
  private unregister?: () => void

  // Command entry point: open a fresh blank request in its own tab.
  static createOrShow(context: vscode.ExtensionContext) {
    const req = blankRequest()
    RestmanPanel.openOrReveal(context, `req:${req.id}`, `${req.method} ${req.name}`, { type: 'openInEditor', request: req })
  }

  static openOrReveal(context: vscode.ExtensionContext, key: string, title: string, initial?: HostMessage) {
    const existing = RestmanPanel.panels.get(key)
    if (existing) {
      existing.panel.title = title
      existing.panel.reveal()
      if (initial) existing.deliver(initial)
      return
    }
    const panel = vscode.window.createWebviewPanel(
      'restman', title, vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] },
    )
    const rp = new RestmanPanel(panel, context, key)
    if (initial) rp.pending.push(initial)
    RestmanPanel.panels.set(key, rp)
  }

  private deliver(m: HostMessage) {
    if (this.registered) void this.panel.webview.postMessage(m)
    else this.pending.push(m)
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    key: string,
  ) {
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'editor.js'),
    ).toString()
    const styleUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'editor.css'),
    ).toString()
    const codiconUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'codicon.css'),
    ).toString()
    panel.webview.html = buildHtml(scriptUri, styleUri, codiconUri, panel.webview.cspSource, nonce())
    // Tab icon per panel kind (request / gRPC / WebSocket / environments).
    const iconBase = key.startsWith('grpc') ? 'icon-grpc' : key.startsWith('ws') ? 'icon-ws' : key === 'env' ? 'icon-env' : 'icon-request'
    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', `${iconBase}-light.svg`),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', `${iconBase}-dark.svg`),
    }

    void ensureBootstrap(context).then((hub) => {
      // If the panel was disposed before bootstrap resolved, do not register a
      // sink to an already-dead webview (it would never be cleaned up).
      if (this.disposed) return
      this.unregister = hub.register(key, (m) => { void panel.webview.postMessage(m) })
      this.registered = true
      for (const m of this.pending) void panel.webview.postMessage(m)
      this.pending.length = 0
    })
    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      // Reflect the request's method + name (and per-method icon) on the tab.
      if (msg.type === 'setTitle') {
        panel.title = msg.title || 'restman'
        if (msg.icon) panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', `icon-${msg.icon}.svg`)
        return
      }
      const hub = await ensureBootstrap(context)
      await hub.dispatch(key, msg)
    })

    panel.onDidDispose(() => {
      this.disposed = true
      this.unregister?.()
      RestmanPanel.panels.delete(key)
    })
  }
}
