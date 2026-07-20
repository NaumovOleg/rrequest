import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SyncManager } from '../../../src/extension/sync/sync-manager'
import { SyncStateStore } from '../../../src/extension/sync/sync-state-store'
import type { Collection, Environment } from '../../../src/shared/types'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restman-sm-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const col = (): Collection => ({ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] })
const env = (vars: any[]): Environment => ({ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: vars })

function stores(initial: { collections: Collection[]; environments: Environment[] }) {
  const box = { ...initial, applied: null as any }
  return {
    port: {
      getCollections: async () => box.collections,
      getEnvironments: async () => box.environments,
      applyPulled: async (_id: string, collections: Collection[], environments: Environment[]) => { box.applied = { collections, environments } },
    },
    box,
  }
}

describe('SyncManager', () => {
  it('enable builds a secret-stripped snapshot, calls enableSync, and marks synced', async () => {
    const client = { enableSync: vi.fn(async () => ({ driveFileId: 'f1', revision: '1' })), push: vi.fn(), pull: vi.fn() } as any
    const { port } = stores({ collections: [col()], environments: [env([{ key: 'token', value: 'sekret', enabled: true, secret: true }])] })
    const state = new SyncStateStore(dir)
    await new SyncManager({ client, state, stores: port, email: () => 'a@x.com' }).enable('w1', 'W')
    const snap = JSON.parse(client.enableSync.mock.calls[0][2])
    expect(snap.environments[0].variables[0].value).toBe('') // secret stripped
    expect((await state.get('w1'))?.synced).toBe(true)
    expect((await state.get('w1'))?.lastRevision).toBe('1')
  })

  it('pull merges preserving local secret values and applies to stores', async () => {
    const remoteSnap = JSON.stringify({ version: 1, workspaceId: 'w1', name: 'W', collections: [col()], environments: [env([{ key: 'token', value: '', enabled: true, secret: true }])], updatedAt: 1, updatedBy: 'a' })
    const client = { pull: vi.fn(async () => ({ snapshot: remoteSnap, revision: '5' })), enableSync: vi.fn(), push: vi.fn() } as any
    const { port, box } = stores({ collections: [], environments: [env([{ key: 'token', value: 'local-secret', enabled: true, secret: true }])] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f1', ownerEmail: 'a@x.com', role: 'owner', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'a@x.com' }).pull('w1')
    expect(box.applied.environments[0].variables[0].value).toBe('local-secret')
    expect((await state.get('w1'))?.lastRevision).toBe('5')
  })

  it('push is a no-op when the workspace is not synced', async () => {
    const client = { push: vi.fn(), enableSync: vi.fn(), pull: vi.fn() } as any
    const { port } = stores({ collections: [], environments: [] })
    await new SyncManager({ client, state: new SyncStateStore(dir), stores: port, email: () => 'a@x.com' }).push('w1')
    expect(client.push).not.toHaveBeenCalled()
  })
})
