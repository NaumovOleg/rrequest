import * as vscode from 'vscode'
import { RestmanPanel } from './panel'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('restman.open', () => {
      RestmanPanel.createOrShow(context)
    }),
  )
}

export function deactivate() {}
