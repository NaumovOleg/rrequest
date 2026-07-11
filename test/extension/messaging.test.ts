import { describe, it, expect, vi } from 'vitest'
import { createRouter } from '../../src/extension/messaging'
import { newId, type HttpResponse, type RestRequest, type WebviewMessage } from '../../src/shared/types'

function req(): RestRequest {
  return { id: newId(), name: 'r', method: 'GET', url: 'https://x', params: [], headers: [], body: { mode: 'none' } }
}
const fakeResp: HttpResponse = {
  status: 200, statusText: 'OK', headers: [], body: 'ok',
  bodyTruncated: false, timeMs: 1, sizeBytes: 2, cookies: [],
}

function deps() {
  return {
    send: vi.fn(async () => fakeResp),
    collections: { list: vi.fn(async () => []), createCollection: vi.fn(async (n: string) => ({ id: 'c1', name: n, requests: [] })), saveRequest: vi.fn(async () => ({ id: 'c1', name: 'c', requests: [] })) } as any,
    history: { append: vi.fn(async () => {}), list: vi.fn(async () => []) } as any,
  }
}

describe('createRouter', () => {
  it('routes sendRequest to send and returns a response message', async () => {
    const d = deps()
    const route = createRouter(d)
    const msg: WebviewMessage = { type: 'sendRequest', requestId: 'q1', payload: req() }
    const out = await route(msg)
    expect(out).toEqual({ type: 'response', requestId: 'q1', payload: fakeResp })
    expect(d.send).toHaveBeenCalledOnce()
    expect(d.history.append).toHaveBeenCalledOnce()
  })

  it('routes loadTree to a tree message', async () => {
    const d = deps()
    const out = await createRouter(d)({ type: 'loadTree' })
    expect(out).toEqual({ type: 'tree', collections: [] })
  })

  it('returns undefined for an unknown message type', async () => {
    const out = await createRouter(deps())({ type: 'bogus' } as any)
    expect(out).toBeUndefined()
  })
})
