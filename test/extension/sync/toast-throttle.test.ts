import { describe, it, expect, vi } from 'vitest'
import { makeToastThrottle } from '../../../src/extension/sync/toast-throttle'

describe('makeToastThrottle', () => {
  it('drops a repeat of the same message within the window', () => {
    const emit = vi.fn()
    let t = 0
    const throttled = makeToastThrottle(emit, 15000, () => t)
    throttled('error', 'Could not reach the sync server; will retry.')
    t += 5000
    throttled('error', 'Could not reach the sync server; will retry.')
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('error', 'Could not reach the sync server; will retry.')
  })

  it('emits again once the window has elapsed', () => {
    const emit = vi.fn()
    let t = 0
    const throttled = makeToastThrottle(emit, 15000, () => t)
    throttled('error', 'msg')
    t += 15001
    throttled('error', 'msg')
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('does not throttle at exactly the window boundary (>= interval elapsed)', () => {
    const emit = vi.fn()
    let t = 0
    const throttled = makeToastThrottle(emit, 15000, () => t)
    throttled('error', 'msg')
    t += 15000
    throttled('error', 'msg')
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('is keyed by message: a different message within the window emits immediately', () => {
    const emit = vi.fn()
    let t = 0
    const throttled = makeToastThrottle(emit, 15000, () => t)
    throttled('error', 'Could not reach the sync server; will retry.')
    t += 1000
    throttled('info', 'This workspace was deleted by its owner; your local copy was kept.')
    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenNthCalledWith(1, 'error', 'Could not reach the sync server; will retry.')
    expect(emit).toHaveBeenNthCalledWith(2, 'info', 'This workspace was deleted by its owner; your local copy was kept.')
  })

  it('defaults now to Date.now when not provided', () => {
    const emit = vi.fn()
    const throttled = makeToastThrottle(emit, 15000)
    throttled('error', 'msg')
    throttled('error', 'msg')
    expect(emit).toHaveBeenCalledTimes(1)
  })
})
