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
    collections: { list: vi.fn(async () => []), createCollection: vi.fn(async (n: string, ws: string) => ({ id: 'c1', name: n, workspaceId: ws, requests: [] })), saveRequest: vi.fn(async () => ({ id: 'c1', name: 'c', requests: [] })), saveCollection: vi.fn(async (c: any) => c) } as any,
    history: { append: vi.fn(async () => {}), list: vi.fn(async () => []) } as any,
    environments: {
      list: vi.fn(async () => [] as any[]),
      createEnvironment: vi.fn(async (n: string) => ({ id: 'e1', name: n, variables: [] })),
      saveEnvironment: vi.fn(async (e: any) => e),
      deleteEnvironment: vi.fn(async () => {}),
    } as any,
    activeEnvId: null as string | null,
    getActiveEnvId() { return this.activeEnvId },
    setActiveEnvId(id: string | null) { this.activeEnvId = id },
    openImport: vi.fn(async () => ({ id: 'imp', name: 'Imp', workspaceId: '', requests: [] })),
    runExport: vi.fn(async () => {}),
    pickFile: vi.fn(async () => ({ path: '/tmp/a', filename: 'a' })),
    workspaces: {
      list: vi.fn(async () => [{ id: 'w1', name: 'Default' }]),
      create: vi.fn(async (n: string) => ({ id: 'w2', name: n })),
      rename: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    } as any,
    activeWorkspaceId: 'w1',
  }
}

describe('createRouter', () => {
  it('routes sendRequest to send and returns a response message', async () => {
    const d = deps()
    const route = createRouter({ ...d, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id } })
    const msg: WebviewMessage = { type: 'sendRequest', requestId: 'q1', payload: req() }
    const out = await route(msg)
    expect(out).toEqual({ type: 'response', requestId: 'q1', payload: fakeResp })
    expect(d.send).toHaveBeenCalledWith(expect.anything(), { vars: [] })
    expect(d.history.append).toHaveBeenCalledOnce()
  })

  it('routes loadTree to a tree message', async () => {
    const d = deps()
    const out = await createRouter({ ...d, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id } })({ type: 'loadTree' })
    expect(out).toEqual({ type: 'tree', collections: [] })
  })

  it('returns undefined for an unknown message type', async () => {
    const d = deps()
    const out = await createRouter({ ...d, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id } })({ type: 'bogus' } as any)
    expect(out).toBeUndefined()
  })
})

describe('createRouter env routes', () => {
  it('setActiveEnv updates active id and returns environments with it', async () => {
    const d = deps()
    const route = createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id } })
    const out = await route({ type: 'setActiveEnv', id: 'e1' })
    expect(out).toEqual({ type: 'environments', environments: [], activeId: 'e1' })
    expect(d.activeEnvId).toBe('e1')
  })

  it('deleteEnvironment of the active env clears activeId', async () => {
    const d = deps(); d.activeEnvId = 'e1'
    const route = createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id } })
    const out = await route({ type: 'deleteEnvironment', id: 'e1' }) as any
    expect(d.environments.deleteEnvironment).toHaveBeenCalledWith('e1')
    expect(out.activeId).toBeNull()
  })

  it('sendRequest passes the active environment vars to send', async () => {
    const d = deps(); d.activeEnvId = 'e1'
    d.environments.list = vi.fn(async () => [{ id: 'e1', name: 'Dev', variables: [{ key: 'base', value: 'V', enabled: true }] }])
    const route = createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id } })
    await route({ type: 'sendRequest', requestId: 'q1', payload: req() })
    expect(d.send).toHaveBeenCalledWith(expect.anything(), { vars: [{ key: 'base', value: 'V', enabled: true }] })
  })
})

describe('createRouter io routes', () => {
  function fullRouter(d: any) {
    return createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      openImport: d.openImport, runExport: d.runExport, pickFile: d.pickFile,
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id } })
  }
  it('importCollection saves the imported collection and returns tree', async () => {
    const d = deps()
    const out = await fullRouter(d)({ type: 'importCollection' }) as any
    expect(d.openImport).toHaveBeenCalledOnce()
    expect(d.collections.saveCollection).toHaveBeenCalledWith({ id: 'imp', name: 'Imp', workspaceId: 'w1', requests: [] })
    expect(out.type).toBe('tree')
  })
  it('exportCollection runs export for the found collection', async () => {
    const d = deps()
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', requests: [] }])
    await fullRouter(d)({ type: 'exportCollection', id: 'c1', format: 'postman' })
    expect(d.runExport).toHaveBeenCalledWith({ id: 'c1', name: 'C', requests: [] }, 'postman')
  })
  it('pickFile returns a pickedFile message', async () => {
    const d = deps()
    const out = await fullRouter(d)({ type: 'pickFile' })
    expect(out).toEqual({ type: 'pickedFile', path: '/tmp/a', filename: 'a' })
  })
})

describe('createRouter workspace + openRequest', () => {
  function router(d: any) {
    return createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      openImport: d.openImport, runExport: d.runExport, pickFile: d.pickFile,
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id } })
  }
  it('setActiveWorkspace updates active id and returns workspaces', async () => {
    const d = deps()
    const out = await router(d)({ type: 'setActiveWorkspace', id: 'w9' }) as any
    expect(d.activeWorkspaceId).toBe('w9')
    expect(out.type).toBe('workspaces')
  })
  it('createCollection stamps the active workspace id', async () => {
    const d = deps(); d.activeWorkspaceId = 'w1'
    await router(d)({ type: 'createCollection', name: 'New' })
    expect(d.collections.createCollection).toHaveBeenCalledWith('New', 'w1')
  })
  it('openRequest returns an openInEditor message', async () => {
    const d = deps()
    const req: RestRequest = { id: 'r', name: 'x', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }
    const out = await router(d)({ type: 'openRequest', request: req })
    expect(out).toEqual({ type: 'openInEditor', request: req })
  })
  it('deleteWorkspace reassigns collections of a non-active deleted workspace to the active workspace', async () => {
    const d = deps()
    d.activeWorkspaceId = 'w1'
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w2', requests: [] }])
    await router(d)({ type: 'deleteWorkspace', id: 'w2' })
    expect(d.collections.saveCollection).toHaveBeenCalledWith({ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] })
  })
})
