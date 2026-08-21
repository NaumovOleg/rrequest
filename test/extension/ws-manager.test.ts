import { describe, it, expect, vi } from 'vitest'
import { WsManager, type WsSocket, type WsFactory } from '../../src/extension/net/ws-manager'
import type { HostMessage } from '../../src/shared/types'

function fakeSocket() {
  const handlers: Record<string, Function> = {}
  const socket: WsSocket = {
    on: (event: string, cb: Function) => { handlers[event] = cb },
    send: vi.fn(),
    close: vi.fn(),
    removeAllListeners: vi.fn(() => { for (const k of Object.keys(handlers)) delete handlers[k] }),
  } as any
  return { socket, fire: (event: string, ...args: any[]) => handlers[event]?.(...args) }
}

describe('WsManager', () => {
  it('connect wires handlers; open/message/close/error emit the right messages', () => {
    const emitted: HostMessage[] = []
    const fk = fakeSocket()
    const factory: WsFactory = () => fk.socket
    const m = new WsManager((msg) => emitted.push(msg), factory)
    m.connect('c1', 'wss://e', [{ key: 'X-A', value: '1', enabled: true }])

    fk.fire('open')
    fk.fire('message', 'hello')
    // A server-side error BEFORE close still reports both.
    fk.fire('error', new Error('boom'))
    fk.fire('close', 1000, 'bye')

    expect(emitted[0]).toEqual({ type: 'wsOpen', connId: 'c1' })
    expect(emitted[1]).toMatchObject({ type: 'wsMessage', connId: 'c1', data: 'hello' })
    expect(emitted[2]).toEqual({ type: 'wsError', connId: 'c1', message: 'boom' })
    expect(emitted[3]).toEqual({ type: 'wsClosed', connId: 'c1', code: 1000, reason: 'bye' })
  })
  it('passes enabled headers to the factory', () => {
    const factory = vi.fn(() => fakeSocket().socket)
    const m = new WsManager(() => {}, factory as any)
    m.connect('c1', 'wss://e', [{ key: 'A', value: '1', enabled: true }, { key: 'B', value: '2', enabled: false }])
    expect(factory).toHaveBeenCalledWith('wss://e', { headers: { A: '1' } })
  })
  it('send and disconnect call the socket; unknown id is a no-op', () => {
    const fk = fakeSocket()
    const m = new WsManager(() => {}, () => fk.socket)
    m.connect('c1', 'wss://e', [])
    m.send('c1', 'data'); expect(fk.socket.send).toHaveBeenCalledWith('data')
    m.disconnect('c1'); expect(fk.socket.close).toHaveBeenCalled()
    expect(() => { m.send('nope', 'x'); m.disconnect('nope') }).not.toThrow()
  })
  it('removes the socket from the registry on close', () => {
    const fk = fakeSocket()
    const send = fk.socket.send as any
    const m = new WsManager(() => {}, () => fk.socket)
    m.connect('c1', 'wss://e', [])
    fk.fire('close', 1000, '')
    m.send('c1', 'after-close')
    expect(send).not.toHaveBeenCalled()
  })
  it('emits wsError + wsClosed when the factory throws', () => {
    const emitted: HostMessage[] = []
    const m = new WsManager((msg) => emitted.push(msg), () => { throw new Error('bad url') })
    m.connect('c1', 'not a url', [])
    expect(emitted[0]).toMatchObject({ type: 'wsError', connId: 'c1' })
    expect(emitted[1]).toMatchObject({ type: 'wsClosed', connId: 'c1' })
  })
  it('disconnect strips listeners before closing and emits wsClosed exactly once', () => {
    const emitted: HostMessage[] = []
    const fk = fakeSocket()
    const m = new WsManager((msg) => emitted.push(msg), () => fk.socket)
    m.connect('c1', 'wss://e', [])
    m.disconnect('c1')
    expect(fk.socket.removeAllListeners).toHaveBeenCalled()
    expect(fk.socket.close).toHaveBeenCalled()
    expect(emitted).toEqual([{ type: 'wsClosed', connId: 'c1', code: 0, reason: 'disconnected' }])
    // A late transport-level close must not double-report (listeners are gone).
    fk.fire('close', 1006, '')
    expect(emitted).toHaveLength(1)
  })
  it('disconnectAll tears down every open connection', () => {
    const a = fakeSocket(), b = fakeSocket()
    let n = 0
    const sockets = [a.socket, b.socket]
    const m = new WsManager(() => {}, () => sockets[n++])
    m.connect('c1', 'wss://a', [])
    m.connect('c2', 'wss://b', [])
    m.disconnectAll()
    expect(a.socket.close).toHaveBeenCalled(); expect(b.socket.close).toHaveBeenCalled()
    expect(a.socket.removeAllListeners).toHaveBeenCalled(); expect(b.socket.removeAllListeners).toHaveBeenCalled()
    // Registry is empty afterwards.
    const sendA = a.socket.send as any
    m.send('c1', 'x'); expect(sendA).not.toHaveBeenCalled()
  })
  it('strips listeners on a server-side close too', () => {
    const fk = fakeSocket()
    const m = new WsManager(() => {}, () => fk.socket)
    m.connect('c1', 'wss://e', [])
    fk.fire('close', 1000, 'server bye')
    expect(fk.socket.removeAllListeners).toHaveBeenCalled()
  })
})
