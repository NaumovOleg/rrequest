import * as path from 'node:path'
import { readJsonSafe, writeJsonAtomic } from '../stores/atomic-write'

export type SyncState = {
  driveFileId: string
  ownerEmail: string
  role: 'owner' | 'editor' | 'viewer'
  lastRevision: string
  synced: boolean
  // Which connected account (AccountStore id) this workspace is bound to. Absent
  // on pre-multi-account state -> resolves to the sole account as a fallback.
  accountId?: string
  // Per-workspace opt-out of the auto-poll (background pull). Absent/true ->
  // polled on the schedule; false -> skipped by the poll loop. Pushes are never
  // affected -- local edits still hit the server whenever they're made.
  pollEnabled?: boolean
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
