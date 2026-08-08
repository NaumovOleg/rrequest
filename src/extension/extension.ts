import * as vscode from 'vscode'
import { RrequestPanel, ensureBootstrap, getSyncRuntime, getSyncControl } from './panel'
import { SidebarViewProvider } from './sidebar-view'

// Opens the bundled usage guide (docs/usage.md) in the editor — as rendered
// Markdown preview when the built-in Markdown extension is available (it is by
// default), plain text otherwise.
async function openDocs(context: vscode.ExtensionContext): Promise<void> {
  const uri = vscode.Uri.joinPath(context.extensionUri, 'docs', 'usage.md')
  try {
    await vscode.commands.executeCommand('markdown.showPreview', uri)
  } catch {
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(doc)
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('rrequest.open', () => { RrequestPanel.createOrShow(context) }),
    // Palette/keybinding entry points (share the same open paths as the sidebar
    // buttons): New Request = blank request tab, Change Environment = the
    // Environments editor, Import cURL = new tab parsed from clipboard.
    vscode.commands.registerCommand('rrequest.newRequest', () => { RrequestPanel.createOrShow(context) }),
    vscode.commands.registerCommand('rrequest.changeEnvironment', () => {
      RrequestPanel.openOrReveal(context, 'env', 'Environments', { type: 'showEnvironments' })
    }),
    vscode.commands.registerCommand('rrequest.importCurl', async () => {
      const text = await vscode.env.clipboard.readText().then((t) => t, () => '')
      if (!text.trim()) return void vscode.window.showWarningMessage('RREQUEST: clipboard is empty')
      RrequestPanel.openOrReveal(context, `req:${Date.now().toString(36)}`, 'Import cURL', { type: 'importCurl', text })
    }),
    // Gear in the sidebar view title bar -> open the two rrequest settings.
    vscode.commands.registerCommand('rrequest.openSettings', () => {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'rrequest');
    }),
    vscode.commands.registerCommand('rrequest.openDocs', () => openDocs(context)),
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
