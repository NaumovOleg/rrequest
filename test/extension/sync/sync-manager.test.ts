import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SyncManager } from '../../../src/extension/sync/sync-manager'
import { SyncStateStore } from '../../../src/extension/sync/sync-state-store'
import { SyncForbiddenError, SyncGoneError, SyncAuthError } from '../../../src/extension/sync/sync-client'
import type { Collection, Environment } from '../../../src/shared/types'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rrequest-sm-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const col = (): Collection => ({ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] })
const env = (vars: any[]): Environment => ({ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: vars })
const req = (id: string, name = id) => ({ id, name, method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } })
const emptyRemote = (revision = '1') => ({ snapshot: JSON.stringify({ version: 1, workspaceId: 'w1', name: 'RealName', collections: [], environments: [], updatedAt: 1, updatedBy: 'x' }), revision })
// push now pre-pulls the current remote to union before writing; error-path
// tests give it an empty remote so the push call itself surfaces the error.
const pullEmpty = () => vi.fn(async () => emptyRemote())
const pullGone = () => vi.fn(async () => { throw new SyncGoneError() })

function stores(initial: { collections: Collection[]; environments: Environment[] }) {
  const box = { ...initial, applied: null as any }
  return {
    port: {
      getName: async () => 'RealName',
      getCollections: async () => box.collections,
      getEnvironments: async () => box.environments,
      applyPulled: async (_id: string, collections: Collection[], environments: Environment[]) => { box.applied = { collections, environments } },
    },
    box,
  }
}

describe('SyncManager', () => {
  it('enable builds a secret-stripped snapshot, calls enableSync, and marks synced', async () => {
    const client = { enableSync: vi.fn(async () => ({ driveFileId: 'f1', revision: '1' })), push: vi.fn(), pull: pullGone() } as any
    const { port } = stores({ collections: [col()], environments: [env([{ key: 'token', value: 'sekret', enabled: true, secret: true }])] })
    const state = new SyncStateStore(dir)
    await new SyncManager({ client, state, stores: port, email: () => 'a@x.com' }).enable('w1')
    const snap = JSON.parse(client.enableSync.mock.calls[0][2])
    expect(snap.name).toBe('RealName')
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

  it('pull merges collections so a local-only request survives (does not clobber unpushed local requests)', async () => {
    const localCollection: Collection = { id: 'c1', name: 'C', workspaceId: 'w1', requests: [req('rLocal')] }
    const remoteCollection: Collection = { id: 'c1', name: 'C', workspaceId: 'w1', requests: [req('rRemote')] }
    const remoteSnap = JSON.stringify({ version: 1, workspaceId: 'w1', name: 'W', collections: [remoteCollection], environments: [], updatedAt: 1, updatedBy: 'other' })
    const client = { pull: vi.fn(async () => ({ snapshot: remoteSnap, revision: '9' })), enableSync: vi.fn(), push: vi.fn() } as any
    const { port, box } = stores({ collections: [localCollection], environments: [] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f1', ownerEmail: 'a@x.com', role: 'owner', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'a@x.com' }).pull('w1')
    const appliedCol = box.applied.collections.find((c: Collection) => c.id === 'c1')
    const ids = appliedCol.requests.map((r: any) => r.id).sort()
    expect(ids).toEqual(['rLocal', 'rRemote'])
    expect((await state.get('w1'))?.lastRevision).toBe('9')
  })

  it('pull does not resurrect a pending-deleted request (no duplicate-trash loop)', async () => {
    // Local already has the request removed; remote still has it; the id is
    // pending deletion. Pull must NOT bring it back locally before push runs.
    const remoteCollection: Collection = { id: 'c1', name: 'C', workspaceId: 'w1', requests: [req('rDel'), req('rKeep')] }
    const remoteSnap = JSON.stringify({ version: 1, workspaceId: 'w1', name: 'W', collections: [remoteCollection], environments: [], updatedAt: 1, updatedBy: 'other' })
    const client = { pull: vi.fn(async () => ({ snapshot: remoteSnap, revision: '9' })), enableSync: vi.fn(), push: vi.fn() } as any
    const localCollection: Collection = { id: 'c1', name: 'C', workspaceId: 'w1', requests: [req('rKeep')] }
    const { port, box } = stores({ collections: [localCollection], environments: [] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f1', ownerEmail: 'a@x.com', role: 'owner', lastRevision: '1', synced: true })
    const mgr = new SyncManager({ client, state, stores: port, email: () => 'a@x.com' })
    mgr.recordDeletion(['rDel'])
    await mgr.pull('w1')
    const appliedCol = box.applied.collections.find((c: Collection) => c.id === 'c1')
    expect(appliedCol.requests.map((r: any) => r.id).sort()).toEqual(['rKeep']) // rDel stays gone
  })

  it('push/pull skip (no request) when the account has no resolvable token', async () => {
    const client = { push: vi.fn(), pull: vi.fn(), enableSync: vi.fn() } as any
    const { port } = stores({ collections: [], environments: [] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'a@x.com', role: 'owner', lastRevision: '1', synced: true, accountId: 'gone' })
    const mgr = new SyncManager({ client, state, stores: port, email: () => 'a@x.com', hasToken: () => false })
    await mgr.push('w1')
    await mgr.pull('w1')
    expect(client.push).not.toHaveBeenCalled()
    expect(client.pull).not.toHaveBeenCalled() // no empty-Bearer request -> no spurious 401
  })

  it('push is a no-op when the workspace is not synced', async () => {
    const client = { push: vi.fn(), enableSync: vi.fn(), pull: vi.fn() } as any
    const { port } = stores({ collections: [], environments: [] })
    await new SyncManager({ client, state: new SyncStateStore(dir), stores: port, email: () => 'a@x.com' }).push('w1')
    expect(client.push).not.toHaveBeenCalled()
  })

  it('push clears only the deletes it applied — a delete recorded mid-push survives', async () => {
    const remoteSnap = JSON.stringify({ version: 1, workspaceId: 'w1', name: 'W', collections: [], environments: [], updatedAt: 1, updatedBy: 'other' })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f1', ownerEmail: 'a@x.com', role: 'owner', lastRevision: '1', synced: true })
    const { port } = stores({ collections: [], environments: [] })
    let mgr: SyncManager
    const client = {
      pull: vi.fn(async () => ({ snapshot: remoteSnap, revision: '3' })),
      // Simulate a concurrent delete landing while this push is in flight.
      push: vi.fn(async () => { mgr.recordDeletion(['rMid']); return { ok: true, revision: '4' } }),
      enableSync: vi.fn(),
    } as any
    mgr = new SyncManager({ client, state, stores: port, email: () => 'a@x.com' })
    mgr.recordDeletion(['rBefore'])
    await mgr.push('w1')
    const pending = (mgr as any).pendingDeletes as Set<string>
    expect(pending.has('rBefore')).toBe(false) // applied + cleared
    expect(pending.has('rMid')).toBe(true)      // recorded mid-push -> NOT wiped
  })

  it('push merges and retries on conflict, then records the new revision', async () => {
    const localCol = { id: 'c-local', name: 'Local', workspaceId: 'w1', requests: [] }
    const remoteSnap = JSON.stringify({ version: 1, workspaceId: 'w1', name: 'RealName', collections: [{ id: 'c-remote', name: 'Remote', workspaceId: 'w1', requests: [] }], environments: [], updatedAt: 1, updatedBy: 'other' })
    let pushes = 0
    const client = {
      enableSync: vi.fn(),
      pull: vi.fn(async () => ({ snapshot: remoteSnap, revision: '1' })),
      push: vi.fn(async (_id: string, snapshot: string, _base: string) => {
        pushes += 1
        if (pushes === 1) return { ok: false, conflict: true, snapshot: remoteSnap, revision: '7' }
        // second push should carry both collections (merged)
        const parsed = JSON.parse(snapshot)
        expect(parsed.collections.map((c: any) => c.id).sort()).toEqual(['c-local', 'c-remote'])
        return { ok: true, revision: '8' }
      }),
    } as any
    const { port } = stores({ collections: [localCol], environments: [] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f1', ownerEmail: 'a@x.com', role: 'owner', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'a@x.com' }).push('w1')
    expect(pushes).toBe(2)
    expect((await state.get('w1'))?.lastRevision).toBe('8')
  })

  it('push unions remote-only collections so an empty/stale local never wipes the remote', async () => {
    const remoteSnap = JSON.stringify({ version: 1, workspaceId: 'w1', name: 'RealName', collections: [{ id: 'c-remote', name: 'R', workspaceId: 'w1', requests: [] }], environments: [], updatedAt: 1, updatedBy: 'other' })
    let pushed: any
    const client = { pull: vi.fn(async () => ({ snapshot: remoteSnap, revision: '3' })), push: vi.fn(async (_id: string, snap: string) => { pushed = JSON.parse(snap); return { ok: true, revision: '4' } }), enableSync: vi.fn() } as any
    const { port } = stores({ collections: [], environments: [] }) // local EMPTY
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o', role: 'owner', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'me' }).push('w1')
    expect(pushed.collections.map((c: any) => c.id)).toEqual(['c-remote']) // remote content survived the push
  })

  it('recordDeletion prunes the deleted id from the pushed snapshot (explicit delete propagates)', async () => {
    const remoteSnap = JSON.stringify({ version: 1, workspaceId: 'w1', name: 'RealName', collections: [{ id: 'c-del', name: 'D', workspaceId: 'w1', requests: [] }, { id: 'c-keep', name: 'K', workspaceId: 'w1', requests: [] }], environments: [], updatedAt: 1, updatedBy: 'other' })
    let pushed: any
    const client = { pull: vi.fn(async () => ({ snapshot: remoteSnap, revision: '3' })), push: vi.fn(async (_id: string, snap: string) => { pushed = JSON.parse(snap); return { ok: true, revision: '4' } }), enableSync: vi.fn() } as any
    const { port } = stores({ collections: [], environments: [] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o', role: 'owner', lastRevision: '1', synced: true })
    const mgr = new SyncManager({ client, state, stores: port, email: () => 'me' })
    mgr.recordDeletion(['c-del'])
    await mgr.push('w1')
    expect(pushed.collections.map((c: any) => c.id)).toEqual(['c-keep']) // deleted dropped from remote, other kept
  })

  it('enable adopts an existing remote (union) instead of overwriting it', async () => {
    const remoteSnap = JSON.stringify({ version: 1, workspaceId: 'w1', name: 'W', collections: [{ id: 'c-remote', name: 'R', workspaceId: 'w1', requests: [] }], environments: [], updatedAt: 1, updatedBy: 'other' })
    let written: any
    const client = { pull: vi.fn(async () => ({ snapshot: remoteSnap, revision: '2' })), enableSync: vi.fn(async (_id: string, _n: string, snap: string) => { written = JSON.parse(snap); return { driveFileId: 'f', revision: '3' } }), push: vi.fn() } as any
    const { port, box } = stores({ collections: [{ id: 'c-local', name: 'L', workspaceId: 'w1', requests: [] }], environments: [] })
    const state = new SyncStateStore(dir)
    await new SyncManager({ client, state, stores: port, email: () => 'me' }).enable('w1')
    expect(written.collections.map((c: any) => c.id).sort()).toEqual(['c-local', 'c-remote']) // remote NOT overwritten
    expect(box.applied.collections.map((c: any) => c.id).sort()).toEqual(['c-local', 'c-remote']) // adopted locally too
  })

  it('adoptRemoteWorkspaces pulls each server workspace down, ensures it locally, and marks it synced', async () => {
    const remoteSnap = JSON.stringify({ version: 1, workspaceId: 'w1', name: 'W', collections: [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }], environments: [], updatedAt: 1, updatedBy: 'other' })
    const ensured: string[] = []
    const client = { recover: vi.fn(async () => ({ recovered: [], total: 0 })), listWorkspaces: vi.fn(async () => [{ id: 'w1', name: 'W', driveFileId: 'f', revision: '5', role: 'owner' }]), pull: vi.fn(async () => ({ snapshot: remoteSnap, revision: '5', role: 'owner' })), push: vi.fn(), enableSync: vi.fn() } as any
    const { port, box } = stores({ collections: [], environments: [] })
    ;(port as any).ensureWorkspace = async (id: string) => { ensured.push(id) }
    const state = new SyncStateStore(dir)
    const res = await new SyncManager({ client, state, stores: port, email: () => 'me' }).adoptRemoteWorkspaces()
    expect(res).toEqual({ listed: 1, adopted: ['w1'], failed: 0 })
    expect(ensured).toEqual(['w1'])
    expect(box.applied.collections.map((c: any) => c.id)).toEqual(['c1'])
    expect((await state.get('w1'))?.synced).toBe(true)
    expect((await state.get('w1'))?.lastRevision).toBe('5')
  })

  it('pull records the role returned by the server', async () => {
    const client = { pull: vi.fn(async () => ({ snapshot: JSON.stringify({ version: 1, workspaceId: 'w1', name: 'W', collections: [], environments: [], updatedAt: 1, updatedBy: 'x' }), revision: '5', role: 'viewer' })), push: vi.fn(), enableSync: vi.fn() } as any
    const { port } = stores({ collections: [], environments: [] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'editor', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'me' }).pull('w1')
    expect((await state.get('w1'))?.role).toBe('viewer')
  })
  it('refreshRoles updates synced workspaces roles from listWorkspaces', async () => {
    const client = { listWorkspaces: vi.fn(async () => [{ id: 'w1', role: 'viewer' }, { id: 'w2', role: 'owner' }]) } as any
    const { port } = stores({ collections: [], environments: [] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'editor', lastRevision: '1', synced: true })
    // w2 not synced locally -> should be ignored
    await new SyncManager({ client, state, stores: port, email: () => 'me' }).refreshRoles()
    expect((await state.get('w1'))?.role).toBe('viewer')
    expect(await state.get('w2')).toBeUndefined()
  })
  it('refreshRoles no-ops (no network, no onAuthLost) when isAuthed is false', async () => {
    const client = { listWorkspaces: vi.fn() } as any
    const onAuthLost = vi.fn()
    const { port } = stores({ collections: [], environments: [] })
    const state = new SyncStateStore(dir)
    await new SyncManager({ client, state, stores: port, email: () => 'me', isAuthed: () => false, onAuthLost }).refreshRoles()
    expect(client.listWorkspaces).not.toHaveBeenCalled()
    expect(onAuthLost).not.toHaveBeenCalled()
  })
  it('push drops sync (synced=false) but keeps local data on a 403', async () => {
    const applyPulled = vi.fn()
    const client = { push: vi.fn(async () => { throw new SyncForbiddenError() }), enableSync: vi.fn(), pull: pullEmpty() } as any
    const { port } = stores({ collections: [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }], environments: [] })
    port.applyPulled = applyPulled
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'editor', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'me' }).push('w1')
    expect((await state.get('w1'))?.synced).toBe(false)
    expect((await state.get('w1'))?.driveFileId).toBe('f') // kept for re-share
    expect(applyPulled).not.toHaveBeenCalled() // local data untouched
  })
  it('pull drops sync on a 403 without touching local stores', async () => {
    const applyPulled = vi.fn()
    const client = { pull: vi.fn(async () => { throw new SyncForbiddenError() }), push: vi.fn(), enableSync: vi.fn() } as any
    const { port } = stores({ collections: [], environments: [] })
    port.applyPulled = applyPulled
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'viewer', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'me' }).pull('w1')
    expect((await state.get('w1'))?.synced).toBe(false)
    expect(applyPulled).not.toHaveBeenCalled()
  })

  it('push drops sync and reports onSyncError on a 404 (workspace gone server-side), keeping local data', async () => {
    const applyPulled = vi.fn()
    const onSyncError = vi.fn()
    const client = { push: vi.fn(async () => { throw new SyncGoneError() }), enableSync: vi.fn(), pull: pullEmpty() } as any
    const { port } = stores({ collections: [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }], environments: [] })
    port.applyPulled = applyPulled
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'owner', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'me', onSyncError }).push('w1')
    expect((await state.get('w1'))?.synced).toBe(false)
    expect((await state.get('w1'))?.driveFileId).toBe('f') // kept
    expect(applyPulled).not.toHaveBeenCalled()
    expect(onSyncError).toHaveBeenCalledWith('w1', expect.any(SyncGoneError))
  })

  it('push on a 401 calls onAuthLost, does NOT dropSync, and never touches local stores', async () => {
    const applyPulled = vi.fn()
    const onAuthLost = vi.fn()
    const onSyncError = vi.fn()
    const client = { push: vi.fn(async () => { throw new SyncAuthError() }), enableSync: vi.fn(), pull: pullEmpty() } as any
    const { port } = stores({ collections: [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }], environments: [] })
    port.applyPulled = applyPulled
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'owner', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'me', onAuthLost, onSyncError }).push('w1')
    expect(onAuthLost).toHaveBeenCalledTimes(1)
    expect((await state.get('w1'))?.synced).toBe(true) // NOT dropped — account-wide auth loss, not per-workspace
    expect(applyPulled).not.toHaveBeenCalled()
    expect(onSyncError).not.toHaveBeenCalled()
  })

  it('push on a generic/network error reports onSyncError, does not rethrow, and does not touch local stores', async () => {
    const applyPulled = vi.fn()
    const onSyncError = vi.fn()
    const boom = new Error('fetch failed')
    const client = { push: vi.fn(async () => { throw boom }), enableSync: vi.fn(), pull: pullEmpty() } as any
    const { port } = stores({ collections: [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }], environments: [] })
    port.applyPulled = applyPulled
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'owner', lastRevision: '1', synced: true })
    await expect(new SyncManager({ client, state, stores: port, email: () => 'me', onSyncError }).push('w1')).resolves.toBeUndefined()
    expect((await state.get('w1'))?.synced).toBe(true) // untouched, will retry next tick
    expect(applyPulled).not.toHaveBeenCalled()
    expect(onSyncError).toHaveBeenCalledWith('w1', boom)
  })

  it('multi-account: enable binds the workspace to an account and push uses that account\'s client', async () => {
    const calls: string[] = []
    const clientA = { enableSync: vi.fn(async () => { calls.push('A.enable'); return { driveFileId: 'f', revision: '1' } }), pull: vi.fn(async () => { throw new SyncGoneError() }), push: vi.fn(async () => { calls.push('A.push'); return { ok: true, revision: '2' } }) } as any
    const clientB = { enableSync: vi.fn(async () => { calls.push('B.enable'); return { driveFileId: 'fb', revision: '1' } }), pull: vi.fn(async () => { throw new SyncGoneError() }), push: vi.fn(async () => { calls.push('B.push'); return { ok: true, revision: '9' } }) } as any
    const clientFor = (id?: string) => (id === 'accB' ? clientB : clientA)
    const { port } = stores({ collections: [col()], environments: [] })
    const state = new SyncStateStore(dir)
    const mgr = new SyncManager({ clientFor, accounts: () => ['accA', 'accB'], state, stores: port, email: (id) => `${id}@x.com` })

    await mgr.enable('w1', 'accB')
    expect((await state.get('w1'))?.accountId).toBe('accB')
    expect(clientB.enableSync).toHaveBeenCalled()
    expect(clientA.enableSync).not.toHaveBeenCalled()

    await mgr.push('w1')
    expect(calls).toContain('B.push')
    expect(calls).not.toContain('A.push') // used the bound account's client
  })

  it('adoptRemoteWorkspaces(onlyAccountId) sweeps just that account (force sync)', async () => {
    const snap = JSON.stringify({ version: 1, workspaceId: 'wB', name: 'WB', collections: [], environments: [], updatedAt: 1, updatedBy: 'me' })
    const listedA = vi.fn(async () => [{ id: 'wA', name: 'WA', driveFileId: 'fa', revision: '1', role: 'owner' }])
    const listedB = vi.fn(async () => [{ id: 'wB', name: 'WB', driveFileId: 'fb', revision: '1', role: 'owner' }])
    const clientA = { recover: vi.fn(async () => ({})), listWorkspaces: listedA, pull: vi.fn(async () => ({ snapshot: snap, revision: '1', role: 'owner' })) } as any
    const clientB = { recover: vi.fn(async () => ({})), listWorkspaces: listedB, pull: vi.fn(async () => ({ snapshot: snap, revision: '1', role: 'owner' })) } as any
    const clientFor = (id?: string) => (id === 'accB' ? clientB : clientA)
    const { port } = stores({ collections: [], environments: [] })
    const state = new SyncStateStore(dir)
    const mgr = new SyncManager({ clientFor, accounts: () => ['accA', 'accB'], state, stores: port, email: (id) => `${id}@x.com` })

    const res = await mgr.adoptRemoteWorkspaces('accB')
    expect(listedB).toHaveBeenCalled()
    expect(listedA).not.toHaveBeenCalled() // scoped: account A untouched
    expect(res.adopted).toEqual(['wB'])
    expect((await state.get('wB'))?.accountId).toBe('accB')
  })

  it('deleteSync calls client.deleteWorkspace then drops sync locally', async () => {
    const deleteWorkspace = vi.fn(async () => {})
    const client = { deleteWorkspace, push: vi.fn(), pull: vi.fn(), enableSync: vi.fn() } as any
    const { port } = stores({ collections: [], environments: [] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'owner', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'me' }).deleteSync('w1')
    expect(deleteWorkspace).toHaveBeenCalledWith('w1')
    expect((await state.get('w1'))?.synced).toBe(false)
    expect((await state.get('w1'))?.driveFileId).toBe('f')
  })

  it('deleteSync tolerates a SyncGoneError (already gone) and still drops sync locally', async () => {
    const deleteWorkspace = vi.fn(async () => { throw new SyncGoneError() })
    const client = { deleteWorkspace, push: vi.fn(), pull: vi.fn(), enableSync: vi.fn() } as any
    const { port } = stores({ collections: [], environments: [] })
    const state = new SyncStateStore(dir)
    await state.set('w1', { driveFileId: 'f', ownerEmail: 'o@x.com', role: 'owner', lastRevision: '1', synced: true })
    await new SyncManager({ client, state, stores: port, email: () => 'me' }).deleteSync('w1')
    expect((await state.get('w1'))?.synced).toBe(false)
  })
})
