import { describe, it, expect, vi } from 'vitest'
import { handleSocketData, SyncSocket } from '../../../src/extension/sync/sync-socket'

describe('handleSocketData', () => {
  it('invokes onChange for a workspace-changed message', () => {
    const onChange = vi.fn()
    handleSocketData(JSON.stringify({ type: 'workspace-changed', workspaceId: 'w1', revision: '2', updatedBy: 'a' }), onChange)
    expect(onChange).toHaveBeenCalledWith({ type: 'workspace-changed', workspaceId: 'w1', revision: '2', updatedBy: 'a' })
  })
  it('ignores other or malformed messages', () => {
    const onChange = vi.fn()
    handleSocketData(JSON.stringify({ type: 'other' }), onChange)
    handleSocketData('not json', onChange)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SyncSocket', () => {
  it('connects with the token in the query and routes change messages', () => {
    let opened = ''
    const handlers: Record<string, (arg?: any) => void> = {}
    const fakeWs = { on: (ev: string, cb: any) => { handlers[ev] = cb }, close: vi.fn() }
    const onChange = vi.fn()
    const sock = new SyncSocket({
      url: () => 'http://localhost:8787', token: () => 'jwt-1', onChange,
      wsFactory: (u: string) => { opened = u; return fakeWs as any },
    })
    sock.start()
    expect(opened).toBe('http://localhost:8787/ws?token=jwt-1')
    handlers.message?.(Buffer.from(JSON.stringify({ type: 'workspace-changed', workspaceId: 'w1', revision: '3', updatedBy: 'a' })))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1', revision: '3' }))
    sock.stop()
    expect(fakeWs.close).toHaveBeenCalled()
  })
})
