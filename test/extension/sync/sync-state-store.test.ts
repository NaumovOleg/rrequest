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
  it('survives concurrent set() calls for different workspaces (no lost update)', async () => {
    // Unserialized callers (poll loop, debounced push, direct commands) can
    // legitimately call set() at the same time for different workspaces — a
    // read-modify-write without a lock would let one overwrite the other.
    const s = new SyncStateStore(dir)
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => s.set(`w${i}`, st({ driveFileId: `f${i}` }))),
    )
    const all = await s.all()
    expect(Object.keys(all).sort()).toEqual(Array.from({ length: 20 }, (_, i) => `w${i}`).sort())
    for (let i = 0; i < 20; i++) expect(all[`w${i}`].driveFileId).toBe(`f${i}`)
  })
})
