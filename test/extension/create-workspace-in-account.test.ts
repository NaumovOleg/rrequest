import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Hub } from '../../src/extension/hub'
import { createRouter } from '../../src/extension/messaging'
import { CollectionStore } from '../../src/extension/stores/collection-store'
import { EnvironmentStore } from '../../src/extension/stores/environment-store'
import { WorkspaceStore } from '../../src/extension/stores/workspace-store'
import { SyncManager } from '../../src/extension/sync/sync-manager'
import { SyncStateStore } from '../../src/extension/sync/sync-state-store'
import { SyncGoneError } from '../../src/extension/sync/sync-client'
import { createSyncRuntime } from '../../src/extension/sync/sync-runtime'
import { buildStoresPort } from '../../src/extension/sync/wiring'
import type { HostMessage, Workspace } from '../../src/shared/types'

// End-to-end wiring of the "+ New workspace in <account>" button, minus vscode:
// real router -> real SyncManager -> real SyncStateStore on disk -> the same
// tagWorkspaces enrichment the host broadcasts. Catches the "created under an
// account but shows up under Local" class of bug at the seam, which unit tests
// of the pieces individually cannot see.
let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rrequest-cwa-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

function harness(client: any) {
  const collections = new CollectionStore(dir)
  const environments = new EnvironmentStore(dir)
  const workspaces = new WorkspaceStore(dir)
  const syncState = new SyncStateStore(dir)
  const accounts = [{ id: 'acc-1', email: 'me@x.com' }]
  const manager = new SyncManager({
    client, state: syncState, stores: buildStoresPort(collections, environments, workspaces),
    email: () => 'me@x.com', isAuthed: () => accounts.length > 0,
  })
  let activeWorkspaceId = ''
  const runtime = createSyncRuntime({ manager, state: syncState, onPulled: async () => { await hub.refresh() } })

  // Mirror of panel.ts tagWorkspaces.
  const tag = async (list: Workspace[]): Promise<Workspace[]> => {
    const states = await syncState.all()
    return list.map((w) => ({
      ...w,
      role: runtime.roleOf(w.id),
      synced: runtime.syncedOf(w.id),
      accountId: states[w.id]?.accountId,
      accountEmail: accounts.find((a) => a.id === states[w.id]?.accountId)?.email,
    }))
  }

  const toasts: { level: string; message: string }[] = []
  const route = createRouter({
    send: (async () => ({})) as any,
    collections, history: { append: async () => {}, list: async () => [], dropByWorkspace: async () => {} } as any,
    environments, workspaces,
    enrichWorkspaces: tag,
    getActiveEnvId: () => null, setActiveEnvId: () => {},
    getActiveWorkspaceId: () => activeWorkspaceId,
    setActiveWorkspaceId: (id) => { activeWorkspaceId = id },
    syncControl: {
      signIn: async () => {}, signOut: async () => {}, syncNow: async () => {}, syncAccount: async () => {},
      // Mirror of panel.ts syncControlPort.enable.
      enable: async (id: string, accountId?: string) => {
        const acct = accountId ?? (accounts.length === 1 ? accounts[0].id : undefined)
        if (!acct) { toasts.push({ level: 'error', message: 'Choose an account' }); return }
        try {
          await manager.enable(id, acct)
          await runtime.refreshRoleCache()
          if (!(await syncState.get(id))?.synced) toasts.push({ level: 'error', message: 'stayed local' })
        } catch (e: any) {
          toasts.push({ level: 'error', message: `Enable sync failed: ${e?.message ?? e}` })
        }
      },
    },
  })

  const snapshot = async (): Promise<HostMessage[]> => [
    { type: 'workspaces', workspaces: await tag(await workspaces.list()), activeId: activeWorkspaceId },
  ]
  const hub = new Hub(route, snapshot)
  const seen: HostMessage[] = []
  hub.register('sidebar', (m) => seen.push(m))
  return { hub, seen, toasts, syncState, workspaces }
}

const okClient = () => ({
  pull: vi.fn(async () => { throw new SyncGoneError() }), // brand-new workspace: 404 from the server
  enableSync: vi.fn(async () => ({ driveFileId: 'drive-1', revision: 'r1' })),
  push: vi.fn(async () => ({ ok: true, revision: 'r2' })),
})

describe('createWorkspace with an accountId (the "+" next to an account)', () => {
  it('creates the workspace AND binds it to that account in the broadcast snapshot', async () => {
    const client = okClient()
    const { hub, seen, toasts, syncState } = harness(client)
    await hub.dispatch('sidebar', { type: 'createWorkspace', name: 'Team', accountId: 'acc-1' })

    expect(client.enableSync).toHaveBeenCalled()
    const created = (await syncState.all())
    const [id, state] = Object.entries(created)[0] ?? []
    expect(state?.synced).toBe(true)
    expect(state?.accountId).toBe('acc-1')

    const last = [...seen].reverse().find((m) => m.type === 'workspaces') as any
    const w = last.workspaces.find((x: Workspace) => x.id === id)
    expect(w.synced).toBe(true)
    expect(w.accountId).toBe('acc-1')
    expect(w.accountEmail).toBe('me@x.com')
    expect(toasts).toEqual([])
  })

  it('reports the failure instead of silently leaving a local workspace behind', async () => {
    const client = okClient()
    client.enableSync = vi.fn(async (): Promise<{ driveFileId: string; revision: string }> => { throw new Error('sync request failed: 500') })
    const { hub, seen, toasts } = harness(client)
    await hub.dispatch('sidebar', { type: 'createWorkspace', name: 'Team', accountId: 'acc-1' })

    expect(toasts.map((t) => t.message)).toEqual(['Enable sync failed: sync request failed: 500'])
    const last = [...seen].reverse().find((m) => m.type === 'workspaces') as any
    expect(last.workspaces[0].synced).toBeFalsy()
  })
})
