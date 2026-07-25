import { describe, it, expect, vi } from 'vitest'
import { createSyncRuntime, isMutating } from '../../../src/extension/sync/sync-runtime'

describe('isMutating', () => {
  it('flags data-changing message types', () => {
    expect(isMutating('saveRequest')).toBe(true)
    expect(isMutating('deleteCollection')).toBe(true)
    expect(isMutating('saveEnvironment')).toBe(true)
    expect(isMutating('loadTree')).toBe(false)
    expect(isMutating('sendRequest')).toBe(false)
  })
})

describe('createSyncRuntime', () => {
  it('debounces schedulePush into a single manager.push', async () => {
    vi.useFakeTimers()
    const manager = { push: vi.fn(async () => {}), pull: vi.fn(async () => {}), pullIfNewer: vi.fn() } as any
    const rt = createSyncRuntime({ manager, onPulled: async () => {}, debounceMs: 500 })
    rt.schedulePush('w1'); rt.schedulePush('w1'); rt.schedulePush('w1')
    await vi.advanceTimersByTimeAsync(600)
    expect(manager.push).toHaveBeenCalledTimes(1)
    expect(manager.push).toHaveBeenCalledWith('w1')
    vi.useRealTimers()
  })

  it('exposes isReadOnly from the role cache (viewer = read-only)', async () => {
    const state = { all: async () => ({ w1: { role: 'viewer' }, w2: { role: 'editor' } }) } as any
    const manager = { push: vi.fn(), pull: vi.fn(), pullIfNewer: vi.fn(), refreshRoles: vi.fn() } as any
    const rt = createSyncRuntime({ manager, onPulled: async () => {}, state })
    await rt.refreshRoleCache()
    expect(rt.isReadOnly('w1')).toBe(true)
    expect(rt.isReadOnly('w2')).toBe(false)
    expect(rt.isReadOnly('unknown')).toBe(false)
    expect(rt.roleOf('w2')).toBe('editor')
  })

  it('syncedOf reflects the sync-state synced flag from the cache', async () => {
    const state = { all: async () => ({ w1: { role: 'owner', synced: true }, w2: { role: 'viewer', synced: false } }) } as any
    const manager = { push: vi.fn(), pull: vi.fn(), pullIfNewer: vi.fn(), refreshRoles: vi.fn() } as any
    const rt = createSyncRuntime({ manager, onPulled: async () => {}, state })
    await rt.refreshRoleCache()
    expect(rt.syncedOf('w1')).toBe(true)
    expect(rt.syncedOf('w2')).toBe(false)
    expect(rt.syncedOf('unknown')).toBe(false)
  })
})
