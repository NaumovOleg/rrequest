import { describe, it, expect } from 'vitest'
import type { WebviewMessage, HostMessage } from '../../src/shared/types'

describe('ws types', () => {
  it('ws webview + host arms type-check', () => {
    const a: WebviewMessage = { type: 'wsConnect', connId: 'x', url: 'wss://e', headers: [] }
    const b: WebviewMessage = { type: 'wsSend', connId: 'x', data: 'hi' }
    const c: WebviewMessage = { type: 'wsDisconnect', connId: 'x' }
    const d: HostMessage = { type: 'wsOpen', connId: 'x' }
    const e: HostMessage = { type: 'wsMessage', connId: 'x', data: 'hi', at: 1 }
    const f: HostMessage = { type: 'wsClosed', connId: 'x', code: 1000, reason: 'bye' }
    const g: HostMessage = { type: 'wsError', connId: 'x', message: 'boom' }
    expect([a.type, b.type, c.type, d.type, e.type, f.type, g.type]).toEqual(
      ['wsConnect', 'wsSend', 'wsDisconnect', 'wsOpen', 'wsMessage', 'wsClosed', 'wsError'])
  })
})
