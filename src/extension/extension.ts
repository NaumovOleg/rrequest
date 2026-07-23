import * as vscode from 'vscode'
import { RestmanPanel, ensureBootstrap, getSyncRuntime, getSyncControl } from './panel'
import { SidebarViewProvider } from './sidebar-view'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('restman.open', () => { RestmanPanel.createOrShow(context) }),
    vscode.window.registerWebviewViewProvider('restman.sidebar', new SidebarViewProvider(context)),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('restman.signInToSync', async () => {
      await ensureBootstrap(context)
      try { await getSyncControl()?.signIn() }
      catch (e: any) { void vscode.window.showErrorMessage(`restman sign-in failed: ${e?.message ?? e}`) }
    }),
  )

  const activeWorkspaceId = (): string => context.globalState.get<string>('restman.activeWorkspaceId', '')

  context.subscriptions.push(
    vscode.commands.registerCommand('restman.enableWorkspaceSync', async () => {
      const id = activeWorkspaceId()
      if (!id) return void vscode.window.showWarningMessage('restman: no active workspace')
      await ensureBootstrap(context)
      const rt = getSyncRuntime()
      if (!rt) return void vscode.window.showWarningMessage('restman: sync not ready')
      await getSyncControl()?.enable(id)
    }),
    vscode.commands.registerCommand('restman.syncNow', async () => {
      const id = activeWorkspaceId()
      if (!id) return void vscode.window.showWarningMessage('restman: no active workspace')
      await ensureBootstrap(context)
      const rt = getSyncRuntime()
      if (!rt) return void vscode.window.showWarningMessage('restman: sync not ready')
      await getSyncControl()?.syncNow(id)
    }),
  )
}

export function deactivate() {}
