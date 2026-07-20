import * as vscode from 'vscode'
import { RestmanPanel } from './panel'
import { SidebarViewProvider } from './sidebar-view'
import { CollectionStore } from './collection-store'
import { EnvironmentStore } from './environment-store'
import { SyncClient } from './sync/sync-client'
import { SyncStateStore } from './sync/sync-state-store'
import { SyncManager } from './sync/sync-manager'
import { buildStoresPort } from './sync/wiring'
import { signIn } from './sync/login'

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('restman.open', () => { RestmanPanel.createOrShow(context) }),
    vscode.window.registerWebviewViewProvider('restman.sidebar', new SidebarViewProvider(context)),
  )

  const base = context.globalStorageUri.fsPath
  const collections = new CollectionStore(base)
  const environments = new EnvironmentStore(base)

  const syncBaseUrl = (): string => vscode.workspace.getConfiguration('restman').get<string>('syncServerUrl', 'http://localhost:8787')
  const getToken = (): string | undefined => context.globalState.get<string>('restman.syncToken')
  const syncClient = () => new SyncClient({ baseUrl: syncBaseUrl(), getToken })

  context.subscriptions.push(
    vscode.commands.registerCommand('restman.signInToSync', async () => {
      try {
        const token = await signIn({ baseUrl: syncBaseUrl(), openExternal: (u) => void vscode.env.openExternal(vscode.Uri.parse(u)) })
        await context.globalState.update('restman.syncToken', token)
        const me = await syncClient().me()
        await context.globalState.update('restman.syncEmail', me.email)
        void vscode.window.showInformationMessage(`restman: signed in as ${me.email}`)
      } catch (e: any) {
        void vscode.window.showErrorMessage(`restman sign-in failed: ${e?.message ?? e}`)
      }
    }),
  )

  const syncManager = () => new SyncManager({
    client: syncClient(),
    state: new SyncStateStore(context.globalStorageUri.fsPath),
    stores: buildStoresPort(collections, environments),
    email: () => context.globalState.get<string>('restman.syncEmail', 'me'),
  })
  const activeWorkspaceId = (): string => context.globalState.get<string>('restman.activeWorkspaceId', '')

  context.subscriptions.push(
    vscode.commands.registerCommand('restman.enableWorkspaceSync', async () => {
      const id = activeWorkspaceId()
      if (!id) return void vscode.window.showWarningMessage('restman: no active workspace')
      try { await syncManager().enable(id, id); void vscode.window.showInformationMessage('restman: workspace sync enabled') }
      catch (e: any) { void vscode.window.showErrorMessage(`restman: enable sync failed: ${e?.message ?? e}`) }
    }),
    vscode.commands.registerCommand('restman.syncNow', async () => {
      const id = activeWorkspaceId()
      if (!id) return void vscode.window.showWarningMessage('restman: no active workspace')
      try { await syncManager().pull(id); await syncManager().push(id); void vscode.window.showInformationMessage('restman: synced') }
      catch (e: any) { void vscode.window.showErrorMessage(`restman: sync failed: ${e?.message ?? e}`) }
    }),
  )
}

export function deactivate() {}
