import * as path from 'node:path'
import { readJsonSafe, writeJsonAtomic } from '../atomic-write'

export type SyncState = {
  driveFileId: string
  ownerEmail: string
  role: 'owner' | 'editor' | 'viewer'
  lastRevision: string
  synced: boolean
}

export class SyncStateStore {
  private readonly file: string
  constructor(baseDir: string) { this.file = path.join(baseDir, 'sync-state.json') }

  async all(): Promise<Record<string, SyncState>> {
    return (await readJsonSafe<Record<string, SyncState>>(this.file)) ?? {}
  }
  async get(workspaceId: string): Promise<SyncState | undefined> {
    return (await this.all())[workspaceId]
  }
  async set(workspaceId: string, state: SyncState): Promise<void> {
    const all = await this.all()
    all[workspaceId] = state
    await writeJsonAtomic(this.file, all)
  }
}
