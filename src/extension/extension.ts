import * as vscode from 'vscode'
import { RestmanPanel } from './panel'
import { SidebarViewProvider } from './sidebar-view'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('restman.open', () => { RestmanPanel.createOrShow(context) }),
    vscode.window.registerWebviewViewProvider('restman.sidebar', new SidebarViewProvider(context)),
  )
}

export function deactivate() {}
