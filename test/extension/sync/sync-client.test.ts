import { describe, it, expect, vi } from 'vitest'
import { SyncClient, SyncForbiddenError, SyncAuthError, SyncGoneError } from '../../../src/extension/sync/sync-client'

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
  it('push PUTs {snapshot, baseRevision} and returns ok on 200', async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe('http://localhost:8787/workspaces/w1')
      expect(init.method).toBe('PUT')
      expect(JSON.parse(init.body)).toEqual({ snapshot: '{"v":2}', baseRevision: '1' })
      return { status: 200, body: { revision: '2' } }
    })
    expect(await client(f).push('w1', '{"v":2}', '1')).toEqual({ ok: true, revision: '2' })
  })
  it('push returns a conflict object on 409', async () => {
    const f = fetchMock(() => ({ status: 409, body: { snapshot: '{"v":9}', revision: '5' } }))
    expect(await client(f).push('w1', '{"v":2}', '1')).toEqual({ ok: false, conflict: true, snapshot: '{"v":9}', revision: '5' })
  })
  it('pull GETs /workspaces/:id', async () => {
    const f = fetchMock(() => ({ status: 200, body: { snapshot: '{"v":2}', revision: '2' } }))
    expect(await client(f).pull('w1')).toEqual({ snapshot: '{"v":2}', revision: '2' })
  })
  it('throws on a non-2xx response', async () => {
    const f = fetchMock(() => ({ status: 403, body: { error: 'forbidden' } }))
    await expect(client(f).push('w1', '{}', '1')).rejects.toBeInstanceOf(SyncForbiddenError)
  })
})

describe('SyncClient members + 403', () => {
  it('listMembers GETs the members array', async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe('http://localhost:8787/workspaces/w1/members')
      expect(init.method ?? 'GET').toBe('GET')
      return { status: 200, body: { members: [{ email: 'o@x.com', role: 'owner', pending: false }, { id: 'm1', email: 'e@x.com', role: 'editor', pending: false }] } }
    })
    const list = await client(f).listMembers('w1')
    expect(list).toHaveLength(2)
    expect(list[1]).toMatchObject({ id: 'm1', role: 'editor' })
  })
  it('addMember POSTs email+role and returns the member', async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe('http://localhost:8787/workspaces/w1/members')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({ email: 'n@x.com', role: 'viewer' })
      return { status: 201, body: { id: 'm2', email: 'n@x.com', role: 'viewer', pending: true } }
    })
    expect(await client(f).addMember('w1', { email: 'n@x.com', role: 'viewer' })).toMatchObject({ id: 'm2', pending: true })
  })
  it('removeMember DELETEs the member', async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe('http://localhost:8787/workspaces/w1/members/m1')
      expect(init.method).toBe('DELETE')
      return { status: 200, body: { ok: true } }
    })
    await client(f).removeMember('w1', 'm1')
  })
  it('a 403 on a GET throws SyncForbiddenError', async () => {
    const f = fetchMock(() => ({ status: 403, body: { error: 'forbidden' } }))
    await expect(client(f).pull('w1')).rejects.toBeInstanceOf(SyncForbiddenError)
  })
  it('a 403 on push throws SyncForbiddenError', async () => {
    const f = fetchMock(() => ({ status: 403, body: { error: 'forbidden' } }))
    await expect(client(f).push('w1', '{}', '1')).rejects.toBeInstanceOf(SyncForbiddenError)
  })
})

describe('SyncClient 401/404 + deleteWorkspace', () => {
  it('a 401 on pull throws SyncAuthError', async () => {
    const f = fetchMock(() => ({ status: 401, body: { error: 'unauthorized' } }))
    await expect(client(f).pull('w1')).rejects.toBeInstanceOf(SyncAuthError)
  })
  it('a 404 on pull throws SyncGoneError', async () => {
    const f = fetchMock(() => ({ status: 404, body: { error: 'not found' } }))
    await expect(client(f).pull('w1')).rejects.toBeInstanceOf(SyncGoneError)
  })
  it('a 401 on push throws SyncAuthError', async () => {
    const f = fetchMock(() => ({ status: 401, body: { error: 'unauthorized' } }))
    await expect(client(f).push('w1', '{}', '1')).rejects.toBeInstanceOf(SyncAuthError)
  })
  it('a 404 on push throws SyncGoneError', async () => {
    const f = fetchMock(() => ({ status: 404, body: { error: 'not found' } }))
    await expect(client(f).push('w1', '{}', '1')).rejects.toBeInstanceOf(SyncGoneError)
  })
  it('deleteWorkspace DELETEs /workspaces/:id', async () => {
    const f = fetchMock((url, init) => {
      expect(url).toBe('http://localhost:8787/workspaces/w1')
      expect(init.method).toBe('DELETE')
      return { status: 200, body: { ok: true } }
    })
    await client(f).deleteWorkspace('w1')
  })
  it('deleteWorkspace throws SyncForbiddenError on 403', async () => {
    const f = fetchMock(() => ({ status: 403, body: { error: 'forbidden' } }))
    await expect(client(f).deleteWorkspace('w1')).rejects.toBeInstanceOf(SyncForbiddenError)
  })
  it('deleteWorkspace throws SyncGoneError on 404', async () => {
    const f = fetchMock(() => ({ status: 404, body: { error: 'not found' } }))
    await expect(client(f).deleteWorkspace('w1')).rejects.toBeInstanceOf(SyncGoneError)
  })
})
