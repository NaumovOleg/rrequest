import type { Collection, Environment } from '../../shared/types'
import type { SyncClient } from './sync-client'
import { SyncForbiddenError, SyncGoneError, SyncAuthError } from './sync-client'
import type { SyncStateStore } from './sync-state-store'
import { buildSnapshot, mergeEnvironmentsPreservingSecrets, type WorkspaceSnapshot } from './snapshot'
import { mergeSnapshots, pruneDeleted } from './merge'

export type AdoptResult = {
  listed: number // workspaces the server (DynamoDB) knows about across all accounts
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
      // Multi-account: `clientFor(accountId)` returns a SyncClient bound to that
      // account's token. A single legacy `client` is still accepted (tests) and
      // used for every account. Each synced workspace records its accountId in
      // SyncState; ops resolve the right client from it.
      clientFor?: (accountId: string | undefined) => SyncClient
      client?: SyncClient
      accounts?: () => string[] // connected account ids (for adopt / refreshRoles)
      state: SyncStateStore
      stores: StoresPort
      email: (accountId?: string) => string
      // Returns false when no account is connected (or a token is still loading
      // on startup). Network methods no-op then, so an empty `Bearer` never
      // fires and onAuthLost can't wipe a token.
      isAuthed?: () => boolean
      // Whether a usable token exists for this workspace's account. When it
      // doesn't (a legacy synced workspace whose accountId no longer resolves,
      // or an unbound accountId with several accounts connected), we skip the
      // request instead of sending an empty `Bearer` that 401s and pops a
      // spurious "sign-in expired" toast while the account still shows synced.
      hasToken?: (accountId?: string) => boolean
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

  // A synced workspace we can't get a token for: skip its network calls so an
  // empty Bearer never 401s. Defaults to true when no checker is wired.
  private tokenReady(accountId?: string): boolean {
    return this.deps.hasToken ? this.deps.hasToken(accountId) : true
  }

  /** The SyncClient for an account (falls back to the legacy single client). */
  private cli(accountId?: string): SyncClient {
    const c = this.deps.clientFor ? this.deps.clientFor(accountId) : this.deps.client
    if (!c) throw new SyncAuthError()
    return c
  }

  /** Account ids to sweep for adopt / refreshRoles; [undefined] when unset (legacy single account). */
  private accountScope(): (string | undefined)[] {
    const ids = this.deps.accounts?.()
    return ids && ids.length ? ids : [undefined]
  }

  /** Pull the current remote snapshot, or undefined if the workspace isn't on the server yet (404). */
  private async tryPull(workspaceId: string, accountId?: string): Promise<{ snapshot: WorkspaceSnapshot; revision: string } | undefined> {
    try {
      const { snapshot, revision } = await this.cli(accountId).pull(workspaceId)
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

  /** Shared catch taxonomy for push/pull. */
  private async handleSyncError(workspaceId: string, e: unknown): Promise<void> {
    if (e instanceof SyncForbiddenError) { await this.dropSync(workspaceId); return }
    if (e instanceof SyncGoneError) { await this.dropSync(workspaceId); this.deps.onSyncError?.(workspaceId, e); return }
    if (e instanceof SyncAuthError) { await this.deps.onAuthLost?.(); return }
    this.deps.onSyncError?.(workspaceId, e)
  }

  private async buildLocalSnapshot(workspaceId: string, accountId?: string): Promise<WorkspaceSnapshot> {
    const [name, collections, environments] = await Promise.all([
      this.deps.stores.getName(workspaceId),
      this.deps.stores.getCollections(workspaceId),
      this.deps.stores.getEnvironments(workspaceId),
    ])
    return buildSnapshot({ workspaceId, name, collections, environments, updatedBy: this.deps.email(accountId) })
  }

  /** Enable sync for a workspace, binding it to the given account. */
  async enable(workspaceId: string, accountId?: string): Promise<void> {
    if (!this.authed()) return
    const local = await this.buildLocalSnapshot(workspaceId, accountId)
    // Adopt an already-existing remote file (re-enabling, or a new machine)
    // instead of overwriting it: union local edits over the remote content and
    // pull that union down locally. A brand-new workspace (404) just writes local.
    const remote = await this.tryPull(workspaceId, accountId)
    let toWrite = local
    if (remote) {
      toWrite = mergeSnapshots(local, remote.snapshot)
      await this.applyMergedLocally(workspaceId, toWrite)
    }
    const { driveFileId, revision } = await this.cli(accountId).enableSync(workspaceId, toWrite.name, JSON.stringify(toWrite))
    await this.deps.state.set(workspaceId, { driveFileId, ownerEmail: this.deps.email(accountId), role: 'owner', lastRevision: revision, synced: true, accountId })
  }

  private async dropSync(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (state) await this.deps.state.set(workspaceId, { ...state, synced: false })
  }

  async push(workspaceId: string): Promise<void> {
    if (!this.authed()) return
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return
    const accountId = state.accountId
    if (!this.tokenReady(accountId)) return
    try {
      const local = await this.buildLocalSnapshot(workspaceId, accountId)
      // Union local over the CURRENT remote before writing, so a stale/empty
      // local can never wipe remote-only items. Local edits win; remote-only
      // items are preserved; explicitly-deleted ids are pruned back out.
      const remote = await this.tryPull(workspaceId, accountId)
      let merged = remote ? mergeSnapshots(local, remote.snapshot) : local
      merged = pruneDeleted(merged, this.pendingDeletes)
      const baseRevision = remote ? remote.revision : state.lastRevision

      const first = await this.cli(accountId).push(workspaceId, JSON.stringify(merged), baseRevision)
      if (first.ok) {
        if (remote) await this.applyMergedLocally(workspaceId, merged)
        await this.deps.state.set(workspaceId, { ...state, lastRevision: first.revision })
        this.pendingDeletes.clear()
        return
      }
      // conflict: remote moved between our pull and push — union the newer
      // remote under our merged (local still wins), prune again, retry once.
      const remote2 = JSON.parse(first.snapshot) as WorkspaceSnapshot
      const merged2 = pruneDeleted(mergeSnapshots(merged, remote2), this.pendingDeletes)
      const retry = await this.cli(accountId).push(workspaceId, JSON.stringify(merged2), first.revision)
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
    const accountId = state.accountId
    if (!this.tokenReady(accountId)) return
    try {
      const { snapshot, revision, role } = await this.cli(accountId).pull(workspaceId)
      const remote = JSON.parse(snapshot) as WorkspaceSnapshot
      const local = await this.buildLocalSnapshot(workspaceId, accountId)
      // Keep explicitly-deleted ids out of the local merge until the push has
      // actually removed them from the remote — otherwise a poll between the
      // delete and the push resurrects the item locally (user deletes again ->
      // duplicate trash entries). pendingDeletes is cleared only by push.
      const merged = pruneDeleted(mergeSnapshots(remote, local), this.pendingDeletes)
      const localEnvs = await this.deps.stores.getEnvironments(workspaceId)
      const environments = mergeEnvironmentsPreservingSecrets(merged.environments, localEnvs)
      await this.deps.stores.applyPulled(workspaceId, merged.collections, environments)
      await this.deps.state.set(workspaceId, { ...state, lastRevision: revision, role: role ?? state.role })
    } catch (e) {
      await this.handleSyncError(workspaceId, e)
    }
  }

  // Pull every server workspace down (across ALL connected accounts) after
  // login so its collections/requests appear locally, bound to the account that
  // owns/shares them. Read-only (no push), remote-wins union — never overwrites.
  // onlyAccountId: adopt just that one account (the per-account "force sync"),
  // otherwise sweep every connected account.
  async adoptRemoteWorkspaces(onlyAccountId?: string): Promise<AdoptResult> {
    if (!this.authed()) return { listed: 0, adopted: [], failed: 0 }
    const adopted: string[] = []
    let listed = 0
    let failed = 0
    let error: string | undefined
    const scope = onlyAccountId ? [onlyAccountId] : this.accountScope()
    for (const accountId of scope) {
      try {
        await this.cli(accountId).recover()
      } catch {
        /* recovery aid — proceed with whatever the server already indexes */
      }
      let remotes
      try {
        remotes = await this.cli(accountId).listWorkspaces()
      } catch (e) {
        if (e instanceof SyncAuthError) await this.deps.onAuthLost?.()
        error = String((e as Error)?.message ?? e)
        continue
      }
      listed += remotes.length
      for (const w of remotes) {
        try {
          const pulled = await this.tryPull(w.id, accountId)
          if (!pulled) { failed++; continue }
          await this.deps.stores.ensureWorkspace?.(w.id, pulled.snapshot.name || w.name || w.id)
          const local = await this.buildLocalSnapshot(w.id, accountId)
          const merged = pruneDeleted(mergeSnapshots(pulled.snapshot, local), this.pendingDeletes)
          await this.applyMergedLocally(w.id, merged)
          await this.deps.state.set(w.id, {
            driveFileId: w.driveFileId ?? '',
            ownerEmail: this.deps.email(accountId),
            role: w.role ?? 'owner',
            lastRevision: pulled.revision,
            synced: true,
            accountId,
          })
          adopted.push(w.id)
        } catch (e) {
          failed++
          // eslint-disable-next-line no-console
          console.error(`[rrequest] adopt failed for workspace ${w.id}:`, e)
        }
      }
    }
    return { listed, adopted, failed, ...(adopted.length === 0 && error ? { error } : {}) }
  }

  async refreshRoles(): Promise<void> {
    if (!this.authed()) return
    for (const accountId of this.accountScope()) {
      let remote
      try {
        remote = await this.cli(accountId).listWorkspaces()
      } catch (e) {
        if (e instanceof SyncForbiddenError) continue
        if (e instanceof SyncAuthError) { await this.deps.onAuthLost?.(); continue }
        this.deps.onSyncError?.('*', e)
        continue
      }
      for (const w of remote) {
        if (!w.role) continue
        const state = await this.deps.state.get(w.id)
        if (state?.synced) await this.deps.state.set(w.id, { ...state, role: w.role })
      }
    }
  }

  async deleteSync(workspaceId: string): Promise<void> {
    const accountId = (await this.deps.state.get(workspaceId))?.accountId
    try {
      await this.cli(accountId).deleteWorkspace(workspaceId)
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
