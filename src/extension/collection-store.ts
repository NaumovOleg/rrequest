import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { newId, type Collection, type RestRequest } from '../shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomic-write'

export class CollectionStore {
  private readonly dir: string
  constructor(baseDir: string) {
    this.dir = path.join(baseDir, 'collections')
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`)
  }

  async list(): Promise<Collection[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.dir)
    } catch {
      return []
    }
    const out: Collection[] = []
    for (const n of names) {
      if (!n.endsWith('.json')) continue
      const c = await readJsonSafe<Collection>(path.join(this.dir, n))
      if (c && c.id && Array.isArray(c.requests)) out.push(c)
    }
    return out
  }

  async createCollection(name: string, workspaceId: string): Promise<Collection> {
    const c: Collection = { id: newId(), name, workspaceId, requests: [] }
    await writeJsonAtomic(this.file(c.id), c)
    return c
  }

  async saveRequest(collectionId: string, request: RestRequest): Promise<Collection> {
    const c = (await readJsonSafe<Collection>(this.file(collectionId)))
      ?? { id: collectionId, name: 'Collection', workspaceId: '', requests: [] }
    const i = c.requests.findIndex((r) => r.id === request.id)
    if (i >= 0) c.requests[i] = request
    else c.requests.push(request)
    await writeJsonAtomic(this.file(collectionId), c)
    return c
  }

  async saveCollection(c: import('../shared/types').Collection): Promise<import('../shared/types').Collection> {
    await writeJsonAtomic(this.file(c.id), c)
    return c
  }
}
