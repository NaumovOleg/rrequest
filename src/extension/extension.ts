import * as vscode from 'vscode'
import { RestmanPanel, ensureBootstrap, getSyncRuntime } from './panel'
import { SidebarViewProvider } from './sidebar-view'
import { SyncClient } from './sync/sync-client'
import { signIn } from './sync/login'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('restman.open', () => { RestmanPanel.createOrShow(context) }),
    vscode.window.registerWebviewViewProvider('restman.sidebar', new SidebarViewProvider(context)),
  )

  let cachedSyncToken: string | undefined
  void context.secrets.get('restman.syncToken').then((t) => { cachedSyncToken = t ?? undefined })

  const syncBaseUrl = (): string => vscode.workspace.getConfiguration('restman').get<string>('syncServerUrl', 'http://localhost:8787')
  const getToken = (): string | undefined => cachedSyncToken
  const syncClient = () => new SyncClient({ baseUrl: syncBaseUrl(), getToken })

  context.subscriptions.push(
    vscode.commands.registerCommand('restman.signInToSync', async () => {
      try {
        const token = await signIn({ baseUrl: syncBaseUrl(), openExternal: (u) => void vscode.env.openExternal(vscode.Uri.parse(u)) })
        cachedSyncToken = token
        await context.secrets.store('restman.syncToken', token)
        const me = await syncClient().me()
        await context.globalState.update('restman.syncEmail', me.email)
        void vscode.window.showInformationMessage(`restman: signed in as ${me.email}`)
      } catch (e: any) {
        void vscode.window.showErrorMessage(`restman sign-in failed: ${e?.message ?? e}`)
      }
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
      try { await rt.manager.enable(id); await rt.refreshRoleCache(); void vscode.window.showInformationMessage('restman: workspace sync enabled') }
      catch (e: any) { void vscode.window.showErrorMessage(`restman: enable sync failed: ${e?.message ?? e}`) }
    }),
    vscode.commands.registerCommand('restman.syncNow', async () => {
      const id = activeWorkspaceId()
      if (!id) return void vscode.window.showWarningMessage('restman: no active workspace')
      await ensureBootstrap(context)
      const rt = getSyncRuntime()
      if (!rt) return void vscode.window.showWarningMessage('restman: sync not ready')
      try { await rt.manager.pull(id); await rt.manager.push(id); await rt.refreshRoleCache(); await rt.refresh(); void vscode.window.showInformationMessage('restman: synced') }
      catch (e: any) { void vscode.window.showErrorMessage(`restman: sync failed: ${e?.message ?? e}`) }
    }),
  )
}

export function deactivate() {}
