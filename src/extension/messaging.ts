import { newId, itemKind, type CollectionItem, type GrpcRequest, type HostMessage, type KeyValue, type Member, type RestRequest, type WebviewMessage, type WsRequest } from '../shared/types'
import { isMutating } from './sync/sync-runtime'

// The host message that opens an item in the right kind of editor panel.
function openItemMsg(item: CollectionItem, targetCollectionId?: string, targetFolderId?: string | null): HostMessage {
  const kind = itemKind(item)
  if (kind === 'grpc') return { type: 'openGrpcRequest', request: item as GrpcRequest, targetCollectionId, targetFolderId }
  if (kind === 'ws') return { type: 'openWsRequest', request: item as WsRequest, targetCollectionId, targetFolderId }
  return { type: 'openInEditor', request: item as RestRequest, targetCollectionId, targetFolderId }
}
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
  grpcInvoke?: (p: import('./grpc-client').GrpcParams) => Promise<import('./grpc-client').GrpcResult>
  trash?: import('./trash-store').TrashStore
  isReadOnly?: (workspaceId: string) => boolean
  members?: { list(workspaceId: string): Promise<Member[]>; add(workspaceId: string, email: string, role: 'editor' | 'viewer'): Promise<void>; remove(workspaceId: string, memberId: string): Promise<void> }
  syncControl?: { signIn(): Promise<void>; signOut(accountId?: string): Promise<void>; enable(workspaceId: string, accountId?: string): Promise<void>; syncNow(workspaceId: string): Promise<void> }
  // Best-effort hook fired when a workspace is deleted locally, so the host
  // can also trash its Drive file + server rows if it was synced. Must never
  // reject (the sync side already swallows its own errors) and never blocks
  // the local delete below, which proceeds regardless.
  onWorkspaceDeleted?: (workspaceId: string) => Promise<void>
}

export function createRouter(deps: RouterDeps) {
  async function withCollection(id: string, fn: (c: import('../shared/types').Collection) => void) {
    const c = (await deps.collections.list()).find((x) => x.id === id)
    if (c) { fn(c); await deps.collections.saveCollection(c) }
  }
  // Trash restore helpers: reinsert into live collections, recreating any missing
  // ancestor collection/folder shells and merging into existing ones.
  async function ensureLiveCollection(id: string, name: string): Promise<import('../shared/types').Collection> {
    const c = (await deps.collections.list()).find((x) => x.id === id)
    return c ?? { id, name, workspaceId: deps.getActiveWorkspaceId(), requests: [], folders: [] }
  }
  async function restoreRequestInto(colId: string, colName: string, folder: { id: string; name: string } | null, req: import('../shared/types').CollectionItem) {
    const c = await ensureLiveCollection(colId, colName)
    c.folders = c.folders ?? []
    if (folder) {
      let f = c.folders.find((x) => x.id === folder.id)
      if (!f) { f = { id: folder.id, name: folder.name, requests: [] }; c.folders.push(f) }
      if (!f.requests.some((r) => r.id === req.id)) f.requests.push(req)
    } else if (!c.requests.some((r) => r.id === req.id)) {
      c.requests.push(req)
    }
    await deps.collections.saveCollection(c)
  }
  async function restoreFolderInto(colId: string, colName: string, folder: import('../shared/types').Folder) {
    const c = await ensureLiveCollection(colId, colName)
    // If the folder already exists, merge its requests in (add only the missing
    // ones) instead of skipping or overwriting the existing folder.
    mergeFolderInto(c, folder)
    await deps.collections.saveCollection(c)
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
  async function trashSnapshot(): Promise<{ type: 'trash'; entries: import('../shared/types').TrashEntry[] }> {
    const ws = deps.getActiveWorkspaceId()
    const all = deps.trash ? await deps.trash.list() : []
    return { type: 'trash', entries: all.filter((e) => (e.workspaceId || ws) === ws) }
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
    if (isMutating(msg.type) && deps.isReadOnly?.(deps.getActiveWorkspaceId())) {
      return { type: 'toast', level: 'error', message: 'This workspace is read-only (viewer access).' }
    }
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
      case 'createRequest': {
        // Persist immediately, then open the freshly created request in the
        // editor (linked). The tree broadcast reveals it in its folder.
        await deps.collections.saveRequest(msg.collectionId, msg.request, msg.folderId)
        const c = (await deps.collections.list()).find((x) => x.id === msg.collectionId)
        if (c?.environmentId) deps.setActiveEnvId(c.environmentId)
        return openItemMsg(msg.request, msg.collectionId, msg.folderId)
      }
      case 'duplicateRequest': {
        const all = await deps.collections.list()
        const c = all.find((x) => x.id === msg.collectionId)
        if (!c) return { type: 'tree', collections: all }
        const bucket = reqBucket(c, msg.folderId)
        const i = bucket?.findIndex((r) => r.id === msg.requestId) ?? -1
        if (!bucket || i < 0) return { type: 'tree', collections: all }
        const src = bucket[i]
        bucket.splice(i + 1, 0, { ...src, id: newId(), name: `${src.name} Copy` })
        await deps.collections.saveCollection(c)
        return { type: 'tree', collections: await deps.collections.list() }
      }
      case 'setCollectionEnvironment': {
        const c = (await deps.collections.list()).find((x) => x.id === msg.collectionId)
        if (c) await deps.collections.saveCollection({ ...c, environmentId: msg.environmentId ?? undefined })
        return { type: 'tree', collections: await deps.collections.list() }
      }
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
      case 'deleteEnvironment': {
        const env = (await deps.environments.list()).find((e) => e.id === msg.id)
        if (env) await deps.trash?.add({ workspaceId: deps.getActiveWorkspaceId(), kind: 'environment', data: env })
        await deps.environments.deleteEnvironment(msg.id)
        if (deps.getActiveEnvId() === msg.id) deps.setActiveEnvId(null)
        return await envSnapshot()
      }
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
      case 'openRequest': {
        // Opening a request from a collection with a bound environment activates
        // that environment (snapshot broadcast reflects it).
        if (msg.targetCollectionId) {
          const c = (await deps.collections.list()).find((x) => x.id === msg.targetCollectionId)
          if (c?.environmentId) deps.setActiveEnvId(c.environmentId)
        }
        return openItemMsg(msg.request, msg.targetCollectionId, msg.targetFolderId)
      }
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
        // Trash the Drive file + server rows first if this workspace was
        // synced (best-effort: a sync-side failure must never block the
        // local, permanent delete below).
        try { await deps.onWorkspaceDeleted?.(msg.id) } catch { /* best-effort */ }
        await deps.workspaces.delete(msg.id)
        // if the active workspace was deleted, pick/create a fallback and make it active
        if (deps.getActiveWorkspaceId() === msg.id) {
          const remaining = await deps.workspaces.list()
          const fallback = remaining[0] ?? (await deps.workspaces.create('Default'))
          deps.setActiveWorkspaceId(fallback.id)
          deps.setActiveEnvId(null)
        }
        // Workspace deletion is permanent (no trash): remove its collections,
        // environments, history and any trash entries outright.
        for (const c of await deps.collections.list()) {
          if (c.workspaceId === msg.id) await deps.collections.delete(c.id)
        }
        for (const e of await deps.environments.list()) {
          if (e.workspaceId === msg.id) await deps.environments.deleteEnvironment(e.id)
        }
        await deps.history.dropByWorkspace(msg.id)
        await deps.trash?.dropByWorkspace(msg.id)
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
      case 'deleteCollection': {
        const c = (await deps.collections.list()).find((x) => x.id === msg.id)
        if (c) {
          await deps.trash?.add({ workspaceId: deps.getActiveWorkspaceId(), kind: 'collection', data: c })
          await deps.collections.delete(msg.id)
        }
        return { type: 'tree', collections: await deps.collections.list() }
      }
      case 'renameCollection':
        await withCollection(msg.id, (c) => { c.name = msg.name })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'createFolder':
        await withCollection(msg.collectionId, (c) => { (c.folders ??= []).push({ id: newId(), name: msg.name, requests: [] }) })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'renameFolder':
        await withCollection(msg.collectionId, (c) => { const f = (c.folders ?? []).find((x) => x.id === msg.folderId); if (f) f.name = msg.name })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'deleteFolder': {
        const c = (await deps.collections.list()).find((x) => x.id === msg.collectionId)
        const f = (c?.folders ?? []).find((x) => x.id === msg.folderId)
        if (c && f) {
          await deps.trash?.add({ workspaceId: deps.getActiveWorkspaceId(), kind: 'folder', data: f, path: { collectionId: c.id, collectionName: c.name } })
          await deps.collections.saveCollection({ ...c, folders: (c.folders ?? []).filter((x) => x.id !== msg.folderId) })
        }
        return { type: 'tree', collections: await deps.collections.list() }
      }
      case 'renameRequest':
        await withCollection(msg.collectionId, (c) => { renameReqIn(c, msg.folderId, msg.requestId, msg.name) })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'deleteRequest': {
        const c = (await deps.collections.list()).find((x) => x.id === msg.collectionId)
        if (c) {
          const folder = msg.folderId ? (c.folders ?? []).find((x) => x.id === msg.folderId) : undefined
          const bucket = reqBucket(c, msg.folderId)
          const item = bucket?.find((r) => r.id === msg.requestId)
          if (item) {
            await deps.trash?.add({
              workspaceId: deps.getActiveWorkspaceId(), kind: 'request', data: item,
              path: { collectionId: c.id, collectionName: c.name, folderId: folder?.id, folderName: folder?.name },
            })
            deleteReqIn(c, msg.folderId, msg.requestId)
            await deps.collections.saveCollection(c)
          }
        }
        return { type: 'tree', collections: await deps.collections.list() }
      }
      case 'loadTrash':
        return await trashSnapshot()
      case 'purgeTrash':
        await deps.trash?.remove(msg.entryId)
        return await trashSnapshot()
      case 'restoreTrash': {
        const e = await deps.trash?.get(msg.entryId)
        if (!e) return await trashSnapshot()

        if (e.kind === 'environment') {
          await deps.environments.saveEnvironment(e.data as import('../shared/types').Environment)
          await deps.trash?.remove(e.id)
        } else if (e.kind === 'request') {
          const p = e.path!
          await restoreRequestInto(p.collectionId, p.collectionName, p.folderId ? { id: p.folderId, name: p.folderName ?? 'Folder' } : null, e.data as import('../shared/types').CollectionItem)
          await deps.trash?.remove(e.id)
        } else if (e.kind === 'folder') {
          const folder = e.data as import('../shared/types').Folder
          const p = e.path!
          if (msg.requestId) {
            const req = folder.requests.find((r) => r.id === msg.requestId)
            if (req) {
              await restoreRequestInto(p.collectionId, p.collectionName, { id: folder.id, name: folder.name }, req)
              folder.requests = folder.requests.filter((r) => r.id !== msg.requestId)
            }
            if (folder.requests.length === 0) await deps.trash?.remove(e.id)
            else await deps.trash?.update({ ...e, data: folder })
          } else {
            await restoreFolderInto(p.collectionId, p.collectionName, folder)
            await deps.trash?.remove(e.id)
          }
        } else {
          // collection: restore the whole thing, or a folder/request within it
          const col = e.data as import('../shared/types').Collection
          if (msg.requestId) {
            const folder = msg.folderId ? (col.folders ?? []).find((f) => f.id === msg.folderId) : undefined
            const bucket = folder ? folder.requests : col.requests
            const req = bucket.find((r) => r.id === msg.requestId)
            if (req) {
              await restoreRequestInto(col.id, col.name, folder ? { id: folder.id, name: folder.name } : null, req)
              if (folder) folder.requests = folder.requests.filter((r) => r.id !== msg.requestId)
              else col.requests = col.requests.filter((r) => r.id !== msg.requestId)
            }
          } else if (msg.folderId) {
            const folder = (col.folders ?? []).find((f) => f.id === msg.folderId)
            if (folder) {
              await restoreFolderInto(col.id, col.name, folder)
              col.folders = (col.folders ?? []).filter((f) => f.id !== msg.folderId)
            }
          } else {
            // Whole-collection restore: merge into the live collection if it
            // still exists (preserving anything added since deletion), else
            // recreate it from the snapshot.
            const live = (await deps.collections.list()).find((x) => x.id === col.id)
            if (live) { mergeCollectionInto(live, col); await deps.collections.saveCollection(live) }
            else await deps.collections.saveCollection(col)
            await deps.trash?.remove(e.id)
            return await trashSnapshot()
          }
          const empty = (col.folders ?? []).length === 0 && col.requests.length === 0
          if (empty) await deps.trash?.remove(e.id)
          else await deps.trash?.update({ ...e, data: col })
        }
        return await trashSnapshot()
      }
      case 'openEnvironments':
        return { type: 'showEnvironments', id: msg.id }
      case 'openMembers':
        return { type: 'showMembers', workspaceId: msg.workspaceId }
      case 'loadMembers':
        return { type: 'members', members: (await deps.members?.list(msg.workspaceId)) ?? [] }
      case 'addMember':
        await deps.members?.add(msg.workspaceId, msg.email, msg.role)
        return { type: 'members', members: (await deps.members?.list(msg.workspaceId)) ?? [] }
      case 'removeMember':
        await deps.members?.remove(msg.workspaceId, msg.memberId)
        return { type: 'members', members: (await deps.members?.list(msg.workspaceId)) ?? [] }
      case 'openWebSocket':
        return { type: 'showWebSocket' }
      case 'openGrpc':
        return { type: 'showGrpc' }
      case 'grpcInvoke': {
        if (!deps.grpcInvoke) return { type: 'grpcResponse', requestId: msg.requestId, ok: false, error: 'gRPC is not available', timeMs: 0 }
        const r = await deps.grpcInvoke({
          address: msg.address, proto: msg.proto, service: msg.service,
          method: msg.method, message: msg.message, metadata: msg.metadata, plaintext: msg.plaintext,
        })
        return { type: 'grpcResponse', requestId: msg.requestId, ok: r.ok, message: r.message, error: r.error, timeMs: r.timeMs }
      }
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
      case 'moveFolder': {
        // Folders live only at collection top-level, so a move just re-parents
        // the whole folder from one collection to another.
        if (msg.fromCollectionId === msg.toCollectionId) return { type: 'tree', collections: await deps.collections.list() }
        const all = await deps.collections.list()
        const from = all.find((c) => c.id === msg.fromCollectionId)
        const to = all.find((c) => c.id === msg.toCollectionId)
        if (!from || !to) return { type: 'tree', collections: all }
        const folder = (from.folders ?? []).find((f) => f.id === msg.folderId)
        if (!folder) return { type: 'tree', collections: all }
        from.folders = (from.folders ?? []).filter((f) => f.id !== msg.folderId)
        ;(to.folders ??= []).push(folder)
        await deps.collections.saveCollection(from)
        await deps.collections.saveCollection(to)
        return { type: 'tree', collections: await deps.collections.list() }
      }
      case 'signIn': await deps.syncControl?.signIn(); return undefined
      case 'signOut': await deps.syncControl?.signOut(msg.accountId); return undefined
      case 'enableSync': await deps.syncControl?.enable(msg.workspaceId, msg.accountId); return undefined
      case 'syncNow': await deps.syncControl?.syncNow(msg.workspaceId); return undefined
      default:
        return undefined
    }
  }
}

function reqBucket(c: import('../shared/types').Collection, folderId: string | null) {
  if (folderId) return ((c.folders ?? []).find((f) => f.id === folderId)?.requests) ?? null
  return c.requests
}
// Trash restore is a merge, never an overwrite: add only items whose id is not
// already present, so restoring never clobbers content added after deletion.
function mergeRequestsInto(target: import('../shared/types').CollectionItem[], incoming: import('../shared/types').CollectionItem[]) {
  for (const r of incoming) if (!target.some((x) => x.id === r.id)) target.push(r)
}
function mergeFolderInto(c: import('../shared/types').Collection, folder: import('../shared/types').Folder) {
  c.folders = c.folders ?? []
  const existing = c.folders.find((f) => f.id === folder.id)
  if (existing) mergeRequestsInto(existing.requests, folder.requests)
  else c.folders.push(folder)
}
function mergeCollectionInto(target: import('../shared/types').Collection, incoming: import('../shared/types').Collection) {
  mergeRequestsInto(target.requests, incoming.requests)
  for (const f of incoming.folders ?? []) mergeFolderInto(target, f)
}
function renameReqIn(c: import('../shared/types').Collection, folderId: string | null, reqId: string, name: string) {
  const b = reqBucket(c, folderId); if (!b) return
  const r = b.find((x) => x.id === reqId); if (r) r.name = name
}
function deleteReqIn(c: import('../shared/types').Collection, folderId: string | null, reqId: string) {
  if (folderId) { const f = (c.folders ?? []).find((x) => x.id === folderId); if (f) f.requests = f.requests.filter((x) => x.id !== reqId) }
  else c.requests = c.requests.filter((x) => x.id !== reqId)
}
