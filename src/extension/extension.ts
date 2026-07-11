import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('restman.open', () => {
      vscode.window.showInformationMessage('restman: open (panel wired in Task 8)')
    }),
  )
}

export function deactivate() {}
