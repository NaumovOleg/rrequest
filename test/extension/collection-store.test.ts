import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { CollectionStore } from '../../src/extension/collection-store'
import { newId, type RestRequest } from '../../src/shared/types'

let dir: string
let store: CollectionStore
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rrequest-cs-'))
  store = new CollectionStore(dir)
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

function req(name: string): RestRequest {
  return { id: newId(), name, method: 'GET', url: 'https://x', params: [], headers: [], body: { mode: 'none' } }
}

describe('CollectionStore', () => {
  it('starts empty', async () => {
    expect(await store.list()).toEqual([])
  })

  it('creates a collection with a workspace id and lists it', async () => {
    const c = await store.createCollection('My Coll', 'ws1')
    expect(c.name).toBe('My Coll')
    expect(c.workspaceId).toBe('ws1')
    expect((await store.list()).map((x) => x.name)).toEqual(['My Coll'])
  })

  it('does not resurrect a missing collection as a phantom "Collection"', async () => {
    const res = await store.saveRequest('ghost-id', req('R'))
    expect(res).toBeUndefined()
    expect(await store.list()).toEqual([])
  })

  it('saves a request into a collection and upserts by id', async () => {
    const c = await store.createCollection('C', 'ws1')
    const r = req('First')
    await store.saveRequest(c.id, r)
    const updated = { ...r, name: 'Renamed' }
    await store.saveRequest(c.id, updated)
    const all = await store.list()
    expect(all[0].requests).toHaveLength(1)
    expect(all[0].requests[0].name).toBe('Renamed')
  })

  it('skips a corrupt collection file when listing', async () => {
    await store.createCollection('Good', 'ws1')
    await fs.writeFile(path.join(dir, 'collections', 'bad.json'), '{ broken')
    const all = await store.list()
    expect(all.map((x) => x.name)).toEqual(['Good'])
  })

  it('saveCollection writes a whole collection and lists it', async () => {
    const c = { id: 'imp1', name: 'Imported', workspaceId: '', requests: [
      { id: 'r', name: 'x', method: 'GET' as const, url: 'https://a', params: [], headers: [], body: { mode: 'none' as const } },
    ] }
    await store.saveCollection(c)
    const all = await store.list()
    expect(all.find((x) => x.id === 'imp1')?.requests).toHaveLength(1)
  })

  it('deletes a collection', async () => {
    const c = await store.createCollection('X', 'w1')
    await store.delete(c.id)
    expect(await store.list()).toEqual([])
  })

  it('saveRequest into a folder upserts into that folder', async () => {
    const c = await store.createCollection('X', 'w1')
    await store.saveCollection({ ...c, folders: [{ id: 'f1', name: 'F', requests: [] }] })
    const r = { id: 'r1', name: 'req', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
    await store.saveRequest(c.id, r, 'f1')
    const all = await store.list()
    expect(all[0].folders?.[0].requests).toHaveLength(1)
    expect(all[0].requests).toHaveLength(0)
  })
})
