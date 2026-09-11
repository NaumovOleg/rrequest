import { describe, it, expect, vi } from 'vitest'
import { Hub } from '../../src/extension/hub'
import type { HostMessage, WebviewMessage } from '../../src/shared/types'

const snapshot = async (): Promise<HostMessage[]> => ([
  { type: 'tree', collections: [] },
  { type: 'environments', environments: [], activeId: null },
  { type: 'workspaces', workspaces: [], activeId: 'w1' },
  { type: 'history', entries: [] },
])

function setup(route: (m: WebviewMessage) => Promise<HostMessage | undefined>) {
  const hub = new Hub(route, snapshot)
  const editor: HostMessage[] = []
  const sidebar: HostMessage[] = []
  hub.register('req:1', (m) => editor.push(m))
  hub.register('sidebar', (m) => sidebar.push(m))
  return { hub, editor, sidebar }
}

describe('Hub', () => {
  it('broadcasts the state snapshot to every registered sink after any dispatch', async () => {
    const { hub, editor, sidebar } = setup(async () => undefined)
    await hub.dispatch('sidebar', { type: 'loadWorkspaces' })
    expect(editor.map((m) => m.type)).toEqual(['tree', 'environments', 'workspaces', 'history'])
    expect(sidebar.map((m) => m.type)).toEqual(['tree', 'environments', 'workspaces', 'history'])
  })
  it('sends a response reply only to the sender', async () => {
    const resp: HostMessage = { type: 'response', requestId: 'q', payload: {} as any }
    const { editor, sidebar, hub } = setup(async () => resp)
    await hub.dispatch('req:1', { type: 'sendRequest', requestId: 'q', payload: {} as any })
    expect(editor[0]).toEqual(resp)               // targeted to sender first
    expect(sidebar.find((m) => m.type === 'response')).toBeUndefined()
  })
  it('routes a response to the panel that sent it, not other panels', async () => {
    const resp: HostMessage = { type: 'response', requestId: 'q', payload: {} as any }
    const hub = new Hub(async () => resp, snapshot)
    const p1: HostMessage[] = []
    const p2: HostMessage[] = []
    hub.register('req:1', (m) => p1.push(m))
    hub.register('req:2', (m) => p2.push(m))
    await hub.dispatch('req:2', { type: 'sendRequest', requestId: 'q', payload: {} as any })
    expect(p2.find((m) => m.type === 'response')).toEqual(resp)
    expect(p1.find((m) => m.type === 'response')).toBeUndefined()
  })
  it('hands an openInEditor reply to onOpen instead of posting it to a sink', async () => {
    const oie: HostMessage = { type: 'openInEditor', request: {} as any }
    const { editor, sidebar, hub } = setup(async () => oie)
    const onOpen = vi.fn()
    hub.setOpen(onOpen)
    await hub.dispatch('sidebar', { type: 'openRequest', request: {} as any })
    expect(onOpen).toHaveBeenCalledWith(oie)
    expect(editor.find((m) => m.type === 'openInEditor')).toBeUndefined()
    expect(sidebar.find((m) => m.type === 'openInEditor')).toBeUndefined()
  })
  it('hands showEnvironments and showWebSocket replies to onOpen', async () => {
    for (const reply of [{ type: 'showEnvironments' }, { type: 'showWebSocket' }] as HostMessage[]) {
      const hub = new Hub(async () => reply, snapshot)
      const onOpen = vi.fn()
      hub.setOpen(onOpen)
      await hub.dispatch('sidebar', { type: 'openEnvironments' })
      expect(onOpen).toHaveBeenCalledWith(reply)
    }
  })
  it('does not call onOpen for non-open replies', async () => {
    const resp: HostMessage = { type: 'response', requestId: 'q', payload: {} as any }
    const { hub } = setup(async () => resp)
    const onOpen = vi.fn()
    hub.setOpen(onOpen)
    await hub.dispatch('req:1', { type: 'sendRequest', requestId: 'q', payload: {} as any })
    expect(onOpen).not.toHaveBeenCalled()
  })
  it('emitTo posts only to the named sink', () => {
    const { hub, editor, sidebar } = setup(async () => undefined)
    hub.emitTo('req:1', { type: 'wsOpen', connId: 'c1' })
    expect(editor).toContainEqual({ type: 'wsOpen', connId: 'c1' })
    expect(sidebar.find((m) => m.type === 'wsOpen')).toBeUndefined()
  })
  it('a route() that throws surfaces an error toast to the sender instead of hanging', async () => {
    const { hub, editor } = setup(async () => { throw new Error('boom') })
    await hub.dispatch('req:1', { type: 'sendRequest', requestId: 'q', payload: {} as any })
    expect(editor.find((m) => m.type === 'toast' && m.level === 'error')).toBeTruthy()
  })
  it('a route() that throws does not poison future dispatches (the hub keeps working)', async () => {
    const { hub, editor } = setup(async (m) => { if (m.type === 'sendRequest') throw new Error('boom'); return undefined })
    await hub.dispatch('req:1', { type: 'sendRequest', requestId: 'q', payload: {} as any })
    editor.length = 0
    await hub.dispatch('req:1', { type: 'loadWorkspaces' })
    // The second dispatch must still broadcast the snapshot — proof the hub
    // wasn't left permanently stuck after the first dispatch's error.
    expect(editor.map((m) => m.type)).toEqual(['tree', 'environments', 'workspaces', 'history'])
  })
  it('route() calls run concurrently — a slow dispatch on one panel does not block another panel', async () => {
    let releaseSlow: () => void = () => {}
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve })
    const order: string[] = []
    const hub = new Hub(async (m) => {
      if (m.type === 'sendRequest') { order.push('slow-start'); await slowGate; order.push('slow-end') }
      else order.push('fast')
      return undefined
    }, snapshot)
    hub.register('req:1', () => {})
    hub.register('req:2', () => {})
    const slow = hub.dispatch('req:1', { type: 'sendRequest', requestId: 'q', payload: {} as any })
    // The fast dispatch on a DIFFERENT panel must complete without waiting for
    // the slow one to release — proves route() isn't serialized across panels.
    await hub.dispatch('req:2', { type: 'loadWorkspaces' })
    expect(order).toEqual(['slow-start', 'fast'])
    releaseSlow()
    await slow
    expect(order).toEqual(['slow-start', 'fast', 'slow-end'])
  })
})

describe('Hub sink GC (idle eviction)', () => {
  const msg: WebviewMessage = { type: 'loadWorkspaces' }
  it('evicts sinks idle past the timeout and reports has()', async () => {
    vi.useFakeTimers()
    try {
      const hub = new Hub(async () => undefined, snapshot, { sinkIdleMs: 10_000, sweepEveryMs: 5_000 })
      const got: HostMessage[] = []
      hub.register('a', (m) => got.push(m))
      hub.register('b', (m) => got.push(m))
      await hub.dispatch('a', msg)
      expect(got).toHaveLength(8) // 4 snapshots × 2 sinks
      vi.advanceTimersByTime(70_000) // total silence past idle + sweep windows
      await hub.dispatch('other', msg) // piggybacks the sweep
      expect(hub.has('a')).toBe(false)
      expect(hub.has('b')).toBe(false)
      expect(got).toHaveLength(8) // post-eviction broadcast went nowhere
      // A live surface re-registers itself (see panel self-heal) and works again.
      hub.register('a', (m) => got.push(m))
      await hub.dispatch('a', msg)
      expect(got).toHaveLength(12) // 4 new snapshots to re-registered a
    } finally {
      vi.useRealTimers()
    }
  })
  it('traffic keeps sinks alive across sweeps', async () => {
    vi.useFakeTimers()
    try {
      const hub = new Hub(async () => undefined, snapshot, { sinkIdleMs: 10_000, sweepEveryMs: 5_000 })
      hub.register('a', () => {})
      hub.register('b', () => {})
      for (let i = 0; i < 3; i++) {
        await hub.dispatch('a', msg) // every dispatch broadcasts -> touches a AND b
        vi.advanceTimersByTime(6_000) // past the sweep interval, under idle timeout
      }
      expect(hub.has('a')).toBe(true)
      // b never dispatched but kept receiving deliveries, so it stays warm too.
      expect(hub.has('b')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
  it('re-registering over an evicted id works and has() reflects it', async () => {
    vi.useFakeTimers()
    try {
      const hub = new Hub(async () => undefined, snapshot, { sinkIdleMs: 10_000, sweepEveryMs: 5_000 })
      hub.register('a', () => {})
      vi.advanceTimersByTime(70_000)
      await hub.dispatch('x', msg)
      expect(hub.has('a')).toBe(false)
      hub.register('a', () => {})
      expect(hub.has('a')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
