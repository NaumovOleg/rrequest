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
})
