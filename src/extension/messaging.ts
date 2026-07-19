import { newId, type HostMessage, type KeyValue, type WebviewMessage } from '../shared/types'
import type { sendRequest as SendFn } from './http-client'
import type { CollectionStore } from './collection-store'
import type { HistoryStore } from './history-store'
import type { EnvironmentStore } from './environment-store'
import type { WorkspaceStore } from './workspace-store'
import type { WsManager } from './ws-manager'

export type RouterDeps = {
  send: typeof SendFn
  collections: CollectionStore
  history: HistoryStore
  environments: EnvironmentStore
  getActiveEnvId: () => string | null
  setActiveEnvId: (id: string | null) => void
  openImport?: () => Promise<import('../shared/types').Collection | null>
  runExport?: (c: import('../shared/types').Collection, format: 'native' | 'postman') => Promise<void>
  pickFile?: () => Promise<{ path: string; filename: string } | null>
  workspaces: WorkspaceStore
  getActiveWorkspaceId: () => string
  setActiveWorkspaceId: (id: string) => void
  runPreScript?: (script: string, ctx: { request: import('../shared/types').RestRequest; vars: KeyValue[] }) => { request: import('../shared/types').RestRequest; envSets: KeyValue[]; logs: string[]; error?: string }
  runTestScript?: (script: string, ctx: { response: import('../shared/types').HttpResponse; vars: KeyValue[] }) => { tests: import('../shared/types').TestResult[]; envSets: KeyValue[]; logs: string[]; error?: string }
  ws?: WsManager
}

export function createRouter(deps: RouterDeps) {
  async function withCollection(id: string, fn: (c: import('../shared/types').Collection) => void) {
    const c = (await deps.collections.list()).find((x) => x.id === id)
    if (c) { fn(c); await deps.collections.saveCollection(c) }
  }
  async function envSnapshot(): Promise<{ type: 'environments'; environments: import('../shared/types').Environment[]; activeId: string | null }> {
    const ws = deps.getActiveWorkspaceId()
    const environments = (await deps.environments.list()).filter((e) => (e.workspaceId || ws) === ws)
    return { type: 'environments', environments, activeId: deps.getActiveEnvId() }
  }
  async function histSnapshot(): Promise<{ type: 'history'; entries: import('../shared/types').HistoryEntry[] }> {
    const ws = deps.getActiveWorkspaceId()
    const entries = (await deps.history.list()).filter((e) => (e.workspaceId || ws) === ws)
    return { type: 'history', entries }
  }
  async function activeVars() {
    const id = deps.getActiveEnvId()
    if (!id) return []
    const ws = deps.getActiveWorkspaceId()
    const env = (await deps.environments.list()).find((e) => e.id === id && (e.workspaceId || ws) === ws)
    return env ? env.variables : []
  }
  async function wsSnapshot(): Promise<HostMessage> {
    return { type: 'workspaces', workspaces: await deps.workspaces.list(), activeId: deps.getActiveWorkspaceId() }
  }
  async function persistEnvSets(sets: KeyValue[]): Promise<void> {
    if (!sets.length) return
    const id = deps.getActiveEnvId()
    if (!id) return
    const env = (await deps.environments.list()).find((e) => e.id === id)
    if (!env) return
    const vars = [...env.variables]
    for (const s of sets) {
      const i = vars.findIndex((v) => v.key === s.key)
      if (i >= 0) vars[i] = { ...vars[i], value: s.value, enabled: true }
      else vars.push(s)
    }
    await deps.environments.saveEnvironment({ ...env, variables: vars })
  }

  return async function route(msg: WebviewMessage): Promise<HostMessage | undefined> {
    switch (msg.type) {
      case 'sendRequest': {
        const raw = msg.payload
        const logs: string[] = []
        let vars = await activeVars()
        let effective = raw
        if (raw.preRequestScript && deps.runPreScript) {
          const pre = deps.runPreScript(raw.preRequestScript, { request: raw, vars })
          logs.push(...pre.logs)
          if (pre.error) logs.push(`[pre-request error] ${pre.error}`)
          if (pre.envSets.length) { await persistEnvSets(pre.envSets); vars = await activeVars() }
          effective = pre.request
        }
        const payload = await deps.send(effective, { vars })
        let testResults: import('../shared/types').TestResult[] = []
        if (raw.testScript && deps.runTestScript) {
          const post = deps.runTestScript(raw.testScript, { response: payload, vars })
          logs.push(...post.logs)
          if (post.error) logs.push(`[test error] ${post.error}`)
          testResults = post.tests
          if (post.envSets.length) await persistEnvSets(post.envSets)
        }
        const withMeta = { ...payload, testResults, consoleLogs: logs }
        await deps.history.append(raw, payload.status, deps.getActiveWorkspaceId())
        return { type: 'response', requestId: msg.requestId, payload: withMeta }
      }
      case 'loadTree':
        return { type: 'tree', collections: await deps.collections.list() }
      case 'createCollection':
        await deps.collections.createCollection(msg.name, deps.getActiveWorkspaceId())
        return { type: 'tree', collections: await deps.collections.list() }
      case 'saveRequest':
        await deps.collections.saveRequest(msg.collectionId, msg.request, msg.folderId ?? null)
        return { type: 'tree', collections: await deps.collections.list() }
      case 'loadHistory':
        return await histSnapshot()
      case 'ready':
        return { type: 'tree', collections: await deps.collections.list() }
      case 'loadEnvironments':
        return await envSnapshot()
      case 'createEnvironment':
        await deps.environments.createEnvironment(msg.name, deps.getActiveWorkspaceId())
        return await envSnapshot()
      case 'saveEnvironment':
        await deps.environments.saveEnvironment(msg.environment)
        return await envSnapshot()
      case 'deleteEnvironment':
        await deps.environments.deleteEnvironment(msg.id)
        if (deps.getActiveEnvId() === msg.id) deps.setActiveEnvId(null)
        return await envSnapshot()
      case 'setActiveEnv':
        deps.setActiveEnvId(msg.id)
        return await envSnapshot()
      case 'importCollection': {
        const c = deps.openImport ? await deps.openImport() : null
        if (c) await deps.collections.saveCollection({ ...c, workspaceId: deps.getActiveWorkspaceId() })
        return { type: 'tree', collections: await deps.collections.list() }
      }
      case 'exportCollection': {
        const c = (await deps.collections.list()).find((x) => x.id === msg.id)
        if (c && deps.runExport) await deps.runExport(c, msg.format)
        return undefined
      }
      case 'pickFile': {
        const f = deps.pickFile ? await deps.pickFile() : null
        return f ? { type: 'pickedFile', path: f.path, filename: f.filename } : undefined
      }
      case 'openRequest':
        return { type: 'openInEditor', request: msg.request, targetCollectionId: msg.targetCollectionId, targetFolderId: msg.targetFolderId }
      case 'loadWorkspaces':
        return await wsSnapshot()
      case 'createWorkspace': {
        // Make the freshly created workspace active so it shows up selected
        // immediately (and the snapshot broadcasts its empty collection set).
        const created = await deps.workspaces.create(msg.name)
        deps.setActiveWorkspaceId(created.id)
        // fresh workspace has no environments — clear stale active env selection
        deps.setActiveEnvId(null)
        return await wsSnapshot()
      }
      case 'renameWorkspace':
        await deps.workspaces.rename(msg.id, msg.name)
        return await wsSnapshot()
      case 'setActiveWorkspace':
        deps.setActiveWorkspaceId(msg.id)
        // active env belongs to the previous workspace — reset so the new
        // workspace starts with its own selection (snapshot re-filters below)
        deps.setActiveEnvId(null)
        return await wsSnapshot()
      case 'deleteWorkspace': {
        await deps.workspaces.delete(msg.id)
        // if the active workspace was deleted, pick/create a fallback and make it active
        if (deps.getActiveWorkspaceId() === msg.id) {
          const remaining = await deps.workspaces.list()
          const fallback = remaining[0] ?? (await deps.workspaces.create('Default'))
          deps.setActiveWorkspaceId(fallback.id)
          deps.setActiveEnvId(null)
        }
        // reassign orphaned collections + environments to the (now-)active
        // workspace, regardless of which ws was deleted; drop its history log.
        const target = deps.getActiveWorkspaceId()
        for (const c of await deps.collections.list()) {
          if (c.workspaceId === msg.id) await deps.collections.saveCollection({ ...c, workspaceId: target })
        }
        for (const e of await deps.environments.list()) {
          if (e.workspaceId === msg.id) await deps.environments.saveEnvironment({ ...e, workspaceId: target })
        }
        await deps.history.dropByWorkspace(msg.id)
        return await wsSnapshot()
      }
      case 'wsConnect':
        deps.ws?.connect(msg.connId, msg.url, msg.headers)
        return undefined
      case 'wsSend':
        deps.ws?.send(msg.connId, msg.data)
        return undefined
      case 'wsDisconnect':
        deps.ws?.disconnect(msg.connId)
        return undefined
      case 'deleteCollection':
        await deps.collections.delete(msg.id)
        return { type: 'tree', collections: await deps.collections.list() }
      case 'renameCollection':
        await withCollection(msg.id, (c) => { c.name = msg.name })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'createFolder':
        await withCollection(msg.collectionId, (c) => { (c.folders ??= []).push({ id: newId(), name: msg.name, requests: [] }) })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'renameFolder':
        await withCollection(msg.collectionId, (c) => { const f = (c.folders ?? []).find((x) => x.id === msg.folderId); if (f) f.name = msg.name })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'deleteFolder':
        await withCollection(msg.collectionId, (c) => { c.folders = (c.folders ?? []).filter((x) => x.id !== msg.folderId) })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'renameRequest':
        await withCollection(msg.collectionId, (c) => { renameReqIn(c, msg.folderId, msg.requestId, msg.name) })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'deleteRequest':
        await withCollection(msg.collectionId, (c) => { deleteReqIn(c, msg.folderId, msg.requestId) })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'openEnvironments':
        return { type: 'showEnvironments' }
      case 'openWebSocket':
        return { type: 'showWebSocket' }
      case 'moveRequest': {
        const all = await deps.collections.list()
        const from = all.find((c) => c.id === msg.fromCollectionId)
        const to = all.find((c) => c.id === msg.toCollectionId)
        if (!from || !to) return { type: 'tree', collections: all }
        const fromBucket = reqBucket(from, msg.fromFolderId)
        const toBucket = reqBucket(to, msg.toFolderId)
        const req = fromBucket?.find((r) => r.id === msg.requestId)
        // Resolve the destination bucket BEFORE mutating the source, so a missing
        // destination folder never orphans (deletes) the request.
        if (!req || !fromBucket || !toBucket) return { type: 'tree', collections: all }
        // remove from source, add to dest
        fromBucket.splice(fromBucket.findIndex((r) => r.id === msg.requestId), 1)
        toBucket.push(req)
        await deps.collections.saveCollection(from)
        if (to.id !== from.id) await deps.collections.saveCollection(to)
        return { type: 'tree', collections: await deps.collections.list() }
      }
      default:
        return undefined
    }
  }
}

function reqBucket(c: import('../shared/types').Collection, folderId: string | null) {
  if (folderId) return ((c.folders ?? []).find((f) => f.id === folderId)?.requests) ?? null
  return c.requests
}
function renameReqIn(c: import('../shared/types').Collection, folderId: string | null, reqId: string, name: string) {
  const b = reqBucket(c, folderId); if (!b) return
  const r = b.find((x) => x.id === reqId); if (r) r.name = name
}
function deleteReqIn(c: import('../shared/types').Collection, folderId: string | null, reqId: string) {
  if (folderId) { const f = (c.folders ?? []).find((x) => x.id === folderId); if (f) f.requests = f.requests.filter((x) => x.id !== reqId) }
  else c.requests = c.requests.filter((x) => x.id !== reqId)
}
