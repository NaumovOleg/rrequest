import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { newId, type Collection, type CollectionItem } from '../shared/types'
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

  async saveRequest(collectionId: string, request: CollectionItem, folderId?: string | null): Promise<Collection | undefined> {
    // Never resurrect a missing collection as a phantom "Collection" — e.g. an
    // editor tab autosaving after its collection was deleted/trashed.
    const c = await readJsonSafe<Collection>(this.file(collectionId))
    if (!c) return undefined
    if (!c.folders) c.folders = []
    if (folderId) {
      const folder = c.folders.find((f) => f.id === folderId)
      if (folder) {
        const i = folder.requests.findIndex((r) => r.id === request.id)
        if (i >= 0) folder.requests[i] = request; else folder.requests.push(request)
      }
    } else {
      const i = c.requests.findIndex((r) => r.id === request.id)
      if (i >= 0) c.requests[i] = request; else c.requests.push(request)
    }
    await writeJsonAtomic(this.file(collectionId), c)
    return c
  }

  async saveCollection(c: import('../shared/types').Collection): Promise<import('../shared/types').Collection> {
    await writeJsonAtomic(this.file(c.id), c)
    return c
  }

  async delete(id: string): Promise<void> {
    await fs.rm(this.file(id), { force: true })
  }
}
