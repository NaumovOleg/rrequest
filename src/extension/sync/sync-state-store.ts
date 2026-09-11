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
  // polled on the schedule; false -> skipped by the poll loop.
  pollEnabled?: boolean
  // Per-workspace opt-out of auto-push. Absent/true -> local edits push;
  // false -> local edits are queued but never sent.
  pushEnabled?: boolean
}

export class SyncStateStore {
  private readonly file: string
  // read-modify-write on the shared JSON file can't be concurrent — and unlike
  // most stores, writes here come from genuinely unserialized callers (the poll
  // loop's timer, a debounced schedulePush, a direct command) that can overlap
  // for real. Same fix as HistoryStore's lock().
  private tail: Promise<unknown> = Promise.resolve()
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.catch(() => {})
    return run
  }
  constructor(baseDir: string) { this.file = path.join(baseDir, 'sync-state.json') }

  async all(): Promise<Record<string, SyncState>> {
    return (await readJsonSafe<Record<string, SyncState>>(this.file)) ?? {}
  }
  async get(workspaceId: string): Promise<SyncState | undefined> {
    return (await this.all())[workspaceId]
  }
  set(workspaceId: string, state: SyncState): Promise<void> {
    return this.lock(async () => {
      const all = await this.all()
      all[workspaceId] = state
      await writeJsonAtomic(this.file, all)
    })
  }
}
