import { describe, it, expect } from 'vitest'
import type { Folder, Collection, WebviewMessage, HostMessage, RestRequest } from '../../src/shared/types'
const req: RestRequest = { id: 'r', name: 'x', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' } }
describe('ui v2 types', () => {
  it('Folder + Collection.folders type-check', () => {
    const f: Folder = { id: 'f1', name: 'Auth', requests: [req] }
    const c: Collection = { id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [f] }
    expect(c.folders?.[0].name).toBe('Auth')
  })
  it('new message arms type-check', () => {
    const a: WebviewMessage = { type: 'renameCollection', id: 'c1', name: 'N' }
    const b: WebviewMessage = { type: 'deleteRequest', collectionId: 'c1', folderId: null, requestId: 'r1' }
    const c: WebviewMessage = { type: 'createFolder', collectionId: 'c1', name: 'F' }
    const d: WebviewMessage = { type: 'saveRequest', collectionId: 'c1', folderId: 'f1', request: req }
    const e: WebviewMessage = { type: 'openRequest', request: req, targetCollectionId: 'c1', targetFolderId: 'f1' }
    const f: WebviewMessage = { type: 'openEnvironments' }
    const g: HostMessage = { type: 'showEnvironments' }
    const h: HostMessage = { type: 'openInEditor', request: req, targetCollectionId: 'c1', targetFolderId: 'f1' }
    expect([a.type, b.type, c.type, d.type, e.type, f.type, g.type, h.type]).toHaveLength(8)
  })
})
