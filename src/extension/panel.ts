import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import { createRouter } from './messaging'
import { sendRequest } from './http-client'
import { runPreScript, runTestScript } from './sandbox'
import { CollectionStore } from './collection-store'
import { HistoryStore } from './history-store'
import { EnvironmentStore } from './environment-store'
import { WorkspaceStore } from './workspace-store'
import { parseImport, serializeExport } from './import-export'
import { Hub } from './hub'
import type { HostMessage, WebviewMessage } from '../shared/types'

export function buildHtml(scriptUri: string, styleUri: string, cspSource: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
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
function ensureBootstrap(context: vscode.ExtensionContext): Promise<Hub> {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
  const base = context.globalStorageUri.fsPath
  const collections = new CollectionStore(base)
  const environments = new EnvironmentStore(base)
  const history = new HistoryStore(base)
  const workspaces = new WorkspaceStore(base)

  // ensure a Default workspace + active id
  let list = await workspaces.list()
  if (list.length === 0) { const def = await workspaces.create('Default'); list = [def] }
  if (!context.globalState.get<string>('restman.activeWorkspaceId')) {
    await context.globalState.update('restman.activeWorkspaceId', list[0].id)
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
  })

  const snapshot = async (): Promise<HostMessage[]> => {
    const ws = context.globalState.get<string>('restman.activeWorkspaceId', '')
    const cols = (await collections.list()).filter((c) => (c.workspaceId || ws) === ws)
    return [
      { type: 'tree', collections: cols },
      { type: 'environments', environments: await environments.list(), activeId: context.globalState.get<string | null>('restman.activeEnvId', null) },
      { type: 'workspaces', workspaces: await workspaces.list(), activeId: ws },
      { type: 'history', entries: await history.list() },
    ]
  }

  const hub = new Hub(route, snapshot)
  // Let the Hub reveal/create the editor panel when routing openInEditor.
  hub.setEditorReveal(() => { RestmanPanel.createOrShow(context) })
  return hub
  })()
  bootstrapPromise.catch(() => { bootstrapPromise = undefined })
  return bootstrapPromise
}

export { ensureBootstrap }

export class RestmanPanel {
  private static current: RestmanPanel | undefined

  static createOrShow(context: vscode.ExtensionContext) {
    if (RestmanPanel.current) {
      RestmanPanel.current.panel.reveal()
      return
    }
    const panel = vscode.window.createWebviewPanel(
      'restman', 'restman', vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] },
    )
    RestmanPanel.current = new RestmanPanel(panel, context)
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
  ) {
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'editor.js'),
    ).toString()
    const styleUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'editor.css'),
    ).toString()
    panel.webview.html = buildHtml(scriptUri, styleUri, panel.webview.cspSource, nonce())

    let unregister: (() => void) | undefined
    let disposed = false
    void ensureBootstrap(context).then((hub) => {
      // If the panel was disposed before bootstrap resolved, do not register a
      // sink to an already-dead webview (it would never be cleaned up).
      if (disposed) return
      unregister = hub.register('editor', (m) => { void panel.webview.postMessage(m) })
    })
    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      const hub = await ensureBootstrap(context)
      await hub.dispatch('editor', msg)
    })

    panel.onDidDispose(() => {
      disposed = true
      unregister?.()
      RestmanPanel.current = undefined
    })
  }
}
