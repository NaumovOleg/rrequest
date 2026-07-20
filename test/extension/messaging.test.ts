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
    collections: { list: vi.fn(async () => []), createCollection: vi.fn(async (n: string, ws: string) => ({ id: 'c1', name: n, workspaceId: ws, requests: [] })), saveRequest: vi.fn(async () => ({ id: 'c1', name: 'c', requests: [] })), saveCollection: vi.fn(async (c: any) => c), delete: vi.fn(async () => {}) } as any,
    history: { append: vi.fn(async () => {}), list: vi.fn(async () => []), dropByWorkspace: vi.fn(async () => {}) } as any,
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
    runPreScript: vi.fn((_s: string, c: any) => ({ request: { ...c.request, url: c.request.url + '?pre=1' }, envSets: [{ key: 'x', value: '1', enabled: true }], logs: ['pre log'] })),
    runTestScript: vi.fn(() => ({ tests: [{ name: 't', passed: true }], envSets: [], logs: ['post log'] })),
  }
}

function routerAll(d: any) {
  return createRouter({ send: d.send, collections: d.collections, history: d.history,
    environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id: string | null) => { d.activeEnvId = id },
    workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id: string) => { d.activeWorkspaceId = id },
    grpcInvoke: d.grpcInvoke })
}

describe('createRouter grpc', () => {
  it('routes grpcInvoke through the grpc dep and returns a grpcResponse to the sender', async () => {
    const d: any = deps()
    d.grpcInvoke = vi.fn(async () => ({ ok: true, message: '{"message":"hi"}', timeMs: 3 }))
    const out = await routerAll(d)({ type: 'grpcInvoke', requestId: 'g1', address: 'localhost:50051', proto: 'p', service: 'S', method: 'M', message: '{}', metadata: [], plaintext: true }) as any
    expect(d.grpcInvoke).toHaveBeenCalled()
    expect(out).toEqual({ type: 'grpcResponse', requestId: 'g1', ok: true, message: '{"message":"hi"}', error: undefined, timeMs: 3 })
  })
})

describe('createRouter', () => {
  it('routes sendRequest to send and returns a response message', async () => {
    const d = deps()
    const route = createRouter({ ...d, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id } })
    const msg: WebviewMessage = { type: 'sendRequest', requestId: 'q1', payload: req() }
    const out = await route(msg)
    expect(out).toEqual({ type: 'response', requestId: 'q1', payload: { ...fakeResp, testResults: [], consoleLogs: [] } })
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
    expect(out).toEqual({ type: 'openInEditor', request: req, targetCollectionId: undefined })
  })
  it('openRequest forwards targetCollectionId to the openInEditor message', async () => {
    const d = deps()
    const req: RestRequest = { id: 'r', name: 'x', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }
    const out = await router(d)({ type: 'openRequest', request: req, targetCollectionId: 'c1' })
    expect(out).toEqual({ type: 'openInEditor', request: req, targetCollectionId: 'c1' })
  })
  it('openRequest routes a gRPC item to openGrpcRequest', async () => {
    const d = deps()
    const item: any = { id: 'g1', name: 'Greeter', kind: 'grpc', address: 'a', proto: 'p', service: 'S', method: 'M', message: '{}', metadata: [], plaintext: true }
    const out = await router(d)({ type: 'openRequest', request: item, targetCollectionId: 'c1', targetFolderId: null }) as any
    expect(out.type).toBe('openGrpcRequest')
    expect(out.request.id).toBe('g1')
  })
  it('openRequest routes a WebSocket item to openWsRequest', async () => {
    const d = deps()
    const item: any = { id: 'w1', name: 'Socket', kind: 'ws', url: 'wss://x', headers: [] }
    const out = await router(d)({ type: 'openRequest', request: item, targetCollectionId: 'c1', targetFolderId: null }) as any
    expect(out.type).toBe('openWsRequest')
    expect(out.request.url).toBe('wss://x')
  })
  it('openRequest from a collection with a bound environment activates it', async () => {
    const d = deps()
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], environmentId: 'e9' }])
    const req: RestRequest = { id: 'r', name: 'x', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }
    await router(d)({ type: 'openRequest', request: req, targetCollectionId: 'c1' })
    expect(d.activeEnvId).toBe('e9')
  })
  it('duplicateRequest clones the request after the original with a Copy name', async () => {
    const d = deps()
    const req: RestRequest = { id: 'r1', name: 'Orig', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [req] }])
    await router(d)({ type: 'duplicateRequest', collectionId: 'c1', folderId: null, requestId: 'r1' })
    const saved = (d.collections.saveCollection as any).mock.calls.at(-1)[0]
    expect(saved.requests).toHaveLength(2)
    expect(saved.requests[1].name).toBe('Orig Copy')
    expect(saved.requests[1].id).not.toBe('r1')
  })
  it('createRequest persists the request and opens it linked', async () => {
    const d = deps()
    const req: RestRequest = { id: 'r', name: 'x', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }
    const out = await router(d)({ type: 'createRequest', collectionId: 'c1', folderId: 'f1', request: req })
    expect(d.collections.saveRequest).toHaveBeenCalledWith('c1', req, 'f1')
    expect(out).toEqual({ type: 'openInEditor', request: req, targetCollectionId: 'c1', targetFolderId: 'f1' })
  })
  it('setCollectionEnvironment stores the environment id on the collection', async () => {
    const d = deps()
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }])
    await router(d)({ type: 'setCollectionEnvironment', collectionId: 'c1', environmentId: 'e9' })
    expect(d.collections.saveCollection).toHaveBeenCalledWith({ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], environmentId: 'e9' })
  })
  it('deleteWorkspace permanently deletes the workspace collections (no reassign)', async () => {
    const d = deps()
    d.activeWorkspaceId = 'w1'
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w2', requests: [] }])
    await router(d)({ type: 'deleteWorkspace', id: 'w2' })
    expect(d.collections.delete).toHaveBeenCalledWith('c1')
    expect(d.collections.saveCollection).not.toHaveBeenCalled()
  })
  it('moveFolder re-parents a folder from one collection to another', async () => {
    const d = deps()
    d.collections.list = vi.fn(async () => [
      { id: 'c1', name: 'C1', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [] }] },
      { id: 'c2', name: 'C2', workspaceId: 'w1', requests: [], folders: [] },
    ])
    await router(d)({ type: 'moveFolder', fromCollectionId: 'c1', toCollectionId: 'c2', folderId: 'f1' })
    const saved = (d.collections.saveCollection as any).mock.calls.map((c: any[]) => c[0])
    const from = saved.find((c: any) => c.id === 'c1')
    const to = saved.find((c: any) => c.id === 'c2')
    expect(from.folders).toHaveLength(0)
    expect(to.folders.map((f: any) => f.id)).toEqual(['f1'])
  })
  it('moveFolder into the same collection is a no-op', async () => {
    const d = deps()
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C1', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [] }] }])
    await router(d)({ type: 'moveFolder', fromCollectionId: 'c1', toCollectionId: 'c1', folderId: 'f1' })
    expect(d.collections.saveCollection).not.toHaveBeenCalled()
  })
  it('setActiveWorkspace clears the active environment (envs belong to a workspace)', async () => {
    const d = deps()
    d.activeWorkspaceId = 'w1'
    d.activeEnvId = 'e1'
    await router(d)({ type: 'setActiveWorkspace', id: 'w2' })
    expect(d.activeWorkspaceId).toBe('w2')
    expect(d.activeEnvId).toBeNull()
  })
  it('createEnvironment scopes the new env to the active workspace', async () => {
    const d = deps()
    d.activeWorkspaceId = 'w2'
    await router(d)({ type: 'createEnvironment', name: 'Dev' })
    expect(d.environments.createEnvironment).toHaveBeenCalledWith('Dev', 'w2')
  })
  it('environments/history snapshots only include the active workspace', async () => {
    const d = deps()
    d.activeWorkspaceId = 'w1'
    d.environments.list = vi.fn(async () => [
      { id: 'e1', name: 'A', workspaceId: 'w1', variables: [] },
      { id: 'e2', name: 'B', workspaceId: 'w2', variables: [] },
    ])
    d.history.list = vi.fn(async () => [
      { id: 'h1', workspaceId: 'w1', request: {}, status: 200, at: 1 },
      { id: 'h2', workspaceId: 'w2', request: {}, status: 200, at: 2 },
    ])
    const envs = await router(d)({ type: 'loadEnvironments' }) as any
    const hist = await router(d)({ type: 'loadHistory' }) as any
    expect(envs.environments.map((e: any) => e.id)).toEqual(['e1'])
    expect(hist.entries.map((e: any) => e.id)).toEqual(['h1'])
  })
})

describe('createRouter sendRequest with scripts', () => {
  function router(d: any) {
    return createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id },
      runPreScript: d.runPreScript, runTestScript: d.runTestScript })
  }
  it('runs pre-script (mutated request sent), test-script, and attaches testResults + consoleLogs', async () => {
    const d = deps(); d.activeEnvId = 'e1'
    d.environments.list = vi.fn(async () => [{ id: 'e1', name: 'Dev', variables: [] }])
    const payload: RestRequest = { id: 'r', name: 'x', method: 'GET', url: 'https://api/x', params: [], headers: [], body: { mode: 'none' }, preRequestScript: 'x', testScript: 'y' }
    const out = await router(d)({ type: 'sendRequest', requestId: 'q1', payload }) as any
    // the mutated request (url + ?pre=1) was sent, not the raw one:
    expect((d.send as any).mock.calls[0][0].url).toBe('https://api/x?pre=1')
    // response carries test results + logs (pre then post):
    expect(out.payload.testResults).toEqual([{ name: 't', passed: true }])
    expect(out.payload.consoleLogs).toEqual(['pre log', 'post log'])
    // pre-script env write persisted:
    expect(d.environments.saveEnvironment).toHaveBeenCalled()
    // history recorded the RAW payload (no ?pre=1):
    expect(d.history.append.mock.calls[0][0].url).toBe('https://api/x')
  })
})

describe('createRouter item + folder routes', () => {
  function r(d: any) {
    return createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id } })
  }
  it('deleteCollection deletes and returns tree', async () => {
    const d = deps()
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
    const out = await r(d)({ type: 'deleteCollection', id: 'c1' }) as any
    expect(d.collections.delete).toHaveBeenCalledWith('c1')
    expect(out.type).toBe('tree')
  })
  it('renameCollection loads, renames, saves', async () => {
    const d = deps()
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'Old', workspaceId: 'w1', requests: [], folders: [] }])
    await r(d)({ type: 'renameCollection', id: 'c1', name: 'New' })
    expect(d.collections.saveCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', name: 'New' }))
  })
  it('createFolder adds a folder and saves', async () => {
    const d = deps()
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
    await r(d)({ type: 'createFolder', collectionId: 'c1', name: 'Auth' })
    const saved = (d.collections.saveCollection as any).mock.calls[0][0]
    expect(saved.folders).toHaveLength(1)
    expect(saved.folders[0].name).toBe('Auth')
  })
  it('saveRequest forwards folderId', async () => {
    const d = deps()
    await r(d)({ type: 'saveRequest', collectionId: 'c1', folderId: 'f1', request: req() })
    expect(d.collections.saveRequest).toHaveBeenCalledWith('c1', expect.anything(), 'f1')
  })
  it('openEnvironments returns showEnvironments', async () => {
    const out = await r(deps())({ type: 'openEnvironments' })
    expect(out).toEqual({ type: 'showEnvironments' })
  })
})

describe('createRouter ws routes', () => {
  function wsRouter(d: any, ws: any) {
    return createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id },
      ws })
  }
  it('wsConnect/wsSend/wsDisconnect call the manager and return undefined', async () => {
    const ws = { connect: vi.fn(), send: vi.fn(), disconnect: vi.fn() }
    const route = wsRouter(deps(), ws)
    expect(await route({ type: 'wsConnect', connId: 'c1', url: 'wss://e', headers: [] })).toBeUndefined()
    expect(await route({ type: 'wsSend', connId: 'c1', data: 'hi' })).toBeUndefined()
    expect(await route({ type: 'wsDisconnect', connId: 'c1' })).toBeUndefined()
    expect(ws.connect).toHaveBeenCalledWith('c1', 'wss://e', [])
    expect(ws.send).toHaveBeenCalledWith('c1', 'hi')
    expect(ws.disconnect).toHaveBeenCalledWith('c1')
  })
})

describe('createRouter moveRequest', () => {
  it('moveRequest moves a request between collections and saves both', async () => {
    const d = deps()
    const req = { id: 'r1', name: 'x', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }
    d.collections.list = vi.fn(async () => [
      { id: 'c1', name: 'A', workspaceId: 'w1', requests: [req], folders: [] },
      { id: 'c2', name: 'B', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [] }] },
    ])
    const out = await routerAll(d)({ type: 'moveRequest', fromCollectionId: 'c1', fromFolderId: null, toCollectionId: 'c2', toFolderId: 'f1', requestId: 'r1' }) as any
    const saved = (d.collections.saveCollection as any).mock.calls.map((c: any) => c[0])
    const src = saved.find((c: any) => c.id === 'c1'); const dst = saved.find((c: any) => c.id === 'c2')
    expect(src.requests).toHaveLength(0)
    expect(dst.folders[0].requests).toHaveLength(1)
    expect(out.type).toBe('tree')
  })
})

describe('createRouter trash', () => {
  function fakeTrash() {
    const items: any[] = []
    return {
      items,
      list: async () => items,
      add: async (e: any) => { const f = { ...e, id: `t${items.length}`, at: 1 }; items.unshift(f); return f },
      get: async (id: string) => items.find((x) => x.id === id),
      remove: async (id: string) => { const i = items.findIndex((x) => x.id === id); if (i >= 0) items.splice(i, 1) },
      update: async (e: any) => { const i = items.findIndex((x) => x.id === e.id); if (i >= 0) items[i] = e },
      dropByWorkspace: async () => {},
    }
  }
  function router(collections: any, trash: any) {
    return createRouter({
      send: vi.fn(), collections,
      history: { append: vi.fn(), list: async () => [] } as any,
      environments: { list: async () => [], saveEnvironment: vi.fn(), deleteEnvironment: vi.fn() } as any,
      getActiveEnvId: () => null, setActiveEnvId: vi.fn(),
      workspaces: { list: async () => [] } as any,
      getActiveWorkspaceId: () => 'w1', setActiveWorkspaceId: vi.fn(), trash,
    })
  }
  const httpReq = (id: string) => ({ id, name: id.toUpperCase(), method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } })

  it('deleteRequest moves the request to trash with its collection/folder path', async () => {
    const store: any = { data: [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [httpReq('r1')] }] }] }
    const collections = { list: async () => store.data, saveCollection: async (c: any) => { store.data = store.data.map((x: any) => (x.id === c.id ? c : x)); return c }, delete: vi.fn() }
    const trash = fakeTrash()
    await router(collections, trash)({ type: 'deleteRequest', collectionId: 'c1', folderId: 'f1', requestId: 'r1' })
    expect(trash.items).toHaveLength(1)
    expect(trash.items[0]).toMatchObject({ kind: 'request', path: { collectionId: 'c1', folderId: 'f1', folderName: 'F' } })
    expect(store.data[0].folders[0].requests).toHaveLength(0)
  })

  it('restoreTrash recreates a missing collection + folder for a trashed request', async () => {
    const store: any = { data: [] }
    const collections = { list: async () => store.data, saveCollection: async (c: any) => { const i = store.data.findIndex((x: any) => x.id === c.id); if (i >= 0) store.data[i] = c; else store.data.push(c); return c }, delete: vi.fn() }
    const trash = fakeTrash()
    trash.items.push({ id: 'e1', at: 1, workspaceId: 'w1', kind: 'request', data: httpReq('r1'), path: { collectionId: 'c1', collectionName: 'C', folderId: 'f1', folderName: 'F' } })
    await router(collections, trash)({ type: 'restoreTrash', entryId: 'e1' })
    const c = store.data.find((x: any) => x.id === 'c1')
    expect(c).toBeTruthy()
    const f = c.folders.find((x: any) => x.id === 'f1')
    expect(f.requests.map((r: any) => r.id)).toEqual(['r1'])
    expect(trash.items).toHaveLength(0)
  })

  it('restoreTrash drops a request into an existing folder without duplicating ancestors', async () => {
    const store: any = { data: [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [httpReq('r0')] }] }] }
    const collections = { list: async () => store.data, saveCollection: async (c: any) => { const i = store.data.findIndex((x: any) => x.id === c.id); store.data[i] = c; return c }, delete: vi.fn() }
    const trash = fakeTrash()
    trash.items.push({ id: 'e1', at: 1, workspaceId: 'w1', kind: 'request', data: httpReq('r1'), path: { collectionId: 'c1', collectionName: 'C', folderId: 'f1', folderName: 'F' } })
    await router(collections, trash)({ type: 'restoreTrash', entryId: 'e1' })
    expect(store.data).toHaveLength(1)
    expect(store.data[0].folders).toHaveLength(1)
    expect(store.data[0].folders[0].requests.map((r: any) => r.id)).toEqual(['r0', 'r1'])
  })
})

describe('createRouter trash targeted restore', () => {
  function fakeTrash(seed: any[] = []) {
    const items: any[] = [...seed]
    return {
      items,
      list: async () => items,
      add: async (e: any) => { const f = { ...e, id: `t${items.length}`, at: 1 }; items.unshift(f); return f },
      get: async (id: string) => items.find((x) => x.id === id),
      remove: async (id: string) => { const i = items.findIndex((x) => x.id === id); if (i >= 0) items.splice(i, 1) },
      update: async (e: any) => { const i = items.findIndex((x) => x.id === e.id); if (i >= 0) items[i] = e },
      dropByWorkspace: async () => {},
    }
  }
  function router(collections: any, trash: any) {
    return createRouter({
      send: vi.fn(), collections,
      history: { append: vi.fn(), list: async () => [] } as any,
      environments: { list: async () => [], saveEnvironment: vi.fn() } as any,
      getActiveEnvId: () => null, setActiveEnvId: vi.fn(),
      workspaces: { list: async () => [] } as any,
      getActiveWorkspaceId: () => 'w1', setActiveWorkspaceId: vi.fn(), trash,
    })
  }
  const httpReq = (id: string) => ({ id, name: id, method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } })
  const liveStore = () => {
    const data: any[] = []
    return { data, list: async () => data, saveCollection: async (c: any) => { const i = data.findIndex((x: any) => x.id === c.id); if (i >= 0) data[i] = c; else data.push(c); return c }, delete: vi.fn() }
  }

  it('restores one folder from a trashed collection and keeps the collection (minus that folder) in trash', async () => {
    const entry = { id: 'e1', at: 1, workspaceId: 'w1', kind: 'collection', data: { id: 'c1', name: 'API', workspaceId: 'w1', requests: [], folders: [
      { id: 'f1', name: 'Auth', requests: [httpReq('r1')] },
      { id: 'f2', name: 'Users', requests: [httpReq('r2')] },
    ] } }
    const trash = fakeTrash([entry])
    const collections = liveStore()
    await router(collections, trash)({ type: 'restoreTrash', entryId: 'e1', folderId: 'f1' })
    // Auth restored into live collection
    expect(collections.data[0].folders.map((f: any) => f.id)).toEqual(['f1'])
    // entry still present, now only holding Users
    expect(trash.items).toHaveLength(1)
    expect(trash.items[0].data.folders.map((f: any) => f.id)).toEqual(['f2'])
  })

  it('restores a single request from a trashed collection folder', async () => {
    const entry = { id: 'e1', at: 1, workspaceId: 'w1', kind: 'collection', data: { id: 'c1', name: 'API', workspaceId: 'w1', requests: [], folders: [
      { id: 'f1', name: 'Auth', requests: [httpReq('r1'), httpReq('r2')] },
    ] } }
    const trash = fakeTrash([entry])
    const collections = liveStore()
    await router(collections, trash)({ type: 'restoreTrash', entryId: 'e1', folderId: 'f1', requestId: 'r1' })
    expect(collections.data[0].folders[0].requests.map((r: any) => r.id)).toEqual(['r1'])
    // only r2 remains in trash
    expect(trash.items[0].data.folders[0].requests.map((r: any) => r.id)).toEqual(['r2'])
  })

  it('removes the trash entry once its last node is restored', async () => {
    const entry = { id: 'e1', at: 1, workspaceId: 'w1', kind: 'collection', data: { id: 'c1', name: 'API', workspaceId: 'w1', requests: [httpReq('r1')], folders: [] } }
    const trash = fakeTrash([entry])
    const collections = liveStore()
    await router(collections, trash)({ type: 'restoreTrash', entryId: 'e1', requestId: 'r1' })
    expect(collections.data[0].requests.map((r: any) => r.id)).toEqual(['r1'])
    expect(trash.items).toHaveLength(0)
  })
})
