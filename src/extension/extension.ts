import * as vscode from 'vscode'
import { RrequestPanel, ensureBootstrap, getSyncRuntime, getSyncControl } from './panel'
import { SidebarViewProvider } from './sidebar-view'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('rrequest.open', () => { RrequestPanel.createOrShow(context) }),
    // Gear in the sidebar view title bar -> open the two rrequest settings.
    vscode.commands.registerCommand('rrequest.openSettings', () => {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'rrequest');
    }),
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
      const control = getSyncControl()
      if (!control) return
      // With several accounts connected, enable() can't guess which one owns
      // this workspace — ask, instead of failing with "choose an account".
      const accounts = control.accounts()
      if (accounts.length === 0) return void vscode.window.showWarningMessage('RREQUEST: sign in with Google first')
      let accountId = accounts[0].id
      if (accounts.length > 1) {
        const picked = await vscode.window.showQuickPick(
          accounts.map((a) => ({ label: a.email, id: a.id })),
          { title: 'Sync this workspace to which account?' },
        )
        if (!picked) return
        accountId = picked.id
      }
      await control.enable(id, accountId)
    }),
    vscode.commands.registerCommand('rrequest.syncDiagnostics', async () => {
      await ensureBootstrap(context)
      await getSyncControl()?.diagnostics()
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
