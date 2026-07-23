import type { Collection, Environment } from '../../shared/types'
import type { SyncClient } from './sync-client'
import { SyncForbiddenError } from './sync-client'
import type { SyncStateStore } from './sync-state-store'
import { buildSnapshot, mergeEnvironmentsPreservingSecrets, type WorkspaceSnapshot } from './snapshot'
import { mergeSnapshots } from './merge'

export type StoresPort = {
  getName(workspaceId: string): Promise<string>
  getCollections(workspaceId: string): Promise<Collection[]>
  getEnvironments(workspaceId: string): Promise<Environment[]>
  applyPulled(workspaceId: string, collections: Collection[], environments: Environment[]): Promise<void>
}

export class SyncManager {
  constructor(private deps: { client: SyncClient; state: SyncStateStore; stores: StoresPort; email: () => string }) {}

  private async buildLocalSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
    const [name, collections, environments] = await Promise.all([
      this.deps.stores.getName(workspaceId),
      this.deps.stores.getCollections(workspaceId),
      this.deps.stores.getEnvironments(workspaceId),
    ])
    return buildSnapshot({ workspaceId, name, collections, environments, updatedBy: this.deps.email() })
  }

  async enable(workspaceId: string): Promise<void> {
    const snap = await this.buildLocalSnapshot(workspaceId)
    const { driveFileId, revision } = await this.deps.client.enableSync(workspaceId, snap.name, JSON.stringify(snap))
    await this.deps.state.set(workspaceId, { driveFileId, ownerEmail: this.deps.email(), role: 'owner', lastRevision: revision, synced: true })
  }

  private async dropSync(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (state) await this.deps.state.set(workspaceId, { ...state, synced: false })
  }

  async push(workspaceId: string): Promise<void> {
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return
    try {
      const local = await this.buildLocalSnapshot(workspaceId)
      const first = await this.deps.client.push(workspaceId, JSON.stringify(local), state.lastRevision)
      if (first.ok) { await this.deps.state.set(workspaceId, { ...state, lastRevision: first.revision }); return }
      // conflict: merge remote + local, apply locally, retry once against the remote revision
      const remote = JSON.parse(first.snapshot) as WorkspaceSnapshot
      const merged = mergeSnapshots(remote, local)
      const localEnvs = await this.deps.stores.getEnvironments(workspaceId)
      await this.deps.stores.applyPulled(workspaceId, merged.collections, mergeEnvironmentsPreservingSecrets(merged.environments, localEnvs))
      const retry = await this.deps.client.push(workspaceId, JSON.stringify(merged), first.revision)
      if (retry.ok) await this.deps.state.set(workspaceId, { ...state, lastRevision: retry.revision })
    } catch (e) {
      if (e instanceof SyncForbiddenError) { await this.dropSync(workspaceId); return }
      throw e
    }
  }

  async pull(workspaceId: string): Promise<void> {
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
      if (e instanceof SyncForbiddenError) { await this.dropSync(workspaceId); return }
      throw e
    }
  }

  async refreshRoles(): Promise<void> {
    let remote
    try { remote = await this.deps.client.listWorkspaces() }
    catch (e) { if (e instanceof SyncForbiddenError) return; throw e }
    for (const w of remote) {
      if (!w.role) continue
      const state = await this.deps.state.get(w.id)
      if (state?.synced) await this.deps.state.set(w.id, { ...state, role: w.role })
    }
  }

  async pullIfNewer(workspaceId: string, revision: string): Promise<boolean> {
    const state = await this.deps.state.get(workspaceId)
    if (!state?.synced) return false
    if (state.lastRevision === revision) return false // we already have this (e.g. our own push)
    await this.pull(workspaceId)
    return true
  }
}
