import * as path from 'node:path'
import { newId, type HistoryEntry, type RestRequest } from '../../shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomic-write'

export class HistoryStore {
  private readonly file: string
  private readonly max: number
  // read-modify-write on a JSON file can't be concurrent: two parallel sends
  // would both read the same snapshot, then one rename clobbers the other
  // (and the shared tmp name even throws ENOENT). Serialize every write.
  private tail: Promise<unknown> = Promise.resolve()
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.catch(() => {})
    return run
  }
  constructor(baseDir: string, max = 50) {
    this.file = path.join(baseDir, 'history.json')
    this.max = max
  }

  async list(): Promise<HistoryEntry[]> {
    return (await readJsonSafe<HistoryEntry[]>(this.file)) ?? []
  }

  append(request: RestRequest, status: number, workspaceId: string): Promise<void> {
    const entry: HistoryEntry = { id: newId(), workspaceId, request, status, at: Date.now() }
    return this.lock(async () => {
      const next = [entry, ...(await this.list())].slice(0, this.max)
      await writeJsonAtomic(this.file, next)
    })
  }

  dropByWorkspace(workspaceId: string): Promise<void> {
    return this.lock(async () => {
      const kept = (await this.list()).filter((e) => e.workspaceId !== workspaceId)
      await writeJsonAtomic(this.file, kept)
    })
  }

  clear(): Promise<void> {
    return this.lock(async () => {
      await writeJsonAtomic(this.file, [])
    })
  }
}