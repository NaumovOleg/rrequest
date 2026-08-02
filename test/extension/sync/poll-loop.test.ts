import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPollLoop } from '../../../src/extension/sync/poll-loop'

describe('createPollLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pulls a synced workspace whose server revision moved on, then calls onPulled', async () => {
    const listWorkspaces = vi.fn(async () => [{ id: 'w1', revision: '5' }])
    const state = { get: vi.fn(async () => ({ lastRevision: '3', synced: true })) }
    const pullIfNewer = vi.fn(async () => true)
    const onPulled = vi.fn(async () => {})
    const loop = createPollLoop({ listWorkspaces, state, pullIfNewer, onPulled, intervalMs: 1000 })

    loop.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(pullIfNewer).toHaveBeenCalledWith('w1', '5')
    expect(onPulled).toHaveBeenCalledTimes(1)
    loop.stop()
  })

  it('skips the tick (no network) when isAuthed() returns false', async () => {
    const listWorkspaces = vi.fn(async () => [{ id: 'w1', revision: '5' }])
    const state = { get: vi.fn(async () => ({ lastRevision: '3', synced: true })) }
    const pullIfNewer = vi.fn(async () => true)
    const onPulled = vi.fn(async () => {})
    const loop = createPollLoop({ listWorkspaces, state, pullIfNewer, onPulled, isAuthed: () => false, intervalMs: 1000 })

    loop.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(listWorkspaces).not.toHaveBeenCalled()
    expect(pullIfNewer).not.toHaveBeenCalled()
    loop.stop()
  })

  it('does nothing when the server revision matches the last-known revision', async () => {
    const listWorkspaces = vi.fn(async () => [{ id: 'w1', revision: '3' }])
    const state = { get: vi.fn(async () => ({ lastRevision: '3', synced: true })) }
    const pullIfNewer = vi.fn(async () => true)
    const onPulled = vi.fn(async () => {})
    const loop = createPollLoop({ listWorkspaces, state, pullIfNewer, onPulled, intervalMs: 1000 })

    loop.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(pullIfNewer).not.toHaveBeenCalled()
    expect(onPulled).not.toHaveBeenCalled()
    loop.stop()
  })

  it('skips a workspace that is not locally synced', async () => {
    const listWorkspaces = vi.fn(async () => [{ id: 'w1', revision: '5' }])
    const state = { get: vi.fn(async () => ({ lastRevision: '3', synced: false })) }
    const pullIfNewer = vi.fn(async () => true)
    const onPulled = vi.fn(async () => {})
    const loop = createPollLoop({ listWorkspaces, state, pullIfNewer, onPulled, intervalMs: 1000 })

    loop.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(pullIfNewer).not.toHaveBeenCalled()
    expect(onPulled).not.toHaveBeenCalled()
    loop.stop()
  })

  it('skips a workspace with no local state at all', async () => {
    const listWorkspaces = vi.fn(async () => [{ id: 'w1', revision: '5' }])
    const state = { get: vi.fn(async () => undefined) }
    const pullIfNewer = vi.fn(async () => true)
    const onPulled = vi.fn(async () => {})
    const loop = createPollLoop({ listWorkspaces, state, pullIfNewer, onPulled, intervalMs: 1000 })

    loop.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(pullIfNewer).not.toHaveBeenCalled()
    expect(onPulled).not.toHaveBeenCalled()
    loop.stop()
  })

  it('does not call onPulled when nothing was actually pulled', async () => {
    const listWorkspaces = vi.fn(async () => [{ id: 'w1', revision: '5' }])
    const state = { get: vi.fn(async () => ({ lastRevision: '3', synced: true })) }
    const pullIfNewer = vi.fn(async () => false)
    const onPulled = vi.fn(async () => {})
    const loop = createPollLoop({ listWorkspaces, state, pullIfNewer, onPulled, intervalMs: 1000 })

    loop.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(pullIfNewer).toHaveBeenCalledWith('w1', '5')
    expect(onPulled).not.toHaveBeenCalled()
    loop.stop()
  })

  it('a throwing tick does not kill the timer: the next tick still runs normally', async () => {
    let call = 0
    const listWorkspaces = vi.fn(async () => {
      call += 1
      if (call === 1) throw new Error('network down')
      return [{ id: 'w1', revision: '5' }]
    })
    const state = { get: vi.fn(async () => ({ lastRevision: '3', synced: true })) }
    const pullIfNewer = vi.fn(async () => true)
    const onPulled = vi.fn(async () => {})
    const loop = createPollLoop({ listWorkspaces, state, pullIfNewer, onPulled, intervalMs: 1000 })

    loop.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(pullIfNewer).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(pullIfNewer).toHaveBeenCalledWith('w1', '5')
    expect(onPulled).toHaveBeenCalledTimes(1)
    loop.stop()
  })

  it('stop() clears the timer so no further ticks run', async () => {
    const listWorkspaces = vi.fn(async () => [{ id: 'w1', revision: '5' }])
    const state = { get: vi.fn(async () => ({ lastRevision: '3', synced: true })) }
    const pullIfNewer = vi.fn(async () => true)
    const onPulled = vi.fn(async () => {})
    const loop = createPollLoop({ listWorkspaces, state, pullIfNewer, onPulled, intervalMs: 1000 })

    loop.start()
    loop.stop()
    await vi.advanceTimersByTimeAsync(5000)

    expect(listWorkspaces).not.toHaveBeenCalled()
  })
})
