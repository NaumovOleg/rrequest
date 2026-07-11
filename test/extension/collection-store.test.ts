import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { CollectionStore } from '../../src/extension/collection-store'
import { newId, type RestRequest } from '../../src/shared/types'

let dir: string
let store: CollectionStore
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restman-cs-'))
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

  it('creates a collection and lists it', async () => {
    const c = await store.createCollection('My Coll')
    expect(c.name).toBe('My Coll')
    const all = await store.list()
    expect(all.map((x) => x.name)).toEqual(['My Coll'])
  })

  it('saves a request into a collection and upserts by id', async () => {
    const c = await store.createCollection('C')
    const r = req('First')
    await store.saveRequest(c.id, r)
    const updated = { ...r, name: 'Renamed' }
    await store.saveRequest(c.id, updated)
    const all = await store.list()
    expect(all[0].requests).toHaveLength(1)
    expect(all[0].requests[0].name).toBe('Renamed')
  })

  it('skips a corrupt collection file when listing', async () => {
    await store.createCollection('Good')
    await fs.writeFile(path.join(dir, 'collections', 'bad.json'), '{ broken')
    const all = await store.list()
    expect(all.map((x) => x.name)).toEqual(['Good'])
  })
})
