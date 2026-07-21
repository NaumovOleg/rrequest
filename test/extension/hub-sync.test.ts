import { describe, it, expect, vi } from 'vitest'
import { Hub } from '../../src/extension/hub'
import type { HostMessage } from '../../src/shared/types'

const snapshot = async (): Promise<HostMessage[]> => [{ type: 'tree', collections: [] }]

describe('Hub sync hooks', () => {
  it('calls afterDispatch with the message after a dispatch', async () => {
    const hub = new Hub(async () => undefined, snapshot)
    const after = vi.fn()
    hub.setAfterDispatch(after)
    await hub.dispatch('sidebar', { type: 'saveRequest', collectionId: 'c1', request: {} as any })
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ type: 'saveRequest' }))
  })
  it('refresh re-broadcasts the snapshot to all sinks', async () => {
    const hub = new Hub(async () => undefined, snapshot)
    const got: HostMessage[] = []
    hub.register('req:1', (m) => got.push(m))
    await hub.refresh()
    expect(got.map((m) => m.type)).toEqual(['tree'])
  })
})
