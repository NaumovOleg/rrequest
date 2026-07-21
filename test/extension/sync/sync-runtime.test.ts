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
    const socket = { start: vi.fn(), stop: vi.fn() } as any
    const rt = createSyncRuntime({ manager, socket, onPulled: async () => {}, debounceMs: 500 })
    rt.schedulePush('w1'); rt.schedulePush('w1'); rt.schedulePush('w1')
    await vi.advanceTimersByTimeAsync(600)
    expect(manager.push).toHaveBeenCalledTimes(1)
    expect(manager.push).toHaveBeenCalledWith('w1')
    vi.useRealTimers()
  })

  it('onSocketChange skips onPulled when pullIfNewer reports nothing changed (self-pull of our own push)', async () => {
    const manager = { push: vi.fn(), pull: vi.fn(), pullIfNewer: vi.fn(async () => false) } as any
    const socket = { start: vi.fn(), stop: vi.fn() } as any
    const onPulled = vi.fn(async () => {})
    const rt = createSyncRuntime({ manager, socket, onPulled })
    await rt.onSocketChange({ type: 'workspace-changed', workspaceId: 'w1', revision: '3', updatedBy: 'me' })
    expect(manager.pullIfNewer).toHaveBeenCalledWith('w1', '3')
    expect(onPulled).not.toHaveBeenCalled()
  })

  it('onSocketChange calls onPulled once when pullIfNewer actually pulled', async () => {
    const manager = { push: vi.fn(), pull: vi.fn(), pullIfNewer: vi.fn(async () => true) } as any
    const socket = { start: vi.fn(), stop: vi.fn() } as any
    const onPulled = vi.fn(async () => {})
    const rt = createSyncRuntime({ manager, socket, onPulled })
    await rt.onSocketChange({ type: 'workspace-changed', workspaceId: 'w1', revision: '4', updatedBy: 'other' })
    expect(onPulled).toHaveBeenCalledTimes(1)
  })
})
