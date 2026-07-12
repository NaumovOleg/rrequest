import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { newId, type Workspace } from '../shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomic-write'

export class WorkspaceStore {
  private readonly dir: string
  constructor(baseDir: string) { this.dir = path.join(baseDir, 'workspaces') }
  private file(id: string): string { return path.join(this.dir, `${id}.json`) }

  async list(): Promise<Workspace[]> {
    let names: string[]
    try { names = await fs.readdir(this.dir) } catch { return [] }
    const out: Workspace[] = []
    for (const n of names) {
      if (!n.endsWith('.json')) continue
      const w = await readJsonSafe<Workspace>(path.join(this.dir, n))
      if (w && w.id && typeof w.name === 'string') out.push(w)
    }
    return out
  }
  async create(name: string): Promise<Workspace> {
    const w: Workspace = { id: newId(), name }
    await writeJsonAtomic(this.file(w.id), w)
    return w
  }
  async rename(id: string, name: string): Promise<void> {
    const w = await readJsonSafe<Workspace>(this.file(id))
    if (w) await writeJsonAtomic(this.file(id), { ...w, name })
  }
  async delete(id: string): Promise<void> {
    await fs.rm(this.file(id), { force: true })
  }
}
