import * as vscode from 'vscode'
import { createRouter } from './messaging'
import { sendRequest } from './http-client'
import { CollectionStore } from './collection-store'
import { HistoryStore } from './history-store'
import type { WebviewMessage } from '../shared/types'

export function buildHtml(scriptUri: string, cspSource: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`
}

function nonce(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
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
    })

    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.js'),
    ).toString()
    panel.webview.html = buildHtml(scriptUri, panel.webview.cspSource, nonce())

    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      const out = await route(msg)
      if (out) panel.webview.postMessage(out)
    })

    panel.onDidDispose(() => { RestmanPanel.current = undefined })
  }
}
