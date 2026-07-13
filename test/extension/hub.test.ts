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
  hub.register('editor', (m) => editor.push(m))
  hub.register('sidebar', (m) => sidebar.push(m))
  return { hub, editor, sidebar }
}

describe('Hub', () => {
  it('broadcasts the state snapshot to both surfaces after any dispatch', async () => {
    const { hub, editor, sidebar } = setup(async () => undefined)
    await hub.dispatch('sidebar', { type: 'loadWorkspaces' })
    expect(editor.map((m) => m.type)).toEqual(['tree', 'environments', 'workspaces', 'history'])
    expect(sidebar.map((m) => m.type)).toEqual(['tree', 'environments', 'workspaces', 'history'])
  })
  it('sends a response reply only to the sender', async () => {
    const resp: HostMessage = { type: 'response', requestId: 'q', payload: {} as any }
    const { editor, sidebar, hub } = setup(async () => resp)
    await hub.dispatch('editor', { type: 'sendRequest', requestId: 'q', payload: {} as any })
    expect(editor[0]).toEqual(resp)               // targeted to sender first
    expect(sidebar.find((m) => m.type === 'response')).toBeUndefined()
  })
  it('routes openInEditor to the editor even when the sidebar sent openRequest', async () => {
    const oie: HostMessage = { type: 'openInEditor', request: {} as any }
    const { editor, sidebar, hub } = setup(async () => oie)
    await hub.dispatch('sidebar', { type: 'openRequest', request: {} as any })
    expect(editor.find((m) => m.type === 'openInEditor')).toEqual(oie)
    expect(sidebar.find((m) => m.type === 'openInEditor')).toBeUndefined()
  })
  it('reveals the editor before posting openInEditor', async () => {
    const oie: HostMessage = { type: 'openInEditor', request: {} as any }
    const { hub } = setup(async () => oie)
    const reveal = vi.fn()
    hub.setEditorReveal(reveal)
    await hub.dispatch('sidebar', { type: 'openRequest', request: {} as any })
    expect(reveal).toHaveBeenCalledOnce()
  })
  it('does not call the editor-reveal hook for non-openInEditor replies', async () => {
    const resp: HostMessage = { type: 'response', requestId: 'q', payload: {} as any }
    const { hub } = setup(async () => resp)
    const reveal = vi.fn()
    hub.setEditorReveal(reveal)
    await hub.dispatch('editor', { type: 'sendRequest', requestId: 'q', payload: {} as any })
    expect(reveal).not.toHaveBeenCalled()
  })
  it('queues openInEditor until an editor sink registers, then flushes it', async () => {
    const oie: HostMessage = { type: 'openInEditor', request: {} as any }
    const hub = new Hub(async () => oie, snapshot)
    const sidebar: HostMessage[] = []
    hub.register('sidebar', (m) => sidebar.push(m))
    // No editor sink registered yet: dispatch must not throw and must queue.
    await expect(hub.dispatch('sidebar', { type: 'openRequest', request: {} as any })).resolves.toBeUndefined()
    expect(sidebar.find((m) => m.type === 'openInEditor')).toBeUndefined()
    // Registering the editor sink flushes the queued openInEditor in order.
    const editor: HostMessage[] = []
    hub.register('editor', (m) => editor.push(m))
    expect(editor).toEqual([oie])
  })
  it('emitToEditor posts only to the editor sink', () => {
    const { hub, editor, sidebar } = setup(async () => undefined)
    hub.emitToEditor({ type: 'wsOpen', connId: 'c1' })
    expect(editor).toContainEqual({ type: 'wsOpen', connId: 'c1' })
    expect(sidebar.find((m) => m.type === 'wsOpen')).toBeUndefined()
  })
})
