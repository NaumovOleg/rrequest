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
    const manager = { push: vi.fn(async () => {}), pull: vi.fn(async () => {}) } as any
    const socket = { start: vi.fn(), stop: vi.fn() } as any
    const rt = createSyncRuntime({ manager, socket, onPulled: async () => {}, debounceMs: 500 })
    rt.schedulePush('w1'); rt.schedulePush('w1'); rt.schedulePush('w1')
    await vi.advanceTimersByTimeAsync(600)
    expect(manager.push).toHaveBeenCalledTimes(1)
    expect(manager.push).toHaveBeenCalledWith('w1')
    vi.useRealTimers()
  })
})
