import type { HostMessage, WebviewMessage } from '../shared/types'
import type { sendRequest as SendFn } from './http-client'
import type { CollectionStore } from './collection-store'
import type { HistoryStore } from './history-store'

export type RouterDeps = {
  send: typeof SendFn
  collections: CollectionStore
  history: HistoryStore
}

export function createRouter(deps: RouterDeps) {
  return async function route(msg: WebviewMessage): Promise<HostMessage | undefined> {
    switch (msg.type) {
      case 'sendRequest': {
        const payload = await deps.send(msg.payload)
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
      default:
        return undefined
    }
  }
}
