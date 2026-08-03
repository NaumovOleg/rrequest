import * as path from 'node:path'
import { newId, type HistoryEntry, type RestRequest } from '../../shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomic-write'

export class HistoryStore {
  private readonly file: string
  private readonly max: number
  constructor(baseDir: string, max = 50) {
    this.file = path.join(baseDir, 'history.json')
    this.max = max
  }

  async list(): Promise<HistoryEntry[]> {
    return (await readJsonSafe<HistoryEntry[]>(this.file)) ?? []
  }

  async append(request: RestRequest, status: number, workspaceId: string): Promise<void> {
    const entry: HistoryEntry = { id: newId(), workspaceId, request, status, at: Date.now() }
    const next = [entry, ...(await this.list())].slice(0, this.max)
    await writeJsonAtomic(this.file, next)
  }

  async dropByWorkspace(workspaceId: string): Promise<void> {
    const kept = (await this.list()).filter((e) => e.workspaceId !== workspaceId)
    await writeJsonAtomic(this.file, kept)
  }
}
