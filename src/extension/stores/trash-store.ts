import * as path from 'node:path'
import { newId, type TrashEntry } from '../../shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomic-write'

export class TrashStore {
  private readonly file: string
  constructor(baseDir: string) { this.file = path.join(baseDir, 'trash.json') }

  async list(): Promise<TrashEntry[]> {
    return (await readJsonSafe<TrashEntry[]>(this.file)) ?? []
  }

  async add(entry: Omit<TrashEntry, 'id' | 'at'>): Promise<TrashEntry> {
    const full: TrashEntry = { ...entry, id: newId(), at: Date.now() }
    // Dedupe by the deleted item's own id + workspace + kind: deleting the same
    // underlying item again (e.g. after a sync briefly resurrects it) replaces
    // its trash entry instead of stacking duplicates.
    const existing = (await this.list()).filter(
      (e) => !(e.workspaceId === entry.workspaceId && e.kind === entry.kind && (e.data as { id?: string }).id === (entry.data as { id?: string }).id),
    )
    await writeJsonAtomic(this.file, [full, ...existing])
    return full
  }

  async get(entryId: string): Promise<TrashEntry | undefined> {
    return (await this.list()).find((e) => e.id === entryId)
  }

  async remove(entryId: string): Promise<void> {
    await writeJsonAtomic(this.file, (await this.list()).filter((e) => e.id !== entryId))
  }

  async update(entry: TrashEntry): Promise<void> {
    await writeJsonAtomic(this.file, (await this.list()).map((e) => (e.id === entry.id ? entry : e)))
  }

  async dropByWorkspace(workspaceId: string): Promise<void> {
    await writeJsonAtomic(this.file, (await this.list()).filter((e) => e.workspaceId !== workspaceId))
  }
}
