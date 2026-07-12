import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import { createRouter } from './messaging'
import { sendRequest } from './http-client'
import { CollectionStore } from './collection-store'
import { HistoryStore } from './history-store'
import { EnvironmentStore } from './environment-store'
import { parseImport, serializeExport } from './import-export'
import type { WebviewMessage } from '../shared/types'

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
    const base = context.globalStorageUri.fsPath
    const route = createRouter({
      send: sendRequest,
      collections: new CollectionStore(base),
      history: new HistoryStore(base),
      environments: new EnvironmentStore(base),
      getActiveEnvId: () => context.globalState.get<string | null>('restman.activeEnvId', null),
      setActiveEnvId: (id) => { void context.globalState.update('restman.activeEnvId', id) },
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

    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.js'),
    ).toString()
    const styleUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.css'),
    ).toString()
    panel.webview.html = buildHtml(scriptUri, styleUri, panel.webview.cspSource, nonce())

    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      const out = await route(msg)
      if (out) panel.webview.postMessage(out)
    })

    panel.onDidDispose(() => { RestmanPanel.current = undefined })
  }
}
