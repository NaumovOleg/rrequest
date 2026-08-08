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
    runPreScript: vi.fn(async (_s: string, c: any) => ({ request: { ...c.request, url: c.request.url + '?pre=1' }, envSets: [{ key: 'x', value: '1', enabled: true }], logs: ['pre log'] })),
    runTestScript: vi.fn(async () => ({ tests: [{ name: 't', passed: true }], envSets: [], logs: ['post log'] })),
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

  it('interpolates {{vars}} in grpc address, proto, service, method and metadata', async () => {
    const d: any = deps()
    d.activeEnvId = 'e1'
    d.environments.list = vi.fn(async () => [{ id: 'e1', name: 'Dev', variables: [{ key: 'host', value: 'server:50051', enabled: true }, { key: 'svc', value: 'hello.Greeter', enabled: true }] }])
    d.grpcInvoke = vi.fn(async () => ({ ok: true, message: '{}', timeMs: 1 }))
    await routerAll(d)({ type: 'grpcInvoke', requestId: 'g2', address: '{{host}}', proto: 'pkg {{svc}}', service: '{{svc}}', method: 'SayHello', message: '{}', metadata: [{ key: 'x-{{svc}}', value: '{{host}}', enabled: true }], plaintext: true })
    expect(d.grpcInvoke).toHaveBeenCalledWith(expect.objectContaining({
      address: 'server:50051',
      proto: 'pkg hello.Greeter',
      service: 'hello.Greeter',
      metadata: [{ key: 'x-hello.Greeter', value: 'server:50051', enabled: true }],
    }))
  })

  it('interpolates {{vars}} in ws url and headers', async () => {
    const d: any = deps()
    d.activeEnvId = 'e1'
    d.environments.list = vi.fn(async () => [{ id: 'e1', name: 'Dev', variables: [{ key: 'wsHost', value: 'echo.websocket.org', enabled: true }] }])
    const connected: any[] = []
    const ws = { connect: vi.fn((...a: any[]) => connected.push(a)), send: vi.fn(), disconnect: vi.fn() } as any
    const router = createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id: string | null) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id: string) => { d.activeWorkspaceId = id },
      ws })
    await router({ type: 'wsConnect', connId: 'c1', url: 'wss://{{wsHost}}/socket', headers: [{ key: 'X-{{wsHost}}', value: 'test', enabled: true }] })
    expect(ws.connect).toHaveBeenCalledWith('c1', 'wss://echo.websocket.org/socket', [{ key: 'X-echo.websocket.org', value: 'test', enabled: true }])
  })

  it('passes timeoutMs from deps into send', async () => {
    const d: any = deps()
    const router = createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id: string | null) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id: string) => { d.activeWorkspaceId = id },
      timeoutMs: 12345 })
    await router({ type: 'sendRequest', requestId: 'r1', payload: req() })
    const [, opts] = d.send.mock.calls[0]
    expect(opts.timeoutMs).toBe(12345)
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
    expect(d.send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ vars: [] }))
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
    expect(d.send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ vars: [{ key: 'base', value: 'V', enabled: true }] }))
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
  it('duplicateCollection deep-clones with fresh ids everywhere', async () => {
    const d = deps()
    const req: RestRequest = { id: 'r1', name: 'R', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }
    const freq: RestRequest = { id: 'r2', name: 'FR', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [req], folders: [{ id: 'f1', name: 'F', requests: [freq] }] }])
    await router(d)({ type: 'duplicateCollection', id: 'c1' } as any)
    const saved = (d.collections.saveCollection as any).mock.calls.at(-1)[0]
    expect(saved.id).not.toBe('c1')
    expect(saved.name).toBe('C Copy')
    expect(saved.requests[0].id).not.toBe('r1')
    expect(saved.folders[0].id).not.toBe('f1')
    expect(saved.folders[0].requests[0].id).not.toBe('r2')
  })
  it('duplicateFolder clones the folder after the original with fresh request ids', async () => {
    const d = deps()
    const freq: RestRequest = { id: 'r2', name: 'FR', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [freq] }] }])
    await router(d)({ type: 'duplicateFolder', collectionId: 'c1', folderId: 'f1' } as any)
    const saved = (d.collections.saveCollection as any).mock.calls.at(-1)[0]
    expect(saved.folders).toHaveLength(2)
    expect(saved.folders[1].name).toBe('F Copy')
    expect(saved.folders[1].id).not.toBe('f1')
    expect(saved.folders[1].requests[0].id).not.toBe('r2')
  })
  it('moveCollection re-parents the collection into the target workspace, ids intact', async () => {
    const d = deps()
    const req: RestRequest = { id: 'r1', name: 'R', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }
    d.workspaces.list = vi.fn(async () => [{ id: 'w1', name: 'Local' }, { id: 'w2', name: 'Synced' }])
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [req], folders: [{ id: 'f1', name: 'F', requests: [] }] }])
    await router(d)({ type: 'moveCollection', id: 'c1', toWorkspaceId: 'w2' } as any)
    const saved = (d.collections.saveCollection as any).mock.calls.at(-1)[0]
    expect(saved.id).toBe('c1')
    expect(saved.workspaceId).toBe('w2')
    expect(saved.requests[0].id).toBe('r1')
    expect(saved.folders[0].id).toBe('f1')
  })
  it('moveCollection drops the environment binding (the environment stays behind)', async () => {
    const d = deps()
    d.workspaces.list = vi.fn(async () => [{ id: 'w1', name: 'Local' }, { id: 'w2', name: 'Synced' }])
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], environmentId: 'e1' }])
    await router(d)({ type: 'moveCollection', id: 'c1', toWorkspaceId: 'w2' } as any)
    const saved = (d.collections.saveCollection as any).mock.calls.at(-1)[0]
    expect(saved.environmentId).toBeUndefined()
  })
  it('moveCollection is a no-op for an unknown target workspace or a same-workspace move', async () => {
    const d = deps()
    d.workspaces.list = vi.fn(async () => [{ id: 'w1', name: 'Local' }])
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }])
    await router(d)({ type: 'moveCollection', id: 'c1', toWorkspaceId: 'nope' } as any)
    await router(d)({ type: 'moveCollection', id: 'c1', toWorkspaceId: 'w1' } as any)
    expect(d.collections.saveCollection).not.toHaveBeenCalled()
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
  it('a failed pre-script returns an error response and does NOT send', async () => {
    const d = deps(); d.activeEnvId = 'e1'
    d.environments.list = vi.fn(async () => [{ id: 'e1', name: 'Dev', variables: [] }])
    d.runPreScript = vi.fn(async () => ({ request: { url: '' }, envSets: [], logs: ['sad'], error: 'boom' })) as any
    const payload: RestRequest = { id: 'r', name: 'x', method: 'GET', url: 'https://api/x', params: [], headers: [], body: { mode: 'none' }, preRequestScript: 'x' }
    const out = await router(d)({ type: 'sendRequest', requestId: 'q1', payload }) as any
    expect(d.send).not.toHaveBeenCalled()
    expect(out.type).toBe('response')
    expect(out.payload.error).toMatchObject({ kind: 'script', message: 'boom' })
  })
  it('a crashing test-script surfaces as a failed test entry', async () => {
    const d = deps(); d.activeEnvId = 'e1'
    d.environments.list = vi.fn(async () => [{ id: 'e1', name: 'Dev', variables: [] }])
    d.send = vi.fn(async () => ({ status: 500, statusText: 'e', headers: [], body: '', bodyTruncated: false, timeMs: 1, sizeBytes: 0, cookies: [] })) as any
    d.runTestScript = vi.fn(async () => ({ tests: [], envSets: [], logs: [], error: 'nope' })) as any
    const payload: RestRequest = { id: 'r', name: 'x', method: 'GET', url: 'https://api/x', params: [], headers: [], body: { mode: 'none' }, testScript: 'y' }
    const out = await router(d)({ type: 'sendRequest', requestId: 'q1', payload }) as any
    expect(out.payload.testResults).toEqual([{ name: 'test script', passed: false, error: 'nope' }])
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

describe('createRouter members routes', () => {
  function r(d: any, members?: any) {
    return createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id) => { d.activeWorkspaceId = id },
      members })
  }
  it('openMembers returns showMembers', async () => {
    const out = await r(deps())({ type: 'openMembers', workspaceId: 'w1' } as any)
    expect(out).toEqual({ type: 'showMembers', workspaceId: 'w1' })
  })
  it('loadMembers returns the members list from the port', async () => {
    const members = { list: vi.fn(async () => [{ email: 'o@x.com', role: 'owner', pending: false }]), add: vi.fn(async () => {}), remove: vi.fn(async () => {}) }
    const out = await r(deps(), members)({ type: 'loadMembers', workspaceId: 'w1' } as any)
    expect(out).toEqual({ type: 'members', members: [{ email: 'o@x.com', role: 'owner', pending: false }] })
  })
  it('addMember calls the port then returns the refreshed list', async () => {
    const added: any[] = []
    const members = {
      list: vi.fn(async () => added.slice()),
      add: vi.fn(async (_w: string, email: string, role: string) => { added.push({ id: 'm1', email, role, pending: false }) }),
      remove: vi.fn(async () => {}),
    }
    const out = await r(deps(), members)({ type: 'addMember', workspaceId: 'w1', email: 'e@x.com', role: 'editor' } as any)
    expect(members.add).toHaveBeenCalledWith('w1', 'e@x.com', 'editor')
    expect(out).toEqual({ type: 'members', members: [{ id: 'm1', email: 'e@x.com', role: 'editor', pending: false }] })
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

  it('restoring a whole folder MERGES into an existing live folder (no overwrite, no dupes)', async () => {
    // live: collection c1 already has folder f1 with [r0]
    const collections = liveStore()
    collections.data.push({ id: 'c1', name: 'API', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'Auth', requests: [httpReq('r0')] }] })
    // trash: folder-entry f1 holding [r0 (dup), r1]
    const entry = { id: 'e1', at: 1, workspaceId: 'w1', kind: 'folder', data: { id: 'f1', name: 'Auth', requests: [httpReq('r0'), httpReq('r1')] }, path: { collectionId: 'c1', collectionName: 'API' } }
    const trash = fakeTrash([entry])
    await router(collections, trash)({ type: 'restoreTrash', entryId: 'e1' })
    // existing r0 preserved (once), r1 added — folder not overwritten, no duplicate r0
    expect(collections.data[0].folders[0].requests.map((r: any) => r.id)).toEqual(['r0', 'r1'])
  })

  it('restoring a whole collection MERGES into an existing live collection (preserves post-deletion content)', async () => {
    // live: c1 rebuilt after deletion with a NEW folder f2 + a new root request rNew
    const collections = liveStore()
    collections.data.push({ id: 'c1', name: 'API', workspaceId: 'w1', requests: [httpReq('rNew')], folders: [{ id: 'f2', name: 'New', requests: [httpReq('r2')] }] })
    // trash: whole collection c1 with folder f1 + root request rOld
    const entry = { id: 'e1', at: 1, workspaceId: 'w1', kind: 'collection', data: { id: 'c1', name: 'API', workspaceId: 'w1', requests: [httpReq('rOld')], folders: [{ id: 'f1', name: 'Auth', requests: [httpReq('r1')] }] } }
    const trash = fakeTrash([entry])
    await router(collections, trash)({ type: 'restoreTrash', entryId: 'e1' })
    const live = collections.data.find((c: any) => c.id === 'c1')
    expect(live.folders.map((f: any) => f.id).sort()).toEqual(['f1', 'f2'])       // both kept
    expect(live.requests.map((r: any) => r.id).sort()).toEqual(['rNew', 'rOld'])  // both kept
    expect(trash.items).toHaveLength(0)
  })
})

describe('createRouter sync control routes', () => {
  it('routes sync/account messages to the syncControl port', async () => {
    const calls: string[] = []
    const syncControl = {
      signIn: async () => { calls.push('signIn') },
      signOut: async () => { calls.push('signOut') },
      enable: async (id: string) => { calls.push('enable:' + id) },
      syncNow: async (id: string) => { calls.push('syncNow:' + id) },
      syncAccount: async (id: string) => { calls.push('syncAccount:' + id) },
      setPolling: async (id: string, enabled: boolean) => { calls.push(`setPolling:${id}:${enabled}`) },
    }
    const d = deps()
    const route = createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id: string | null) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => 'w1', setActiveWorkspaceId: (id: string) => { d.activeWorkspaceId = id },
      syncControl })
    expect(await route({ type: 'signIn' } as any)).toBeUndefined()
    expect(await route({ type: 'enableSync', workspaceId: 'w1' } as any)).toBeUndefined()
    await route({ type: 'signOut' } as any)
    await route({ type: 'syncNow', workspaceId: 'w2' } as any)
    await route({ type: 'syncAccount', accountId: 'acc1' } as any)
    await route({ type: 'setWorkspacePolling', workspaceId: 'w3', enabled: false } as any)
    expect(calls).toEqual(['signIn', 'enable:w1', 'signOut', 'syncNow:w2', 'syncAccount:acc1', 'setPolling:w3:false'])
  })
})

describe('createRouter viewer read-only gate', () => {
  function router(d: any, isReadOnly: (id: string) => boolean) {
    return createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id: string | null) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id: string) => { d.activeWorkspaceId = id },
      isReadOnly })
  }

  it('blocks a mutating message on a read-only (viewer) workspace with a toast', async () => {
    const d = deps(); d.activeWorkspaceId = 'w1'
    const before = await d.collections.list()
    const route = router(d, (id) => id === 'w1')
    const reply = await route({ type: 'createCollection', name: 'Nope' } as any)
    expect(reply).toEqual({ type: 'toast', level: 'error', message: 'This workspace is read-only (viewer access).' })
    expect(await d.collections.list()).toEqual(before)
    expect(d.collections.createCollection).not.toHaveBeenCalled()
  })

  it('allows mutations when not read-only', async () => {
    const d = deps(); d.activeWorkspaceId = 'w1'
    const route = router(d, () => false)
    await route({ type: 'createCollection', name: 'Yes' } as any)
    expect(d.collections.createCollection).toHaveBeenCalledWith('Yes', 'w1')
  })

  it('allows a non-mutating message even when read-only', async () => {
    const d = deps(); d.activeWorkspaceId = 'w1'
    const route = router(d, () => true)
    const reply = await route({ type: 'loadTree' } as any)
    expect(reply).not.toEqual(expect.objectContaining({ type: 'toast' }))
  })
})

describe('createRouter cascade scripts', () => {
  // Collection c1 contains folder f1; scripts are tagged by level so the call
  // order is observable. runPreScript/runTestScript record their script text.
  function cascadeRouter({ collectionPre, folderPre, collectionTest, folderTest }: {
    collectionPre?: string; folderPre?: string; collectionTest?: string; folderTest?: string
  }, failOn?: string) {
    const calls: string[] = []
    const d = deps()
    d.collections.list = vi.fn(async () => [{
      id: 'c1', name: 'C', workspaceId: 'w1', requests: [],
      folders: [{ id: 'f1', name: 'F', requests: [], preRequestScript: folderPre, testScript: folderTest }],
      preRequestScript: collectionPre, testScript: collectionTest,
    }])
    d.runPreScript = vi.fn(async (s: string, _c: any) => {
      calls.push(`pre:${s}`)
      if (failOn && s.includes(failOn)) return { request: { url: 'x' } as any, envSets: [], logs: [], error: 'boom' }
      return { request: { url: 'x' } as any, envSets: [], logs: [] }
    }) as any
    d.runTestScript = vi.fn(async (s: string, _c: any) => {
      calls.push(`test:${s}`)
      return { tests: [{ name: 't', passed: true }], envSets: [], logs: [] }
    }) as any
    const route = createRouter({ send: d.send, collections: d.collections, history: d.history,
      environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id: string | null) => { d.activeEnvId = id },
      workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id: string) => { d.activeWorkspaceId = id },
      runPreScript: d.runPreScript as any, runTestScript: d.runTestScript as any })
    return { route, calls }
  }

  const msg = (preRequestScript?: string, testScript?: string): WebviewMessage => ({
    type: 'sendRequest', requestId: 'q1', payload: { ...req(), preRequestScript, testScript },
    collectionId: 'c1', folderId: 'f1',
  })

  it('runs pre scripts top-down (collection, folder, request)', async () => {
    const { route, calls } = cascadeRouter({ collectionPre: 'collection-pre', folderPre: 'folder-pre' })
    await route(msg('request-pre'))
    expect(calls).toEqual(['pre:collection-pre', 'pre:folder-pre', 'pre:request-pre'])
  })

  it('runs test scripts bottom-up (request, folder, collection)', async () => {
    const { route, calls } = cascadeRouter({ collectionTest: 'collection-test', folderTest: 'folder-test' })
    await route(msg(undefined, 'request-test'))
    expect(calls).toEqual(['test:request-test', 'test:folder-test', 'test:collection-test'])
  })

  it('a failing folder pre-script aborts the send with a script error', async () => {
    const { route, calls } = cascadeRouter({ collectionPre: 'collection-pre', folderPre: 'folder-pre' }, 'folder-pre')
    const out = await route(msg('request-pre')) as any
    expect(out.payload.error?.kind).toBe('script')
    expect(out.payload.statusText).toBe('Pre-request script failed')
    expect(calls).toEqual(['pre:collection-pre', 'pre:folder-pre'])
  })

  it('skips missing levels (request-only scripts unaffected)', async () => {
    const { route, calls } = cascadeRouter({})
    await route(msg(undefined, 'request-test'))
    expect(calls).toEqual(['test:request-test'])
  })
})

describe('createRouter examples', () => {
  function colWith(r: RestRequest) {
    return { id: 'c1', name: 'C', workspaceId: 'w1', requests: [r], folders: [] }
  }

  it('saveExample appends to the request (root of collection)', async () => {
    const d: any = deps()
    const r: RestRequest = req()
    const col = colWith(r)
    d.collections.list = vi.fn(async () => [col])
    const out = await routerAll(d)({ type: 'saveExample', requestId: r.id, example: { id: 'e1', at: 1, name: '200 OK', status: 200, statusText: 'OK', headers: [], body: '{}' } }) as any
    expect((r as any).examples).toHaveLength(1)
    expect(out.type).toBe('tree')
  })

  it('saveExample finds the request inside a folder', async () => {
    const d: any = deps()
    const r: RestRequest = req()
    const col = { id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [r] }] }
    d.collections.list = vi.fn(async () => [col])
    await routerAll(d)({ type: 'saveExample', requestId: r.id, example: { id: 'e2', at: 1, name: '404', status: 404, statusText: 'Not Found', headers: [], body: '' } })
    expect((r as any).examples).toHaveLength(1)
    expect((r as any).examples[0].name).toBe('404')
  })

  it('caps examples at 50 and trims the oldest', async () => {
    const d: any = deps()
    const r: RestRequest = req()
    const col = colWith(r)
    d.collections.list = vi.fn(async () => [col])
    for (let i = 0; i < 55; i++) {
      await routerAll(d)({ type: 'saveExample', requestId: r.id, example: { id: `e${i}`, at: i, name: `${i}`, status: 200, statusText: 'OK', headers: [], body: '' } })
    }
    expect((r as any).examples).toHaveLength(50)
    expect((r as any).examples[0].id).toBe('e5')
    expect((r as any).examples[49].id).toBe('e54')
  })

  it('no-ops when the request is not in any collection', async () => {
    const d: any = deps()
    d.collections.list = vi.fn(async () => [])
    const out = await routerAll(d)({ type: 'saveExample', requestId: 'ghost', example: { id: 'e9', at: 1, name: '200', status: 200, statusText: 'OK', headers: [], body: '' } }) as any
    expect(out.type).toBe('tree')
  })

  it('deleteExample removes by id', async () => {
    const d: any = deps()
    const r: RestRequest = { ...req(), examples: [{ id: 'a', at: 1, name: 'a', status: 200, statusText: 'OK', headers: [], body: '1' }, { id: 'b', at: 2, name: 'b', status: 201, statusText: 'Created', headers: [], body: '2' }] }
    const col = colWith(r)
    d.collections.list = vi.fn(async () => [col])
    await routerAll(d)({ type: 'deleteExample', requestId: r.id, exampleId: 'a' })
    expect(r.examples).toHaveLength(1)
    expect(r.examples![0].id).toBe('b')
  })
})

describe('createRouter descriptions', () => {
  it('saveCollectionDescription persists and returns the tree', async () => {
    const d: any = deps()
    const col = { id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [], description: undefined as string | undefined }
    d.collections.list = vi.fn(async () => [col])
    const out = await routerAll(d)({ type: 'saveCollectionDescription', collectionId: 'c1', description: '# Docs' }) as any
    expect(col.description).toBe('# Docs')
    expect(out.type).toBe('tree')
  })

  it('saveFolderDescription persists on the folder', async () => {
    const d: any = deps()
    const col = { id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [], preRequestScript: '', testScript: '', description: undefined as string | undefined }] }
    d.collections.list = vi.fn(async () => [col])
    await routerAll(d)({ type: 'saveFolderDescription', collectionId: 'c1', folderId: 'f1', description: '**bold**' })
    expect(col.folders![0].description).toBe('**bold**')
  })

  it('no-ops for a missing collection', async () => {
    const d: any = deps()
    d.collections.list = vi.fn(async () => [])
    const out = await routerAll(d)({ type: 'saveCollectionDescription', collectionId: 'ghost', description: 'x' }) as any
    expect(out.type).toBe('tree')
  })
})
