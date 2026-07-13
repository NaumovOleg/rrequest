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
    runPreScript: vi.fn((_s: string, c: any) => ({ request: { ...c.request, url: c.request.url + '?pre=1' }, envSets: [{ key: 'x', value: '1', enabled: true }], logs: ['pre log'] })),
    runTestScript: vi.fn(() => ({ tests: [{ name: 't', passed: true }], envSets: [], logs: ['post log'] })),
  }
}

function routerAll(d: any) {
  return createRouter({ send: d.send, collections: d.collections, history: d.history,
    environments: d.environments, getActiveEnvId: () => d.activeEnvId, setActiveEnvId: (id: string | null) => { d.activeEnvId = id },
    workspaces: d.workspaces, getActiveWorkspaceId: () => d.activeWorkspaceId, setActiveWorkspaceId: (id: string) => { d.activeWorkspaceId = id } })
}

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
  it('deleteWorkspace reassigns collections of a non-active deleted workspace to the active workspace', async () => {
    const d = deps()
    d.activeWorkspaceId = 'w1'
    d.collections.list = vi.fn(async () => [{ id: 'c1', name: 'C', workspaceId: 'w2', requests: [] }])
    await router(d)({ type: 'deleteWorkspace', id: 'w2' })
    expect(d.collections.saveCollection).toHaveBeenCalledWith({ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] })
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
