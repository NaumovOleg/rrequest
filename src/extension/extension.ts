import * as vscode from 'vscode'
import { RestmanPanel } from './panel'

// Empty tree provider so the activity-bar view is valid; its content is the
// viewsWelcome button (contributed in package.json) that runs restman.open.
class LaunchViewProvider implements vscode.TreeDataProvider<never> {
  getTreeItem(): vscode.TreeItem {
    return new vscode.TreeItem('')
  }
  getChildren(): never[] {
    return []
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('restman.open', () => {
      RestmanPanel.createOrShow(context)
    }),
    vscode.window.registerTreeDataProvider('restman.launch', new LaunchViewProvider()),
  )
}

export function deactivate() {}
