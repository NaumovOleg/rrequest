import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import { ensureBootstrap } from './panel'
import type { WebviewMessage } from '../shared/types'

function nonce(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function buildSidebarHtml(scriptUri: string, styleUri: string, cspSource: string, n: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${n}';" />
<link rel="stylesheet" href="${styleUri}" /></head>
<body><div id="root"></div><script nonce="${n}" src="${scriptUri}"></script></body></html>`
}

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    }
    const scriptUri = view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.js'),
    ).toString()
    const styleUri = view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.css'),
    ).toString()
    view.webview.html = buildSidebarHtml(scriptUri, styleUri, view.webview.cspSource, nonce())

    const hub = await ensureBootstrap(this.context)
    const unregister = hub.register('sidebar', (m) => { void view.webview.postMessage(m) })
    view.webview.onDidReceiveMessage((msg: WebviewMessage) => { void hub.dispatch('sidebar', msg) })
    view.onDidDispose(() => unregister())
  }
}
