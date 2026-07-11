import type { HostMessage, WebviewMessage } from '../shared/types'
import type { sendRequest as SendFn } from './http-client'
import type { CollectionStore } from './collection-store'
import type { HistoryStore } from './history-store'
import type { EnvironmentStore } from './environment-store'

export type RouterDeps = {
  send: typeof SendFn
  collections: CollectionStore
  history: HistoryStore
  environments: EnvironmentStore
  getActiveEnvId: () => string | null
  setActiveEnvId: (id: string | null) => void
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
        await deps.collections.createCollection(msg.name)
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
      default:
        return undefined
    }
  }
}
