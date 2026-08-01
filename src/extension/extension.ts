import * as vscode from 'vscode'
import { RrequestPanel, ensureBootstrap, getSyncRuntime, getSyncControl } from './panel'
import { SidebarViewProvider } from './sidebar-view'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('rrequest.open', () => { RrequestPanel.createOrShow(context) }),
    vscode.window.registerWebviewViewProvider('rrequest.sidebar', new SidebarViewProvider(context)),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('rrequest.signInToSync', async () => {
      await ensureBootstrap(context)
      try { await getSyncControl()?.signIn() }
      catch (e: any) { void vscode.window.showErrorMessage(`rrequest sign-in failed: ${e?.message ?? e}`) }
    }),
  )

  const activeWorkspaceId = (): string => context.globalState.get<string>('rrequest.activeWorkspaceId', '')

  context.subscriptions.push(
    vscode.commands.registerCommand('rrequest.enableWorkspaceSync', async () => {
      const id = activeWorkspaceId()
      if (!id) return void vscode.window.showWarningMessage('RREQUEST: no active workspace')
      await ensureBootstrap(context)
      const rt = getSyncRuntime()
      if (!rt) return void vscode.window.showWarningMessage('RREQUEST: sync not ready')
      await getSyncControl()?.enable(id)
    }),
    vscode.commands.registerCommand('rrequest.syncNow', async () => {
      const id = activeWorkspaceId()
      if (!id) return void vscode.window.showWarningMessage('RREQUEST: no active workspace')
      await ensureBootstrap(context)
      const rt = getSyncRuntime()
      if (!rt) return void vscode.window.showWarningMessage('RREQUEST: sync not ready')
      await getSyncControl()?.syncNow(id)
    }),
  )
}

export function deactivate() {}
