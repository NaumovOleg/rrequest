import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SyncStateStore } from '../../../src/extension/sync/sync-state-store'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rrequest-ss-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const st = (over = {}) => ({ driveFileId: 'f1', ownerEmail: 'a@x.com', role: 'owner' as const, lastRevision: 'r1', synced: true, ...over })

describe('SyncStateStore', () => {
  it('sets and gets per-workspace state', async () => {
    const s = new SyncStateStore(dir)
    await s.set('w1', st())
    expect((await s.get('w1'))?.driveFileId).toBe('f1')
    expect(await s.get('w2')).toBeUndefined()
  })
  it('persists across instances and returns all', async () => {
    await new SyncStateStore(dir).set('w1', st())
    await new SyncStateStore(dir).set('w2', st({ driveFileId: 'f2' }))
    const all = await new SyncStateStore(dir).all()
    expect(Object.keys(all).sort()).toEqual(['w1', 'w2'])
    expect(all.w2.driveFileId).toBe('f2')
  })
})
