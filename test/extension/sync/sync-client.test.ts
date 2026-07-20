import { describe, it, expect, vi } from 'vitest'
import { SyncClient } from '../../../src/extension/sync/sync-client'

function fetchMock(handler: (url: string, init: any) => { status: number; body: any }) {
  return vi.fn(async (url: string, init: any) => {
    const { status, body } = handler(url, init)
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as any
  })
}

const client = (fetchImpl: any) => new SyncClient({ baseUrl: 'http://localhost:8787', getToken: () => 'jwt-1', fetchImpl })

describe('SyncClient', () => {
  it('me() calls /me with the bearer token', async () => {
    let seen: any
    const f = fetchMock((url, init) => { seen = { url, init }; return { status: 200, body: { id: 'u1', email: 'a@x.com' } } })
    const me = await client(f).me()
    expect(me.email).toBe('a@x.com')
    expect(seen.url).toBe('http://localhost:8787/me')
    expect(seen.init.headers.authorization).toBe('Bearer jwt-1')
  })
  it('enableSync POSTs the snapshot and returns driveFileId + revision', async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe('http://localhost:8787/workspaces')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({ workspaceId: 'w1', name: 'W', snapshot: '{"v":1}' })
      return { status: 201, body: { driveFileId: 'f1', revision: '1' } }
    })
    expect(await client(f).enableSync('w1', 'W', '{"v":1}')).toEqual({ driveFileId: 'f1', revision: '1' })
  })
  it('push PUTs to /workspaces/:id', async () => {
    const f = fetchMock((url, init) => { expect(url).toBe('http://localhost:8787/workspaces/w1'); expect(init.method).toBe('PUT'); return { status: 200, body: { revision: '2' } } })
    expect(await client(f).push('w1', '{"v":2}')).toEqual({ revision: '2' })
  })
  it('pull GETs /workspaces/:id', async () => {
    const f = fetchMock(() => ({ status: 200, body: { snapshot: '{"v":2}', revision: '2' } }))
    expect(await client(f).pull('w1')).toEqual({ snapshot: '{"v":2}', revision: '2' })
  })
  it('throws on a non-2xx response', async () => {
    const f = fetchMock(() => ({ status: 403, body: { error: 'forbidden' } }))
    await expect(client(f).push('w1', '{}')).rejects.toThrow(/403/)
  })
})
