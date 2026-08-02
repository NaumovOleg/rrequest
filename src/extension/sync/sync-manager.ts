import type { Collection, Environment } from '../../shared/types'
import type { SyncClient } from './sync-client'
import { SyncForbiddenError, SyncGoneError, SyncAuthError } from './sync-client'
import type { SyncStateStore } from './sync-state-store'
import { buildSnapshot, mergeEnvironmentsPreservingSecrets, type WorkspaceSnapshot } from './snapshot'
import { mergeSnapshots, pruneDeleted } from './merge'

export type AdoptResult = {
  listed: number // workspaces the server (DynamoDB) knows about for this account
  adopted: string[] // workspace ids pulled down successfully
  failed: number // listed but the pull failed (e.g. trashed Drive file)
  error?: string // listWorkspaces itself failed
}

export type StoresPort = {
  getName(workspaceId: string): Promise<string>
  getCollections(workspaceId: string): Promise<Collection[]>
  getEnvironments(workspaceId: string): Promise<Environment[]>
  applyPulled(workspaceId: string, collections: Collection[], environments: Environment[]): Promise<void>
  // Create a local workspace with the given id if it doesn't exist yet (used
  // when adopting a server workspace on a fresh machine). Never clobbers an
  // existing local workspace's name.
  ensureWorkspace?(id: string, name: string): Promise<void>
}

export class SyncManager {
  constructor(
    private deps: {
      client: SyncClient
      state: SyncStateStore
      stores: StoresPort
      email: () => string
      // Returns false when there's no app token yet (never signed in, or the
      // token is still loading from SecretStorage on startup). Network methods
      // no-op in that case, so an empty `Bearer` request never fires — which
      // would otherwise 401 and trip onAuthLost, wiping the stored token.
      isAuthed?: () => boolean
      onAuthLost?: () => void | Promise<void>
      onSyncError?: (workspaceId: string, error: unknown) => void
    },
  ) {}

  // Ids (collections/folders/requests/environments) the user EXPLICITLY deleted
  // since the last successful push. Sync is otherwise a pure union merge that
  // never drops remote data, so this set is the ONLY way a delete reaches the
  // remote: pruned out of the pushed snapshot, then cleared once the push lands.
  private pendingDeletes = new Set<string>()

  recordDeletion(ids: string[]): void {
    for (const id of ids) if (id) this.pendingDeletes.add(id)
  }

  private authed(): boolean {
    return this.deps.isAuthed?.() ?? true
  }

  /** Pull the current remote snapshot, or undefined if the workspace isn't on the server yet (404). */
  private async tryPull(workspaceId: string): Promise<{ snapshot: WorkspaceSnapshot; revision: string } | undefined> {
    try {
      const { snapshot, revision } = await this.deps.client.pull(workspaceId)
      return { snapshot: JSON.parse(snapshot) as WorkspaceSnapshot, revision }
    } catch (e) {
      if (e instanceof SyncGoneError) return undefined // not created on the server yet
      throw e
    }
  }

  /** Upsert a merged snapshot into the local stores (never deletes locally — applyPulled only saves). */
  private async applyMergedLocally(workspaceId: string, snap: WorkspaceSnapshot): Promise<void> {
    const localEnvs = await this.deps.stores.getEnvironments(workspaceId)
    await this.deps.stores.applyPulled(
      workspaceId,
      snap.collections,
      mergeEnvironmentsPreservingSecrets(snap.environments, localEnvs),
    )
  }

  /** Shared catch taxonomy for push/pull. Returns true if the error was handled (caller should return). */
  private async handleSyncError(workspaceId: string, e: unknown): Promise<void> {
    if (e instanceof SyncForbiddenError) { await this.dropSync(workspaceId); return }
    if (e instanceof SyncGoneError) { await this.dropSync(workspaceId); this.deps.onSyncError?.(workspaceId, e); return }
    if (e instanceof SyncAuthError) { await this.deps.onAuthLost?.(); return }
    this.deps.onSyncError?.(workspaceId, e)
  }

  private async buildLocalSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
    const [name, collections, environments] = await Promise.all([
      this.deps.stores.getName(workspaceId),
      this.deps.stores.getCollections(workspaceId),
      this.deps.stores.getEnvironments(workspaceId),
    ])
    return buildSnapshot({ workspaceId, name, collections, environments, updatedBy: this.deps.email() })
  }

  async enable(workspaceId: string): Promise<void> {
    if (!this.authed()) return
    const local = await this.buildLocalSnapshot(workspaceId)
    // Adopt an already-existing remote file (re-enabling, or a new machine)
    // instead of overwriting it: union local edits over the remote content
    // (local wins, remote-only items kept) and pull that union down locally so
    // the remote's collections show up. A brand-new workspace (404) just writes
    // local.
    const remote = await this.tryPull(workspaceId)
    let toWrite = local
    if (remote) {
      toWrite = mergeSnapshots(local, remote.snapshot)
      await this.applyMergedLocally(workspaceId, toWrite)
    }
    const { driveFileId, revision } = await this.deps.client.enableSync(workspaceId, toWrite.name, JSON.stringify(toWrite))
    await this.deps.state.set(workspaceId, { driveFileId, ownerEmail: this.deps.email(), role: 'owner', lastRevision: revision, synced: true })
  }

  private async dropSync(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (state) await this.deps.state.set(workspaceId, { ...state, synced: false })
  }

  async push(workspaceId: string): Promise<void> {
    if (!this.authed()) return
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return
    try {
      const local = await this.buildLocalSnapshot(workspaceId)
      // Union local over the CURRENT remote before writing, so a stale/empty
      // local can never wipe remote-only collections/requests. Local edits win
      // for shared ids; remote-only items are preserved; explicitly-deleted ids
      // are pruned back out (the only way a delete reaches the remote).
      const remote = await this.tryPull(workspaceId)
      let merged = remote ? mergeSnapshots(local, remote.snapshot) : local
      merged = pruneDeleted(merged, this.pendingDeletes)
      const baseRevision = remote ? remote.revision : state.lastRevision

      const first = await this.deps.client.push(workspaceId, JSON.stringify(merged), baseRevision)
      if (first.ok) {
        // Only after the write succeeds do we adopt the union locally (so any
        // remote-only items now show up) — local-first: a failed sync never
        // mutates local stores.
        if (remote) await this.applyMergedLocally(workspaceId, merged)
        await this.deps.state.set(workspaceId, { ...state, lastRevision: first.revision })
        this.pendingDeletes.clear()
        return
      }
      // conflict: remote moved between our pull and push — union the newer
      // remote under our merged (local still wins), prune again, retry once.
      const remote2 = JSON.parse(first.snapshot) as WorkspaceSnapshot
      const merged2 = pruneDeleted(mergeSnapshots(merged, remote2), this.pendingDeletes)
      const retry = await this.deps.client.push(workspaceId, JSON.stringify(merged2), first.revision)
      if (retry.ok) {
        await this.applyMergedLocally(workspaceId, merged2)
        await this.deps.state.set(workspaceId, { ...state, lastRevision: retry.revision })
        this.pendingDeletes.clear()
      }
    } catch (e) {
      await this.handleSyncError(workspaceId, e)
    }
  }

  async pull(workspaceId: string): Promise<void> {
    if (!this.authed()) return
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return
    try {
      const { snapshot, revision, role } = await this.deps.client.pull(workspaceId)
      const remote = JSON.parse(snapshot) as WorkspaceSnapshot
      const local = await this.buildLocalSnapshot(workspaceId)
      const merged = mergeSnapshots(remote, local)
      const localEnvs = await this.deps.stores.getEnvironments(workspaceId)
      const environments = mergeEnvironmentsPreservingSecrets(merged.environments, localEnvs)
      await this.deps.stores.applyPulled(workspaceId, merged.collections, environments)
      await this.deps.state.set(workspaceId, { ...state, lastRevision: revision, role: role ?? state.role })
    } catch (e) {
      await this.handleSyncError(workspaceId, e)
    }
  }

  // Pull every server workspace down after login so its collections/requests
  // appear locally. Read-only (no push), remote-wins union, so it never
  // overwrites remote OR local — it only adds. Creates a matching local
  // workspace on a fresh machine. Returns a summary so the caller can surface
  // what happened (auto-select an adopted workspace, or report why nothing
  // came down).
  async adoptRemoteWorkspaces(): Promise<AdoptResult> {
    if (!this.authed()) return { listed: 0, adopted: [], failed: 0 }
    // Best-effort: rebuild the server index from Drive first, so workspaces
    // whose DynamoDB row went missing (desync) reappear in listWorkspaces.
    try {
      await this.deps.client.recover()
    } catch {
      // recover is a recovery aid, not required — proceed with whatever the
      // server already indexes.
    }
    let remotes
    try {
      remotes = await this.deps.client.listWorkspaces()
    } catch (e) {
      if (e instanceof SyncAuthError) await this.deps.onAuthLost?.()
      return { listed: 0, adopted: [], failed: 0, error: String((e as Error)?.message ?? e) }
    }
    const adopted: string[] = []
    let failed = 0
    for (const w of remotes) {
      try {
        const pulled = await this.tryPull(w.id)
        if (!pulled) { failed++; continue } // listed but no remote file (404) — inconsistent server state
        // Prefer the Drive file's name (content truth) over the DynamoDB row's
        // name, which can be stale (push only bumps revision, not the row name).
        await this.deps.stores.ensureWorkspace?.(w.id, pulled.snapshot.name || w.name || w.id)
        const local = await this.buildLocalSnapshot(w.id)
        const merged = mergeSnapshots(pulled.snapshot, local) // remote-wins union (adopt)
        await this.applyMergedLocally(w.id, merged)
        await this.deps.state.set(w.id, {
          driveFileId: w.driveFileId ?? '',
          ownerEmail: this.deps.email(),
          role: w.role ?? 'owner',
          lastRevision: pulled.revision,
          synced: true,
        })
        adopted.push(w.id)
      } catch (e) {
        failed++
        // eslint-disable-next-line no-console
        console.error(`[rrequest] adopt failed for workspace ${w.id}:`, e)
      }
    }
    return { listed: remotes.length, adopted, failed }
  }

  async refreshRoles(): Promise<void> {
    if (!this.authed()) return
    let remote
    try {
      remote = await this.deps.client.listWorkspaces()
    } catch (e) {
      if (e instanceof SyncForbiddenError) return
      if (e instanceof SyncAuthError) { await this.deps.onAuthLost?.(); return }
      this.deps.onSyncError?.('*', e)
      return
    }
    for (const w of remote) {
      if (!w.role) continue
      const state = await this.deps.state.get(w.id)
      if (state?.synced) await this.deps.state.set(w.id, { ...state, role: w.role })
    }
  }

  async deleteSync(workspaceId: string): Promise<void> {
    try {
      await this.deps.client.deleteWorkspace(workspaceId)
    } catch (e) {
      if (e instanceof SyncGoneError) { await this.dropSync(workspaceId); return }
      this.deps.onSyncError?.(workspaceId, e)
      return
    }
    await this.dropSync(workspaceId)
  }

  async pullIfNewer(workspaceId: string, revision: string): Promise<boolean> {
    if (!this.authed()) return false
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return false
    if (state.lastRevision === revision) return false // we already have this (e.g. our own push)
    await this.pull(workspaceId)
    return true
  }
}
