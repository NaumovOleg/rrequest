import type { HostMessage, WebviewMessage } from '../shared/types'
import type { sendRequest as SendFn } from './http-client'
import type { CollectionStore } from './collection-store'
import type { HistoryStore } from './history-store'
import type { EnvironmentStore } from './environment-store'
import type { WorkspaceStore } from './workspace-store'

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
}

export function createRouter(deps: RouterDeps) {
  async function envSnapshot(): Promise<{ type: 'environments'; environments: import('../shared/types').Environment[]; activeId: string | null }> {
    return { type: 'environments', environments: await deps.environments.list(), activeId: deps.getActiveEnvId() }
  }
  async function activeVars() {
    const id = deps.getActiveEnvId()
    if (!id) return []
    const env = (await deps.environments.list()).find((e) => e.id === id)
    return env ? env.variables : []
  }
  async function wsSnapshot(): Promise<HostMessage> {
    return { type: 'workspaces', workspaces: await deps.workspaces.list(), activeId: deps.getActiveWorkspaceId() }
  }

  return async function route(msg: WebviewMessage): Promise<HostMessage | undefined> {
    switch (msg.type) {
      case 'sendRequest': {
        const payload = await deps.send(msg.payload, { vars: await activeVars() })
        await deps.history.append(msg.payload, payload.status)
        return { type: 'response', requestId: msg.requestId, payload }
      }
      case 'loadTree':
        return { type: 'tree', collections: await deps.collections.list() }
      case 'createCollection':
        await deps.collections.createCollection(msg.name, deps.getActiveWorkspaceId())
        return { type: 'tree', collections: await deps.collections.list() }
      case 'saveRequest':
        await deps.collections.saveRequest(msg.collectionId, msg.request)
        return { type: 'tree', collections: await deps.collections.list() }
      case 'loadHistory':
        return { type: 'history', entries: await deps.history.list() }
      case 'ready':
        return { type: 'tree', collections: await deps.collections.list() }
      case 'loadEnvironments':
        return await envSnapshot()
      case 'createEnvironment':
        await deps.environments.createEnvironment(msg.name)
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
        return { type: 'openInEditor', request: msg.request }
      case 'loadWorkspaces':
        return await wsSnapshot()
      case 'createWorkspace':
        await deps.workspaces.create(msg.name)
        return await wsSnapshot()
      case 'renameWorkspace':
        await deps.workspaces.rename(msg.id, msg.name)
        return await wsSnapshot()
      case 'setActiveWorkspace':
        deps.setActiveWorkspaceId(msg.id)
        return await wsSnapshot()
      case 'deleteWorkspace': {
        await deps.workspaces.delete(msg.id)
        // if the active workspace was deleted, pick/create a fallback and make it active
        if (deps.getActiveWorkspaceId() === msg.id) {
          const remaining = await deps.workspaces.list()
          const fallback = remaining[0] ?? (await deps.workspaces.create('Default'))
          deps.setActiveWorkspaceId(fallback.id)
        }
        // reassign orphaned collections to the (now-)active workspace, regardless of which ws was deleted
        const target = deps.getActiveWorkspaceId()
        for (const c of await deps.collections.list()) {
          if (c.workspaceId === msg.id) await deps.collections.saveCollection({ ...c, workspaceId: target })
        }
        return await wsSnapshot()
      }
      default:
        return undefined
    }
  }
}
