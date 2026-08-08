import { newId, itemKind, type CollectionItem, type GrpcRequest, type HostMessage, type KeyValue, type Member, type RestRequest, type WebviewMessage, type WsRequest } from '../shared/types'
import { interpolate as interpolateStr } from './scripting/interpolate'
import { isMutating } from './sync/sync-runtime'

// The host message that opens an item in the right kind of editor panel.
function openItemMsg(item: CollectionItem, targetCollectionId?: string, targetFolderId?: string | null): HostMessage {
  const kind = itemKind(item)
  if (kind === 'grpc') return { type: 'openGrpcRequest', request: item as GrpcRequest, targetCollectionId, targetFolderId }
  if (kind === 'ws') return { type: 'openWsRequest', request: item as WsRequest, targetCollectionId, targetFolderId }
  return { type: 'openInEditor', request: item as RestRequest, targetCollectionId, targetFolderId }
}
import type { sendRequest as SendFn } from './net/http-client'
import type { CollectionStore } from './stores/collection-store'
import type { HistoryStore } from './stores/history-store'
import type { EnvironmentStore } from './stores/environment-store'
import type { WorkspaceStore } from './stores/workspace-store'
import type { WsManager } from './net/ws-manager'

export type RouterDeps = {
  send: typeof SendFn
  collections: CollectionStore
  history: HistoryStore
  environments: EnvironmentStore
  getActiveEnvId: () => string | null
  setActiveEnvId: (id: string | null) => void
  openImport?: () => Promise<import('../shared/types').Collection | null>
  runExport?: (c: import('../shared/types').Collection, format: 'native' | 'postman' | 'openapi') => Promise<void>
  pickFile?: () => Promise<{ path: string; filename: string } | null>
  workspaces: WorkspaceStore
  // Tags each workspace with its sync fields (accountId/accountEmail/role/
  // synced) so the immediate reply to create/rename/enable already shows the
  // workspace under its account — not as "local" until the next full refresh.
  enrichWorkspaces?: (list: import('../shared/types').Workspace[]) => Promise<import('../shared/types').Workspace[]>
  getActiveWorkspaceId: () => string
  setActiveWorkspaceId: (id: string) => void
  runPreScript?: (script: string, ctx: { request: import('../shared/types').RestRequest; vars: KeyValue[] }) => Promise<{ request: import('../shared/types').RestRequest; envSets: KeyValue[]; logs: string[]; error?: string }>
  runTestScript?: (script: string, ctx: { response: import('../shared/types').HttpResponse; vars: KeyValue[] }) => Promise<{ tests: import('../shared/types').TestResult[]; envSets: KeyValue[]; logs: string[]; error?: string }>
  ws?: WsManager
  sse?: import('./net/sse-client').SseClient
  grpcInvoke?: (p: import('./net/grpc-client').GrpcParams) => Promise<import('./net/grpc-client').GrpcResult>
  trash?: import('./stores/trash-store').TrashStore
  // Opens `content` in a VS Code text editor (untitled document), giving the
  // response full editor features (search, folding, syntax highlighting).
  openTextDocument?: (opts: { content: string; language: string }) => Promise<void>
  isReadOnly?: (workspaceId: string) => boolean
  members?: { list(workspaceId: string): Promise<Member[]>; add(workspaceId: string, email: string, role: 'editor' | 'viewer'): Promise<void>; remove(workspaceId: string, memberId: string): Promise<void> }
  syncControl?: { signIn(): Promise<void>; signOut(accountId?: string): Promise<void>; enable(workspaceId: string, accountId?: string): Promise<void>; syncNow(workspaceId: string): Promise<void>; syncAccount(accountId: string): Promise<void>; setPolling(workspaceId: string, enabled: boolean): Promise<void> }
  // Best-effort hook fired when a workspace is deleted locally, so the host
  // can also trash its Drive file + server rows if it was synced. Must never
  // reject (the sync side already swallows its own errors) and never blocks
  // the local delete below, which proceeds regardless.
  onWorkspaceDeleted?: (workspaceId: string) => Promise<void>
  // Shows a native save dialog and writes `content` to the picked file.
  // Returns the saved path, or null when the user cancelled / it failed.
  saveBodyToFile?: (opts: { content: string; isBase64: boolean; suggestName: string }) => Promise<string | null>
  // Opens the bundled usage/scripting docs (markdown) in the editor.
  openDocs?: () => Promise<void>
  // OAuth2 host helpers (token resolution / interactive flow / status).
  oauth?: {
    resolve(auth: import('../shared/types').Auth, requestId: string): Promise<string>
    fetch(auth: import('../shared/types').Auth, requestId: string): Promise<{ expiresInSec?: number }>
    status(requestId: string): Promise<{ ok: boolean; expiresInSec?: number }>
  }
  // HTTP request timeout in ms (from the rrequest.requestTimeoutMs setting).
  timeoutMs?: number
}

// requestId -> the FULL body of its latest response, kept off the webview IPC
// (the response message itself is truncated to maxBytes). "Save response body"
// writes from here so the saved file is complete even when the preview was
// truncated. Bounded: capped by count; oversized bodies are dropped so a
// 500 MB download never pins memory.
const MAX_KEPT_FULL_BODIES = 16
const MAX_KEPT_FULL_BYTES = 64 * 1024 * 1024
const fullBodies = new Map<string, { text?: string; base64?: string; sizeBytes: number }>()

function keepFullBody(requestId: string, full: { text?: string; base64?: string }): void {
  const sizeBytes = full.text ? Buffer.byteLength(full.text, 'utf8') : (full.base64 ? full.base64.length * 0.75 : 0)
  if (sizeBytes > MAX_KEPT_FULL_BYTES) return // too big to cache — save falls back to the preview
  fullBodies.set(requestId, { ...full, sizeBytes })
  if (fullBodies.size > MAX_KEPT_FULL_BODIES) {
    const oldest = fullBodies.keys().next().value
    if (oldest !== undefined) fullBodies.delete(oldest)
  }
}

// requestId -> AbortController of its in-flight sendRequest. Lets a
// `cancelRequest` from the webview actually abort the running fetch instead of
// just hiding the spinner in the UI.
const inflight = new Map<string, AbortController>()

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
    const list = await deps.workspaces.list()
    const workspaces = deps.enrichWorkspaces ? await deps.enrichWorkspaces(list) : list
    return { type: 'workspaces', workspaces, activeId: deps.getActiveWorkspaceId() }
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

  // Collection -> folder -> request cascade scripts: pre runs top-down, test
  // bottom-up (request first), matching Postman/Bruno sandwich order. Levels
  // with no script are skipped; logs/envSets merge across all levels.
  async function resolveCascade(collectionId?: string, folderId?: string | null): Promise<{ pre: string[]; test: string[] }> {
    const pre: string[] = []
    const test: string[] = []
    if (!collectionId) return { pre, test }
    const c = (await deps.collections.list()).find((x) => x.id === collectionId)
    if (!c) return { pre, test }
    if (c.preRequestScript) pre.push(c.preRequestScript)
    if (c.testScript) test.unshift(c.testScript)
    if (folderId) {
      const folder = c.folders?.find((f) => f.id === folderId)
      if (folder?.preRequestScript) pre.push(folder.preRequestScript)
      if (folder?.testScript) test.unshift(folder.testScript)
    }
    return { pre, test }
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
        // Collection/folder scripts run around the request's own script in
        // sandwich order: pre top-down (collection -> folder -> request),
        // test bottom-up (request -> folder -> collection). Each pre script
        // mutates the request for the next; errors abort the send like a
        // failed request-level pre script.
        const cascade = await resolveCascade(msg.collectionId, msg.folderId)
        const runPre = async (script: string, level: string) => {
          if (!script || !deps.runPreScript) return true
          const pre = await deps.runPreScript(script, { request: effective, vars })
          logs.push(...pre.logs)
          if (pre.error) {
            logs.push(`[${level} pre-request script] ${pre.error}`)
            return false
          }
          if (pre.envSets.length) { await persistEnvSets(pre.envSets); vars = await activeVars() }
          effective = pre.request
          return true
        }
        if (!(await runPre(cascade.pre[0], 'collection'))) {
          return {
            type: 'response',
            requestId: msg.requestId,
            payload: {
              status: 0, statusText: 'Pre-request script failed', headers: [], body: '',
              bodyTruncated: false, timeMs: 0, sizeBytes: 0, cookies: [],
              error: { kind: 'script', message: 'Collection pre-request script failed' },
              consoleLogs: logs,
            },
          }
        }
        if (!(await runPre(cascade.pre[1], 'folder'))) {
          return {
            type: 'response',
            requestId: msg.requestId,
            payload: {
              status: 0, statusText: 'Pre-request script failed', headers: [], body: '',
              bodyTruncated: false, timeMs: 0, sizeBytes: 0, cookies: [],
              error: { kind: 'script', message: 'Folder pre-request script failed' },
              consoleLogs: logs,
            },
          }
        }
        if (raw.preRequestScript && deps.runPreScript) {
          const pre = await deps.runPreScript(raw.preRequestScript, { request: raw, vars })
          logs.push(...pre.logs)
          if (pre.error) {
            // A failed pre-request script must be loud: surface it as the
            // response error instead of silently sending the raw request.
            return {
              type: 'response',
              requestId: msg.requestId,
              payload: {
                status: 0, statusText: 'Pre-request script failed', headers: [], body: '',
                bodyTruncated: false, timeMs: 0, sizeBytes: 0, cookies: [],
                error: { kind: 'script', message: pre.error },
                consoleLogs: logs,
              },
            }
          }
          if (pre.envSets.length) { await persistEnvSets(pre.envSets); vars = await activeVars() }
          effective = pre.request
        }
        const controller = new AbortController()
        inflight.set(msg.requestId, controller)
        try {
          // OAuth2: resolve a usable access token BEFORE sending (scripts may
          // have changed the auth mid-cascade), inject as the Authorization
          // header unless the user already set one explicitly.
          if (effective.auth?.type === 'oauth2' && deps.oauth) {
            try {
              const token = await deps.oauth.resolve(effective.auth, msg.requestId)
              const hasAuth = (effective.headers ?? []).some((h) => h.enabled && h.key.toLowerCase() === 'authorization')
              if (!hasAuth) {
                effective = {
                  ...effective,
                  headers: [...(effective.headers ?? []), { key: 'Authorization', value: `Bearer ${token}`, enabled: true }],
                }
              }
            } catch (e: any) {
              return {
                type: 'response',
                requestId: msg.requestId,
                payload: {
                  status: 0, statusText: 'OAuth2 failed', headers: [], body: '',
                  bodyTruncated: false, timeMs: 0, sizeBytes: 0, cookies: [],
                  error: { kind: 'script', message: `OAuth2: ${String(e?.message ?? e)}` },
                  consoleLogs: logs,
                },
              }
            }
          }
          const payload = await deps.send(effective, {
            vars,
            onFullBody: (full) => keepFullBody(msg.requestId, full),
            externalSignal: controller.signal,
            timeoutMs: deps.timeoutMs,
          })
          let testResults: import('../shared/types').TestResult[] = []
          let scriptError: string | undefined
          const runTest = async (script: string) => {
            if (!script || !deps.runTestScript) return
            const post = await deps.runTestScript(script, { response: payload, vars })
            logs.push(...post.logs)
            if (post.error) {
              // A top-level test-script crash becomes a failed test entry, so
              // it shows up in the results table instead of vanishing.
              logs.push(`[test error] ${post.error}`)
              testResults = [...testResults, { name: 'test script', passed: false, error: post.error }]
              scriptError = post.error
            } else {
              testResults = [...testResults, ...post.tests]
            }
            if (post.envSets.length) await persistEnvSets(post.envSets)
          }
          // Sandwich order: request tests first, then folder, then collection.
          // cascade.test = [folder, collection] (folder unshifted last), so
          // request -> test[0] (folder) -> test[1] (collection).
          await runTest(raw.testScript ?? '')
          await runTest(cascade.test[0])
          await runTest(cascade.test[1])
          const withMeta = {
            ...payload,
            testResults,
            consoleLogs: logs,
            // kind 'script' — the panel renders it as a banner above the
            // response instead of replacing it, so tests stay visible.
            ...(scriptError ? { error: { kind: 'script' as const, message: scriptError } } : {}),
          }
          if (payload.error?.kind !== 'canceled')
            await deps.history.append(raw, payload.status, deps.getActiveWorkspaceId())
          return { type: 'response', requestId: msg.requestId, payload: withMeta }
        } finally {
          inflight.delete(msg.requestId)
        }
      }
      case 'cancelRequest': {
        inflight.get(msg.requestId)?.abort()
        return undefined
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
      case 'duplicateCollection': {
        const all = await deps.collections.list()
        const src = all.find((x) => x.id === msg.id)
        if (!src) return { type: 'tree', collections: all }
        // Deep clone with fresh ids everywhere (collection, folders, requests)
        // so the copy is fully independent of the original.
        const clone: import('../shared/types').Collection = {
          ...src,
          id: newId(),
          name: `${src.name} Copy`,
          requests: src.requests.map((r) => ({ ...r, id: newId() })),
          folders: (src.folders ?? []).map((f) => ({ ...f, id: newId(), requests: f.requests.map((r) => ({ ...r, id: newId() })) })),
        }
        await deps.collections.saveCollection(clone)
        return { type: 'tree', collections: await deps.collections.list() }
      }
      case 'moveCollection': {
        // Re-parent a whole collection into another workspace, ids intact (a
        // move, not a copy — open tabs and trash paths keep pointing at it).
        // The bound environment belongs to the source workspace and isn't
        // moved, so the binding is dropped rather than left dangling.
        const all = await deps.collections.list()
        const c = all.find((x) => x.id === msg.id)
        if (!c || c.workspaceId === msg.toWorkspaceId) return { type: 'tree', collections: all }
        const target = (await deps.workspaces.list()).find((w) => w.id === msg.toWorkspaceId)
        if (!target) return { type: 'tree', collections: all }
        if (deps.isReadOnly?.(msg.toWorkspaceId)) {
          return { type: 'toast', level: 'error', message: 'That workspace is read-only (viewer access).' }
        }
        const { environmentId: _dropped, ...rest } = c
        await deps.collections.saveCollection({ ...rest, workspaceId: msg.toWorkspaceId })
        return { type: 'tree', collections: await deps.collections.list() }
      }
      case 'duplicateFolder': {
        const all = await deps.collections.list()
        const c = all.find((x) => x.id === msg.collectionId)
        const folders = c?.folders ?? []
        const i = folders.findIndex((f) => f.id === msg.folderId)
        if (!c || i < 0) return { type: 'tree', collections: all }
        const src = folders[i]
        const clone = { ...src, id: newId(), name: `${src.name} Copy`, requests: src.requests.map((r) => ({ ...r, id: newId() })) }
        folders.splice(i + 1, 0, clone)
        await deps.collections.saveCollection({ ...c, folders })
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
      case 'openDocs': {
        if (deps.openDocs) await deps.openDocs()
        return undefined
      }
      case 'oauthGetToken': {
        if (!deps.oauth || msg.auth.type !== 'oauth2') return { type: 'oauthResult', requestId: msg.requestId, ok: false, error: 'OAuth2 is not available' }
        try {
          const r = await deps.oauth.fetch(msg.auth, msg.requestId)
          return { type: 'oauthResult', requestId: msg.requestId, ok: true, expiresInSec: r.expiresInSec }
        } catch (e: any) {
          return { type: 'oauthResult', requestId: msg.requestId, ok: false, error: String(e?.message ?? e) }
        }
      }
      case 'oauthStatus': {
        if (!deps.oauth) return { type: 'oauthStatusResult', requestId: msg.requestId, ok: false }
        const s = await deps.oauth.status(msg.requestId)
        return { type: 'oauthStatusResult', requestId: msg.requestId, ok: s.ok, expiresInSec: s.expiresInSec }
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
        // Creating "into" an account immediately enables sync bound to it.
        if (msg.accountId) await deps.syncControl?.enable(created.id, msg.accountId)
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
      case 'wsConnect': {
        const vars = await activeVars()
        const sub = vars.length ? (s: string) => interpolateStr(s, vars) : (s: string) => s
        deps.ws?.connect(
          msg.connId,
          sub(msg.url),
          msg.headers.map((h) => ({ ...h, key: sub(h.key), value: sub(h.value) })),
        )
        return undefined
      }
      case 'wsSend':
        deps.ws?.send(msg.connId, msg.data)
        return undefined
      case 'wsDisconnect':
        deps.ws?.disconnect(msg.connId)
        return undefined
      case 'openSse':
        return { type: 'showSse' }
      case 'sseConnect': {
        const vars = await activeVars()
        const sub = vars.length ? (s: string) => interpolateStr(s, vars) : (s: string) => s
        deps.sse?.connect(
          msg.connId,
          sub(msg.url),
          msg.headers.map((h) => ({ ...h, key: sub(h.key), value: sub(h.value) })),
        )
        return undefined
      }
      case 'sseDisconnect':
        deps.sse?.disconnect(msg.connId)
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
      case 'saveCollectionScript':
        await withCollection(msg.collectionId, (c) => { c.preRequestScript = msg.preRequestScript; c.testScript = msg.testScript })
        return { type: 'tree', collections: await deps.collections.list() }
      case 'saveFolderScript':
        await withCollection(msg.collectionId, (c) => { const f = (c.folders ?? []).find((x) => x.id === msg.folderId); if (f) { f.preRequestScript = msg.preRequestScript; f.testScript = msg.testScript } })
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
      case 'emptyTrash':
        // Batch purge: drop every trash entry for the active workspace at once.
        await deps.trash?.dropByWorkspace(deps.getActiveWorkspaceId())
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
        const vars = await activeVars()
        const sub = vars.length ? (s: string) => interpolateStr(s, vars) : (s: string) => s
        const r = await deps.grpcInvoke({
          address: sub(msg.address), proto: sub(msg.proto), service: sub(msg.service),
          method: sub(msg.method), message: msg.message,
          metadata: msg.metadata.map((m) => ({ ...m, key: sub(m.key), value: sub(m.value) })),
          plaintext: msg.plaintext,
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
      case 'reorderRequest': {
        // Move a request one step up/down within its bucket (collection root
        // or folder). Order inside a bucket persists in the collection file.
        const c = (await deps.collections.list()).find((x) => x.id === msg.collectionId)
        if (c) {
          const bucket = reqBucket(c, msg.folderId)
          if (bucket) {
            const i = bucket.findIndex((r) => r.id === msg.requestId)
            const j = msg.delta === 'up' ? i - 1 : i + 1
            if (i >= 0 && j >= 0 && j < bucket.length) {
              const [item] = bucket.splice(i, 1)
              bucket.splice(j, 0, item)
              await deps.collections.saveCollection(c)
            }
          }
        }
        return { type: 'tree', collections: await deps.collections.list() }
      }
      case 'reorderFolder': {
        const c = (await deps.collections.list()).find((x) => x.id === msg.collectionId)
        if (c) {
          const folders = c.folders ?? []
          const i = folders.findIndex((f) => f.id === msg.folderId)
          const j = msg.delta === 'up' ? i - 1 : i + 1
          if (i >= 0 && j >= 0 && j < folders.length) {
            const [folder] = folders.splice(i, 1)
            folders.splice(j, 0, folder)
            await deps.collections.saveCollection(c)
          }
        }
        return { type: 'tree', collections: await deps.collections.list() }
      }
      case 'clearHistory':
        await deps.history.clear()
        return await histSnapshot()
      case 'saveExample': {
        const all = await deps.collections.list()
        const found = findRequestIn(all, msg.requestId)
        if (found) {
          // Examples belong on HTTP requests only.
          if (itemKind(found.req) === 'http') {
            const r = found.req as import('../shared/types').RestRequest
            const examples = [...(r.examples ?? []), msg.example]
            // Cap: keep the newest 50 (oldest trimmed) — examples are regression
            // snapshots, not a log.
            r.examples = examples.length > 50 ? examples.slice(examples.length - 50) : examples
            await deps.collections.saveCollection(found.c)
          }
        }
        return { type: 'tree', collections: all }
      }
      case 'deleteExample': {
        const all = await deps.collections.list()
        const found = findRequestIn(all, msg.requestId)
        if (found && itemKind(found.req) === 'http') {
          const r = found.req as import('../shared/types').RestRequest
          r.examples = (r.examples ?? []).filter((e) => e.id !== msg.exampleId)
          await deps.collections.saveCollection(found.c)
        }
        return { type: 'tree', collections: all }
      }
      case 'openTextDocument':
        await deps.openTextDocument?.({ content: msg.content, language: msg.language })
        return undefined
      case 'saveBody': {
        // Prefer the cached FULL body (complete even for truncated previews),
        // so the saved file matches the real response — not the 5 MB preview.
        const cached = fullBodies.get(msg.requestId)
        const content = cached?.base64 ?? cached?.text ?? msg.fallbackContent
        const isBase64 = !!cached?.base64 || (cached === undefined && !!msg.fallbackIsBase64)
        if (content === undefined) {
          return { type: 'toast', level: 'error', message: 'Response body is no longer available — resend the request.' }
        }
        const path = await deps.saveBodyToFile?.({ content, isBase64, suggestName: msg.suggestName ?? 'response' })
        if (path) return { type: 'toast', level: 'info', message: `Saved response body to ${path}` }
        return undefined
      }
      case 'signIn': await deps.syncControl?.signIn(); return undefined
      case 'signOut': await deps.syncControl?.signOut(msg.accountId); return undefined
      case 'syncAccount': await deps.syncControl?.syncAccount(msg.accountId); return undefined
      case 'enableSync': await deps.syncControl?.enable(msg.workspaceId, msg.accountId); return undefined
      case 'syncNow': await deps.syncControl?.syncNow(msg.workspaceId); return undefined
      case 'setWorkspacePolling': await deps.syncControl?.setPolling(msg.workspaceId, msg.enabled); return undefined
      default:
        return undefined
    }
  }
}

// A request lives in some collection (root or a folder) — find the first
// match by id across the tree, so examples editing doesn't need the caller to
// know the request's exact location.
function findRequestIn(all: import('../shared/types').Collection[], requestId: string):
  { c: import('../shared/types').Collection; req: import('../shared/types').CollectionItem } | undefined {
  for (const c of all) {
    const direct = c.requests.find((r) => r.id === requestId)
    if (direct) return { c, req: direct }
    for (const f of c.folders ?? []) {
      const inFolder = f.requests.find((r) => r.id === requestId)
      if (inFolder) return { c, req: inFolder }
    }
  }
  return undefined
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
